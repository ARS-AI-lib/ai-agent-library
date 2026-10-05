#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
// One-off (2026-10-05, delay alerts v2): reset the alert clocks of EXISTING
// items to createdAt (user decision — "count from create date" for the first
// rounds, since no real history exists).
//   progressUpdatedAt = createdAt   where missing
//   phaseSince        = createdAt   where it still holds the first backfill's
//                                   updatedAt copy, i.e. any value before
//                                   CUTOFF (the hosting deploy that started
//                                   real stamps). Real stamps are kept.
// Dry run by default; --apply to write. updatedAt is never touched.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'wolfy-481609' });
const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore('ai-agent-lib');

const CUTOFF = new Date('2026-10-05T09:00:00Z');
const toDate = (v) => (v && v.toDate ? v.toDate() : null);

(async () => {
  const apply = process.argv.includes('--apply');
  const snap = await db.collection('agents').get();
  const writes = [];
  let pu = 0; let ps = 0; let keptReal = 0; let noCreated = 0;
  for (const d of snap.docs) {
    const a = d.data();
    if (!a.createdAt) { noCreated++; continue; }
    const patch = {};
    if (a.progressUpdatedAt == null) { patch.progressUpdatedAt = a.createdAt; pu++; }
    const cur = toDate(a.phaseSince);
    if (!cur || cur < CUTOFF) { patch.phaseSince = a.createdAt; ps++; } else keptReal++;
    if (Object.keys(patch).length) writes.push([d.ref, patch]);
  }
  console.log(`agents ${snap.size} · progressUpdatedAt←createdAt ${pu} · phaseSince←createdAt ${ps} · real phaseSince kept ${keptReal} · no createdAt ${noCreated}`);
  if (!apply) { console.log('dry run — pass --apply to write'); return; }
  for (let i = 0; i < writes.length; i += 400) {
    const b = db.batch();
    writes.slice(i, i + 400).forEach(([ref, patch]) => b.update(ref, patch));
    await b.commit();
  }
  console.log(`wrote ${writes.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
