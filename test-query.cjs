const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

async function test() {
  const snap = await db.collection('agents').where('approvalStatus', '==', 'approved').get();
  console.log(`✅ Query result: ${snap.size} documents with approvalStatus='approved'`);
  if (snap.size > 0) {
    const first = snap.docs[0].data();
    console.log(`Sample: ${first.agentName}`);
  }
}

test().catch(console.error);
