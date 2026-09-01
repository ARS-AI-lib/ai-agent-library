// One-off: strip `expireAt` from existing endpoint events (2026-08-26).
//
//   node functions/backfill-endpoint-event-ttl.cjs           # dry run
//   node functions/backfill-endpoint-event-ttl.cjs --apply
//
// WHY. recordAgentEvent stamped every marker with expireAt = now + 90 days for
// a future TTL policy. That is fine for `detail`/`search`, which are telemetry
// — but `endpoint` markers are now the source of the Agent/Skill Usage report,
// where the column is literally "Adopted date". If anyone ever enables the TTL
// policy on /agentEvents, adoption history older than 90 days would vanish
// silently and the report would quietly start lying about when people began
// using things.
//
// recordAgentEvent no longer writes the field for `endpoint`; this clears the
// ones already written. Measured at the time: 42 endpoint markers, all 42
// carrying expireAt.
//
// Deliberately does NOT touch detail/search markers.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('agentEvents').where('kind', '==', 'endpoint').get();
  const targets = snap.docs.filter((d) => d.data().expireAt);

  console.log(`=== endpoint markers: ${snap.size} · carrying expireAt: ${targets.length} ===`);
  targets.slice(0, 8).forEach((d) => {
    const e = d.data();
    const exp = e.expireAt?.toDate ? e.expireAt.toDate().toISOString().slice(0, 10) : String(e.expireAt);
    console.log(`  ${d.id}   (would expire ${exp})`);
  });
  if (targets.length > 8) console.log(`  … and ${targets.length - 8} more`);

  // Sanity: the other kinds must be left alone.
  const others = await db.collection('agentEvents').where('kind', 'in', ['detail', 'search']).get();
  console.log(`\n  detail/search markers left untouched: ${others.size}`);

  if (!APPLY) {
    console.log('\nDRY RUN — re-run with --apply to write.');
    return;
  }
  if (!targets.length) {
    console.log('\nNothing to do.');
    return;
  }

  // Chunked: batch() caps at 500 writes.
  for (let i = 0; i < targets.length; i += 400) {
    const batch = db.batch();
    targets.slice(i, i + 400).forEach((d) => batch.update(d.ref, { expireAt: FieldValue.delete() }));
    await batch.commit();
  }
  console.log(`\n✓ expireAt removed from ${targets.length} endpoint marker(s)`);
})();
