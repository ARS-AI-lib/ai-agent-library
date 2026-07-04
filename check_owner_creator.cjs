const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

async function check() {
  const snap = await db.collection('agents').limit(5).get();
  console.log(`\nตัวอย่าง 5 documents แรก:\n`);
  snap.forEach((doc, i) => {
    const d = doc.data();
    console.log(`${i+1}. "${d.agentName}"`);
    console.log(`   owner   = "${d.owner}"`);
    console.log(`   creator = "${d.creator}"`);
    console.log(`   เหมือนกัน? ${d.owner === d.creator ? '⚠️ YES' : '✅ NO'}\n`);
  });

  const all = await db.collection('agents').get();
  let same = 0, total = 0;
  all.forEach(doc => {
    const d = doc.data();
    if (d.owner && d.creator) {
      total++;
      if (d.owner === d.creator) same++;
    }
  });
  console.log(`\n========== SUMMARY ==========`);
  console.log(`Documents with owner === creator: ${same}/${total}`);
  console.log(`Conclusion: ${same === total ? '🔴 ALL SAME — migration bug!' : same > 0 ? '🟡 MIXED — some coincide' : '✅ ALL DIFFERENT — OK'}`);
}

check().catch(console.error);
