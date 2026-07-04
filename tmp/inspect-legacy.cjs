// Inspect why original (pre-this-session) migrated agents weren't picked
// up by backfill-createdby.cjs's "legacy + missing createdBy" filter.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const snap = await db.collection('agents').get();
  let withSourceRow = 0, withoutSourceRow = 0;
  let createdByEmpty = 0, createdByPresent = 0;
  const sample = [];

  snap.forEach((d) => {
    const data = d.data();
    if (data.sourceSheetRow !== undefined && data.sourceSheetRow !== null) withSourceRow++;
    else withoutSourceRow++;

    if (data.createdBy && String(data.createdBy).trim()) createdByPresent++;
    else createdByEmpty++;

    if (sample.length < 5 && data.agentName !== 'QA Orchestration') {
      sample.push({
        agentName: data.agentName,
        sourceSheetRow: data.sourceSheetRow,
        createdBy: data.createdBy,
        creator: data.creator,
      });
    }
  });

  console.log('Total docs:', snap.size);
  console.log('With sourceSheetRow:', withSourceRow);
  console.log('Without sourceSheetRow:', withoutSourceRow);
  console.log('With non-empty createdBy:', createdByPresent);
  console.log('With empty/missing createdBy:', createdByEmpty);
  console.log('');
  console.log('Sample docs:');
  sample.forEach((s) => console.log(JSON.stringify(s)));
})();
