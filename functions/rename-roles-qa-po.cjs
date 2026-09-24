// One-off (2026-09-24): unify two relatedRole spellings the user decided on.
//   'QA'              → 'QA Engineer'
//   'Product Manager' → 'Product Owner'
// and retire the old spellings from /config/schema.relatedRole (adding
// 'Product Owner' there), so the form stops offering them.
//
// Why Admin SDK: /config/schema is grow-only under firestore.rules (a client
// can add a role but never remove one), and several target docs are
// Ready-to-Use locked. Same reason as rename-team-amp-cin.cjs.
//
// Safe to re-run: a doc already on the new spelling is skipped. Duplicates
// created by the rename (a doc holding both 'QA' and 'QA Engineer') collapse
// to one entry, first position kept. The legacy comma/slash string form is
// rewritten in place as a string, never converted to an array.
//
// Does NOT touch: agentName, matchingAgent, approveArea (stored layer 1 wins;
// 'Product Owner' and 'QA Engineer' already route to the same areas as the
// old spellings in ROLE_AREA). Search vectors are refreshed separately with
// bootstrap-vectors.cjs because relatedRole is part of the embed text.
//
//   node functions/rename-roles-qa-po.cjs           # dry run
//   node functions/rename-roles-qa-po.cjs --apply
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const RENAME = { QA: 'QA Engineer', 'Product Manager': 'Product Owner' };
const ZW = /[​‌‍﻿]/g;
const clean = (r) => String(r || '').replace(ZW, '').trim();

const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' }), 'ai-agent-lib');

function renameList(list) {
  const out = [];
  const seen = new Set();
  list.forEach((r) => {
    const v = RENAME[clean(r)] || r;
    const k = clean(v).toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(v);
  });
  return out;
}

(async () => {
  const snap = await db.collection('agents').get();
  const changes = [];
  snap.docs.forEach((d) => {
    const rr = d.data().relatedRole;
    if (!rr) return;
    let next;
    if (Array.isArray(rr)) {
      next = renameList(rr);
      if (JSON.stringify(next) === JSON.stringify(rr)) return;
    } else {
      const parts = String(rr).split(/[,/]/).map((s) => s.trim()).filter(Boolean);
      if (!parts.some((p) => RENAME[clean(p)])) return;
      next = renameList(parts).join(', ');
    }
    changes.push({ ref: d.ref, name: d.data().agentName, before: rr, after: next });
  });

  const schemaRef = db.doc('config/schema');
  const roles = (await schemaRef.get()).data()?.relatedRole || [];
  const nextRoles = roles.filter((r) => !RENAME[clean(r)]);
  Object.values(RENAME).forEach((v) => { if (!nextRoles.some((r) => clean(r).toLowerCase() === v.toLowerCase())) nextRoles.push(v); });

  changes.forEach((c) => console.log(`  ${c.name}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`));
  console.log(`\nagents to update: ${changes.length}`);
  console.log(`schema.relatedRole: ${roles.length} → ${nextRoles.length}`);
  roles.filter((r) => !nextRoles.includes(r)).forEach((r) => console.log(`  - ${r} (RETIRED)`));
  nextRoles.filter((r) => !roles.includes(r)).forEach((r) => console.log(`  + ${r}`));

  if (!APPLY) { console.log('\nDry run — pass --apply to write.'); process.exit(0); }

  for (let i = 0; i < changes.length; i += 400) {
    const batch = db.batch();
    changes.slice(i, i + 400).forEach((c) => batch.update(c.ref, { relatedRole: c.after, updatedAt: FieldValue.serverTimestamp() }));
    await batch.commit();
  }
  await schemaRef.update({ relatedRole: nextRoles });
  console.log('\nApplied.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
