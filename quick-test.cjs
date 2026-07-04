const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');
(async () => {
  const agents = await db.collection('agents').get();
  console.log('Sample 3 agents:');
  let i = 0;
  agents.forEach(doc => {
    if (i >= 3) return;
    const a = doc.data();
    console.log(`${++i}. "${a.agentName}": sdlcProcessMapping = ${JSON.stringify(a.sdlcProcessMapping)}`);
  });
  const map = new Map();
  agents.forEach(doc => {
    const procs = Array.isArray(doc.data().sdlcProcessMapping) ? doc.data().sdlcProcessMapping : [];
    procs.forEach(p => map.set(p, (map.get(p)||0)+1));
  });
  console.log('\nTop 5 processes by agent count:');
  Array.from(map).sort((a,b)=>b[1]-a[1]).slice(0,5).forEach(([p,c]) => console.log(`  ${p}: ${c}`));
  console.log(`\nProcesses with agents: ${map.size}/57`);
})();
