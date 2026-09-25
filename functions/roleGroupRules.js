// Role Group classification (2026-09-24) — the single place that decides HOW
// an agent/skill gets its PRIMARY role group. Used by the classifyRoleGroup
// and manageRoleGroups callables and by backfill-role-group.cjs, so all run
// the exact same prompt (same pattern as chatPrompt.js / agentReadyRules.js).
//
// ── Method: "v5", chosen after 5 read-only pilots on the live library ──
// Evidence order: name > description (TBC -> name + relatedRole) >
// relatedRole (confirms only) > output (confirms only). One PRIMARY group per
// item = the people who run the tool day to day; SECONDARY = up to 2 groups
// that benefit indirectly. Against the hand-made sheet this agreed 166/189
// (88%), the best of the variants tried.
//
// ── Groups come from /config/roleGroups (Role Group Management UI) ──
// The group keys, their definitions and the response enum are built from the
// config at call time — nothing about the groups is hard-coded here any more.
// DEFAULT_ROLE_GROUPS is only the fallback when the doc does not exist yet.
//
// ── Stability rules (user decision) ──
// * AI only fills a MISSING roleGroup; a stored one is never overwritten
//   (the explicit "Re-classify this group" action clears AI-set ones first).
// * Already-classified items are sent along as reference examples, so a new
//   item lands consistently with how similar ones were already placed.
// * The model can only answer with the configured keys (responseSchema enum)
//   — it cannot invent a group (CLAUDE.md §31).
const { DEFAULT_ROLE_GROUPS } = require('./roleGroupAdminRules');

const { GEN_MODEL, THINK_OFF } = require('./modelConfig');
const ROLE_GROUP_MODEL = GEN_MODEL;
const ROLE_GROUP_DOC = 'config/roleGroups';

async function loadRoleGroups(db) {
  const snap = await db.doc(ROLE_GROUP_DOC).get();
  const groups = snap.exists ? snap.data()?.groups : null;
  return Array.isArray(groups) && groups.length ? groups : DEFAULT_ROLE_GROUPS;
}

const keysOf = (groups) => groups.map((g) => g.key);

function buildSystem(groups) {
  const keys = keysOf(groups);
  return `You classify AI agents/skills in an internal bank AI library.
Analyse each item in this STRICT order of evidence:
  1) name — the agent/skill name (strongest evidence of what it is and who it is for)
  2) description — what the tool actually does. If the description is "TBC" or empty, decide from name + relatedRole instead.
  3) relatedRole — use only to SUPPORT/confirm what name and description say; never let it override them.
  4) output — use only to CONFIRM the decision.
From the real capability, decide:
  - primary: the ONE group whose people run this tool / whose day-to-day job it is built for.
  - secondary: 0-2 other groups that benefit indirectly (they consume the output, review it, etc.). Never repeat primary.
Allowed group keys (use exactly these): ${keys.join(' | ')}.
Definitions: ${groups.map((g) => `${g.key} = ${g.definition}${g.roles?.length ? ` (typical roles: ${g.roles.join(', ')})` : ''}`).join('. ')}.
If "Already-classified reference items" are given, stay consistent with them: a new item that does the same kind of job as a reference item should get the same primary group.
reason: one short sentence citing the name/description evidence.`;
}

function buildSchema(groups) {
  const keys = keysOf(groups);
  return {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING' },
        primary: { type: 'STRING', enum: keys },
        secondary: { type: 'ARRAY', items: { type: 'STRING', enum: keys }, maxItems: 2 },
        reason: { type: 'STRING' },
      },
      required: ['id', 'primary', 'secondary', 'reason'],
    },
  };
}

const clip = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);
const roleList = (r) => (Array.isArray(r) ? r : String(r || '').split(/[,/]/))
  .map((x) => String(x).replace(/[​-‍﻿]/g, '').trim()).filter(Boolean);

function itemText(a) {
  return `id: ${a.id}\nname: ${clip(a.agentName, 160)}\nrelatedRole: ${roleList(a.relatedRole).join(', ')}\ndescription: ${clip(a.description, 500)}\noutput: ${clip(a.output, 200)}`;
}

/** Baseline examples: up to `max` already-classified items sharing a role/category with the targets. */
function pickExamples(targets, classified, keys, max = 20) {
  const want = new Set();
  targets.forEach((t) => {
    roleList(t.relatedRole).forEach((r) => want.add(`r:${r.toLowerCase()}`));
    (Array.isArray(t.category) ? t.category : []).forEach((c) => want.add(`c:${c}`));
  });
  const ids = new Set(targets.map((t) => t.id));
  return classified
    .filter((a) => !ids.has(a.id) && keys.includes(a.roleGroup))
    .map((a) => {
      let s = 0;
      roleList(a.relatedRole).forEach((r) => { if (want.has(`r:${r.toLowerCase()}`)) s += 2; });
      (Array.isArray(a.category) ? a.category : []).forEach((c) => { if (want.has(`c:${c}`)) s += 1; });
      return { a, s };
    })
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, max)
    .map((x) => x.a);
}

function buildRoleGroupPrompt(targets, examples = []) {
  const ref = examples.length
    ? `Already-classified reference items (for consistency — do NOT classify these):\n${examples
      .map((e) => `- ${clip(e.agentName, 120)} | roles: ${roleList(e.relatedRole).join(', ')} => primary: ${e.roleGroup}`).join('\n')}\n\n`
    : '';
  return `${ref}Classify these items:\n${targets.map(itemText).join('\n---\n')}`;
}

/** Keep only well-formed answers for the requested ids. */
function sanitizeResults(rows, targets, keys) {
  const ids = new Set(targets.map((t) => t.id));
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r || !ids.has(r.id) || !keys.includes(r.primary)) return;
    const secondary = [...new Set((Array.isArray(r.secondary) ? r.secondary : [])
      .filter((g) => keys.includes(g) && g !== r.primary))].slice(0, 2);
    out[r.id] = { primary: r.primary, secondary, reason: clip(r.reason, 300) };
  });
  return out;
}

/** True when AI should fill this doc — never when a valid roleGroup is already stored. */
function needsRoleGroup(agent, keys) {
  return agent?.approvalStatus === 'approved' && !agent?.archived && !keys.includes(agent?.roleGroup);
}

/** Classify `targets` in batches; returns { [id]: {primary, secondary, reason} }. */
async function classifyWithAi(ai, targets, classified, groups, { batch = 8 } = {}) {
  const keys = keysOf(groups);
  const system = buildSystem(groups);
  const schema = buildSchema(groups);
  const call = async (items) => {
    const r = await ai.models.generateContent({
      model: ROLE_GROUP_MODEL,
      contents: [{ role: 'user', parts: [{ text: buildRoleGroupPrompt(items, pickExamples(items, classified, keys)) }] }],
      config: {
        systemInstruction: system,
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: schema,
        thinkingConfig: THINK_OFF,
      },
    });
    return sanitizeResults(JSON.parse(r.text || '[]'), items, keys);
  };
  const out = {};
  for (let i = 0; i < targets.length; i += batch) Object.assign(out, await call(targets.slice(i, i + batch)));
  for (const t of targets.filter((x) => !out[x.id])) Object.assign(out, await call([t]));
  return out;
}

module.exports = {
  ROLE_GROUP_MODEL, ROLE_GROUP_DOC, loadRoleGroups, keysOf, buildSystem, buildSchema,
  pickExamples, buildRoleGroupPrompt, sanitizeResults, needsRoleGroup, classifyWithAi,
};
