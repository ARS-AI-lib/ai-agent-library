const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');
(async () => {
  const snap = await db.collection('agents').where('approvalStatus','==','approved').limit(50).get();
  let sample = null;
  snap.forEach(d => {
    const x = d.data();
    if (x.sdlcProcessMapping && sample === null) sample = { id: d.id, ...x };
  });
  if (sample) {
    console.log('=== Keys ===');
    console.log(JSON.stringify(Object.keys(sample).sort(), null, 1));
    console.log('=== Values ===');
    console.log('sdlcProcessMapping:', JSON.stringify(sample.sdlcProcessMapping));
    console.log('developmentPhase:', JSON.stringify(sample.developmentPhase));
    console.log('devProgress:', JSON.stringify(sample.devProgress));
    console.log('progress:', JSON.stringify(sample.progress));
    console.log('status:', JSON.stringify(sample.status));
  } else {
    console.log('none found');
  }
})();