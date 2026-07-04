// Exports the synced Workspace directory (/config/directory — see
// src/lib/directory.js) to a CSV of name + email. This is the same list the
// "Creator / Team member" picker searches; useful for cross-checking against
// the agents export when backfilling creatorEmails.
//
// Run on Cloud Shell:
//   node export-directory-csv.cjs
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

function csvCell(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  console.log('Reading /config/directory...');
  const snap = await db.collection('config').doc('directory').get();
  if (!snap.exists) {
    console.error('❌ /config/directory does not exist yet — sync it first via User Management → "Sync directory now".');
    process.exit(1);
  }
  const people = snap.data()?.people || [];
  console.log(`✓ Got ${people.length} people\n`);

  const lines = ['name,email'];
  people
    .slice()
    .sort((a, b) => (a.email || '').localeCompare(b.email || ''))
    .forEach((p) => lines.push([csvCell(p.name), csvCell(p.email)].join(',')));

  const filename = `directory-export-${new Date().toISOString().slice(0, 10)}.csv`;
  fs.writeFileSync(filename, lines.join('\r\n'), 'utf8');
  console.log(`✓ Wrote ${filename} (${people.length} rows)`);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
