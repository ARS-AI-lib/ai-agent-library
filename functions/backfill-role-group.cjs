// One-off (2026-09-24): give every live agent/skill its PRIMARY role group
// using the same v5 prompt as the classifyRoleGroup callable
// (roleGroupRules.js — never a copy). Writes ONLY docs that have no roleGroup
// yet, so a re-run can never move a number that was already analysed.
//
//   node functions/backfill-role-group.cjs            # dry run: classify + print, write nothing
//   node functions/backfill-role-group.cjs --apply    # classify + write
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { GoogleGenAI } = require('@google/genai');
const { loadRoleGroups, keysOf, needsRoleGroup, classifyWithAi } = require('./roleGroupRules');

const APPLY = process.argv.includes('--apply');
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' }), 'ai-agent-lib');
const ai = new GoogleGenAI({ vertexai: true, project: 'wolfy-481609', location: 'asia-southeast1' });

(async () => {
  const groups = await loadRoleGroups(db);
  const ROLE_GROUP_KEYS = keysOf(groups);
  const all = (await db.collection('agents').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const targets = all.filter((a) => needsRoleGroup(a, ROLE_GROUP_KEYS));
  const classified = all.filter((a) => a.roleGroup && !a.archived);
  console.log(`live needing a role group: ${targets.length} · already classified: ${classified.length}`);
  if (!targets.length) { console.log('nothing to do'); process.exit(0); }

  const results = await classifyWithAi(ai, targets, classified, groups);
  const missing = targets.filter((t) => !results[t.id]);

  const tally = Object.fromEntries(ROLE_GROUP_KEYS.map((g) => [g, { agent: 0, skill: 0 }]));
  targets.forEach((t) => {
    const r = results[t.id];
    if (!r) return;
    const isSkill = t.aiAgent === false && t.skillMd === true; // same rule as getType()
    tally[r.primary][isSkill ? 'skill' : 'agent'] += 1;
  });
  console.log('\nprimary group        agent skill total');
  ROLE_GROUP_KEYS.forEach((g) => {
    const x = tally[g];
    console.log(`${g.padEnd(20)} ${String(x.agent).padStart(5)} ${String(x.skill).padStart(5)} ${String(x.agent + x.skill).padStart(5)}`);
  });
  console.log(`\nclassified ${Object.keys(results).length}/${targets.length}` + (missing.length ? ` · no answer: ${missing.map((m) => m.agentName).join(', ')}` : ''));

  if (!APPLY) { console.log('\nDry run — pass --apply to write.'); process.exit(0); }

  const entries = Object.entries(results);
  for (let i = 0; i < entries.length; i += 400) {
    const batch = db.batch();
    entries.slice(i, i + 400).forEach(([id, r]) => batch.update(db.collection('agents').doc(id), {
      roleGroup: r.primary,
      roleGroupSecondary: r.secondary,
      roleGroupReason: r.reason,
      roleGroupSource: 'ai',
      roleGroupAt: FieldValue.serverTimestamp(),
    }));
    await batch.commit();
  }
  console.log(`\nApplied ${entries.length}.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
