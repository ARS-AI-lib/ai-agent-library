// Cleanup script — finds and deletes old versions of Copilot + Skills
// agents before re-inserting the revised versions.
//
// This handles any stale names from earlier iterations:
//   - "Library Copilot" (old name, now: "AI Agent Library Copilot")
//   - "connection_suggest" (old name, now: "agent_library_connection_suggest")
//   - "search_library", "duplicate_check", "get_agent_detail" (no name change but may exist)
//   - "AI Agent Library Chat Assistant" (new placeholder)
//
// Dry-run by default. Pass --apply to delete.
//
// Usage:
//   node cleanup-old-copilot-agents.cjs            # dry run
//   node cleanup-old-copilot-agents.cjs --apply    # delete matching docs

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

// Names to look for and delete (covers old + new naming)
const AGENT_NAMES_TO_DELETE = [
  'Library Copilot',                          // old name
  'AI Agent Library Copilot',                 // new name (in case already inserted)
  'search_library',
  'duplicate_check',
  'connection_suggest',                       // old name
  'agent_library_connection_suggest',         // new name (in case already inserted)
  'get_agent_detail',
  'AI Agent Library Chat Assistant',
];

async function run() {
  const snap = await db.collection('agents').get();
  const allDocs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const toDelete = allDocs.filter((doc) =>
    AGENT_NAMES_TO_DELETE.includes((doc.agentName || '').trim())
  );

  if (toDelete.length === 0) {
    console.log('ไม่พบ docs ที่ต้องลบ — เตรียมพร้อมแล้ว');
    return;
  }

  console.log(`พบ ${toDelete.length} docs ที่จะลบ:\n`);
  toDelete.forEach((doc) => {
    console.log(`  ❌ "${doc.agentName}" (${doc.id})`);
  });

  if (APPLY) {
    console.log('\nกำลังลบ...');
    const batch = db.batch();
    toDelete.forEach((doc) => {
      batch.delete(db.collection('agents').doc(doc.id));
    });
    await batch.commit();
    console.log(`✅ ลบสำเร็จ ${toDelete.length} docs`);
  } else {
    console.log(`\nℹ️  Dry run เท่านั้น — รันใหม่พร้อม --apply เพื่อลบจริง`);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
