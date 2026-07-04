const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const https = require('https');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

function fetchSheetViz() {
  return new Promise((resolve, reject) => {
    const query = encodeURIComponent('SELECT A, B LIMIT 200');
    const url = `https://docs.google.com/spreadsheets/d/16UUi0oLkJr8YXu7J33-FvJxiEMUcE8cqyNHE4aYpfDc/gviz/tq?gid=236825970&headers=1&tq=${query}`;
    
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data.substring(data.indexOf('{'), data.lastIndexOf('}') + 1));
          const rows = (json.table?.rows || []).map(r => ({
            team: (r.c[0]?.v || '').trim(),
            owner: (r.c[1]?.v || '').trim()
          })).filter(r => r.team && r.owner);
          resolve(rows);
        } catch (e) {
          reject(new Error(`Parse failed: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

async function backfill() {
  console.log('Fetching Sheet via Visualization API...');
  const sheetRows = await fetchSheetViz();
  console.log(`✓ Got ${sheetRows.length} rows\n`);

  if (sheetRows.length === 0) {
    console.error('❌ No rows fetched from Sheet!');
    process.exit(1);
  }

  const agents = await db.collection('agents').get();
  console.log(`✓ Found ${agents.size} docs in Firestore\n`);

  let updated = 0;
  const batch = db.batch();
  const agentsArray = agents.docs;

  agentsArray.forEach((doc, idx) => {
    const agent = doc.data();
    const sheetRow = sheetRows[idx];
    
    if (!sheetRow) {
      console.log(`  ⚠️  #${idx+1} ${agent.agentName} — no matching row`);
      return;
    }

    const newOwner = sheetRow.team;
    const newCreator = sheetRow.owner;

    if (agent.owner !== newOwner || agent.creator !== newCreator) {
      updated++;
      batch.update(doc.ref, { owner: newOwner, creator: newCreator });
      if (updated <= 5) {
        console.log(`  ✓ #${idx+1} "${agent.agentName}" → owner="${newOwner}" creator="${newCreator}"`);
      }
    }
  });

  if (updated === 0) {
    console.log('✓ All correct already!');
    return;
  }

  console.log(`\n📝 Committing ${updated} updates...`);
  await batch.commit();
  console.log(`✅ Done! ${updated}/${agentsArray.length} updated`);
}

backfill().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
