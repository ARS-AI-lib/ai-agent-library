#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
// One-off (2026-10-05): give every agent without `phaseSince` a starting
// value so the stale-status alerts (delayAlertRules.js) have a clock.
// The true "entered this status" date was never recorded, so this is an
// APPROXIMATION: updatedAt, else createdAt. New writes stamp it exactly.
// Dry run by default; --apply to write. Never overwrites an existing value.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'wolfy-481609' });
const { getFirestore } = require('firebase-admin/firestore');
const db = getFirestore('ai-agent-lib');

(async () => {
  const apply = process.argv.includes('--apply');
  const snap = await db.collection('agents').get();
  const todo = snap.docs.filter((d) => d.data().phaseSince == null);
  let fromUpdated = 0; let fromCreated = 0; let none = 0;
  const writes = [];
  for (const d of todo) {
    const a = d.data();
    const v = a.updatedAt || a.createdAt || null;
    if (!v) { none++; continue; }
    if (a.updatedAt) fromUpdated++; else fromCreated++;
    writes.push([d.ref, v]);
  }
  console.log(`agents ${snap.size} · missing phaseSince ${todo.length} · from updatedAt ${fromUpdated} · from createdAt ${fromCreated} · no date ${none}`);
  if (!apply) { console.log('dry run — pass --apply to write'); return; }
  for (let i = 0; i < writes.length; i += 400) {
    const b = db.batch();
    // phaseSince only — updatedAt is deliberately NOT touched, it is the source.
    writes.slice(i, i + 400).forEach(([ref, v]) => b.update(ref, { phaseSince: v }));
    await b.commit();
  }
  console.log(`wrote ${writes.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
