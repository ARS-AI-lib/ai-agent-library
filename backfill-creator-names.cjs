// Backfill the `creator` DISPLAY field so it lists ALL of an agent's creators,
// not just the original submitter (2026-07-xx fix). Historically PreRegModal
// only wrote the submitter's name into `creator`, while the full team lives in
// `creatorEmails` — so cards/detail showed a single name. This resolves each
// creatorEmails entry to its display name via the Firestore directory cache
// (/config/directory) and joins them.
//
// Run in Cloud Shell (has ADC for wolfy-481609):  node backfill-creator-names.cjs
// Idempotent — re-running only rewrites docs whose `creator` differs.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

async function backfill() {
  const dirSnap = await db.doc('config/directory').get();
  if (!dirSnap.exists) {
    console.error('❌ /config/directory not found — run a directory sync first.');
    process.exit(1);
  }
  const people = dirSnap.data().people || [];
  const nameByEmail = new Map(people.map((p) => [(p.email || '').toLowerCase(), p.name || '']));
  console.log(`✓ Directory: ${people.length} people\n`);

  const agents = await db.collection('agents').get();
  console.log(`✓ Agents: ${agents.size} docs\n`);

  let updated = 0;
  let unresolved = 0;
  const batch = db.batch();

  agents.docs.forEach((doc) => {
    const a = doc.data();
    const emails = Array.isArray(a.creatorEmails) ? a.creatorEmails.filter(Boolean) : [];
    if (emails.length === 0) return; // nothing to derive from — leave as-is

    // Resolve each email → display name; fall back to the email's local-part
    // if the directory has no entry (so we never blank a creator out).
    const names = [];
    const seen = new Set();
    emails.forEach((e) => {
      const key = (e || '').toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      let name = nameByEmail.get(key);
      if (!name) { name = (e || '').split('@')[0]; unresolved++; }
      if (name) names.push(name);
    });

    const newCreator = names.join(', ');
    if (newCreator && newCreator !== a.creator) {
      updated++;
      batch.update(doc.ref, { creator: newCreator });
      if (updated <= 8) console.log(`  ✓ "${a.agentName}" → "${newCreator}"`);
    }
  });

  if (updated === 0) {
    console.log('✓ All `creator` fields already complete.');
    return;
  }
  console.log(`\n📝 Committing ${updated} updates (${unresolved} emails fell back to local-part)...`);
  await batch.commit();
  console.log(`✅ Done! ${updated}/${agents.size} updated`);
}

backfill().catch((err) => { console.error('❌ Error:', err.message); process.exit(1); });
