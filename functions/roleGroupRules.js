// Role Group classification (2026-09-24) — the single place that decides HOW
// an agent/skill gets its PRIMARY role group. Used by the classifyRoleGroup
// callable and by backfill-role-group.cjs, so both run the exact same prompt
// (same pattern as chatPrompt.js / agentReadyRules.js).
//
// ── Method: "v5", chosen after 5 read-only pilots on the live library ──
// Evidence order: name > description (TBC -> name + relatedRole) >
// relatedRole (confirms only) > output (confirms only). One PRIMARY group per
// item = the people who run the tool day to day; SECONDARY = up to 2 groups
// that benefit indirectly. Against the hand-made sheet this agreed 166/189
// (88%), the best of the variants tried; putting relatedRole first or second
// drifted back to "who built it" (e.g. customer chatbots tagged AI Engineer).
//
// ── Stability rules (user decision) ──
// * A stored roleGroup is NEVER overwritten by AI — only filled when missing.
//   An admin can change it by hand (roleGroupSource: 'admin').
// * Already-classified items are sent along as reference examples, so a new
//   item lands consistently with how similar ones were already placed.
// * The model can only answer with the 15 keys (responseSchema enum) — it
//   cannot invent a group (CLAUDE.md §31).

// Must equal ROLE_GROUP_ORDER in src/lib/roleGroups.js — functions cannot
// import src/, so verify-role-group.cjs asserts the two lists match.
const ROLE_GROUP_KEYS = [
  'UX/UI', 'Software Engineer', 'Product owner', 'Operations', 'Support function',
  'SIT', 'Business Users', 'Business Analyst', 'DevOps Engineer', 'Delivery Manager',
  'System', 'UAT', 'System Architect', 'Analyst', 'Security Engineer',
];

const ROLE_GROUP_MODEL = 'gemini-2.5-flash';

const ROLE_GROUP_SYSTEM = `You classify AI agents/skills in an internal bank AI library.
Analyse each item in this STRICT order of evidence:
  1) name — the agent/skill name (strongest evidence of what it is and who it is for)
  2) description — what the tool actually does. If the description is "TBC" or empty, decide from name + relatedRole instead.
  3) relatedRole — use only to SUPPORT/confirm what name and description say; never let it override them.
  4) output — use only to CONFIRM the decision.
From the real capability, decide:
  - primary: the ONE group whose people run this tool / whose day-to-day job it is built for.
  - secondary: 0-2 other groups that benefit indirectly (they consume the output, review it, etc.). Never repeat primary.
Allowed group keys (use exactly these): ${ROLE_GROUP_KEYS.join(' | ')}.
Definitions: UX/UI = designers, UX writers, UX researchers. Software Engineer = developers of any stack, tech leads, AI engineers building software. Product owner = PO / product managers. Business Analyst = BA writing requirements, epics, user stories. SIT = system-integration testing; in this organisation the "Tester" role is the SIT-TQM team, so test-case/automation/defect tools for Testers are SIT. UAT = QA / user-acceptance / quality audits / PVT. Delivery Manager = project, delivery, scrum management. DevOps Engineer = CI/CD, deployment, infrastructure. System = platform-internal tools with no human end user. System Architect = solution/system architecture, API/HLD design. Analyst = credit, data, BI analysts. Business Users = business-side staff (investment, CRM, content, compliance) AND customer-facing business chatbots whose end users are bank customers. Support function = customer support, SME, marketing, AI creators. Operations = back-office document processing. Security Engineer = security.
If "Already-classified reference items" are given, stay consistent with them: a new item that does the same kind of job as a reference item should get the same primary group.
reason: one short sentence citing the name/description evidence.`;

const ROLE_GROUP_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING' },
      primary: { type: 'STRING', enum: ROLE_GROUP_KEYS },
      secondary: { type: 'ARRAY', items: { type: 'STRING', enum: ROLE_GROUP_KEYS }, maxItems: 2 },
      reason: { type: 'STRING' },
    },
    required: ['id', 'primary', 'secondary', 'reason'],
  },
};

const clip = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);
const roleList = (r) => (Array.isArray(r) ? r : String(r || '').split(/[,/]/))
  .map((x) => String(x).replace(/[​-‍﻿]/g, '').trim()).filter(Boolean);

function itemText(a) {
  return `id: ${a.id}\nname: ${clip(a.agentName, 160)}\nrelatedRole: ${roleList(a.relatedRole).join(', ')}\ndescription: ${clip(a.description, 500)}\noutput: ${clip(a.output, 200)}`;
}

/**
 * Baseline examples: up to `max` already-classified items most similar to the
 * targets (shared relatedRole / category), so new items follow precedent.
 */
function pickExamples(targets, classified, max = 20) {
  const want = new Set();
  targets.forEach((t) => {
    roleList(t.relatedRole).forEach((r) => want.add(`r:${r.toLowerCase()}`));
    (Array.isArray(t.category) ? t.category : []).forEach((c) => want.add(`c:${c}`));
  });
  const ids = new Set(targets.map((t) => t.id));
  return classified
    .filter((a) => !ids.has(a.id) && ROLE_GROUP_KEYS.includes(a.roleGroup))
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
function sanitizeResults(rows, targets) {
  const ids = new Set(targets.map((t) => t.id));
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (!r || !ids.has(r.id) || !ROLE_GROUP_KEYS.includes(r.primary)) return;
    const secondary = [...new Set((Array.isArray(r.secondary) ? r.secondary : [])
      .filter((g) => ROLE_GROUP_KEYS.includes(g) && g !== r.primary))].slice(0, 2);
    out[r.id] = { primary: r.primary, secondary, reason: clip(r.reason, 300) };
  });
  return out;
}

/** True when this doc should be (re)considered by AI — never when already set. */
function needsRoleGroup(agent) {
  return agent?.approvalStatus === 'approved' && !agent?.archived && !ROLE_GROUP_KEYS.includes(agent?.roleGroup);
}

/**
 * Classify `targets` with Gemini in batches; returns { [id]: {primary, secondary, reason} }.
 * `ai` is a GoogleGenAI client. Missing ids are retried one by one once.
 */
async function classifyWithAi(ai, targets, classified, { batch = 8 } = {}) {
  const call = async (items) => {
    const r = await ai.models.generateContent({
      model: ROLE_GROUP_MODEL,
      contents: [{ role: 'user', parts: [{ text: buildRoleGroupPrompt(items, pickExamples(items, classified)) }] }],
      config: {
        systemInstruction: ROLE_GROUP_SYSTEM,
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: ROLE_GROUP_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    return sanitizeResults(JSON.parse(r.text || '[]'), items);
  };
  const out = {};
  for (let i = 0; i < targets.length; i += batch) Object.assign(out, await call(targets.slice(i, i + batch)));
  for (const t of targets.filter((x) => !out[x.id])) Object.assign(out, await call([t]));
  return out;
}

module.exports = {
  ROLE_GROUP_KEYS, ROLE_GROUP_MODEL, ROLE_GROUP_SYSTEM, ROLE_GROUP_SCHEMA,
  pickExamples, buildRoleGroupPrompt, sanitizeResults, needsRoleGroup, classifyWithAi,
};
