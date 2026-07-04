// Exports every doc in the `agents` collection to a CSV for manual editing
// (e.g. filling in creatorEmails for the pre-existing 154 agents). Re-import
// with import-agents-csv.cjs once edited — that script matches rows back by
// the `id` column, so DO NOT delete/reorder/retype that column.
//
// Run on Cloud Shell (has firebase-admin + gcloud application-default creds):
//   node export-agents-csv.cjs
// Writes agents-export-<timestamp>.csv in the current directory.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

// Column order — keep `id` first (import script keys off it).
const COLUMNS = [
  'id', 'agentName', 'description', 'aiAgent', 'skillMd', 'owner',
  'coreAbility', 'relatedRole', 'customerFacing', 'internalUse',
  'reusable', 'reuseCondition', 'hml', 'humanJob', 'tool', 'llm',
  'dataPrivacy', 'sdlcStage', 'sdlcProcessMapping', 'useCase',
  'input', 'output', 'businessValue', 'developmentPhase', 'devProgress',
  'deploymentStatus', 'launchDate', 'approvalStatus', 'approvedBy',
  'creator', 'creatorEmails', 'createdBy', 'matchingAgent',
];

function toDateStr(v) {
  if (!v) return '';
  try {
    const d = v.toDate ? v.toDate() : new Date(v);
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

// Arrays are joined with '; ' — the matching import script splits on the same
// delimiter, so edit list-type cells with that separator, not commas.
function cellValue(field, raw) {
  if (raw == null) return '';
  if (field === 'launchDate') return toDateStr(raw);
  if (typeof raw === 'boolean') return raw ? 'TRUE' : 'FALSE';
  if (Array.isArray(raw)) return raw.join('; ');
  return String(raw);
}

// Minimal RFC4180 quoting — wrap in quotes and escape embedded quotes
// whenever the cell contains a comma, quote, or newline.
function csvCell(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  console.log('Reading agents collection...');
  const snap = await db.collection('agents').get();
  console.log(`✓ Got ${snap.size} docs\n`);

  const lines = [COLUMNS.map(csvCell).join(',')];
  snap.docs.forEach((doc) => {
    const data = doc.data();
    const row = COLUMNS.map((col) => {
      const raw = col === 'id' ? doc.id : data[col];
      return csvCell(cellValue(col, raw));
    });
    lines.push(row.join(','));
  });

  const filename = `agents-export-${new Date().toISOString().slice(0, 10)}.csv`;
  fs.writeFileSync(filename, lines.join('\r\n'), 'utf8');
  console.log(`✓ Wrote ${filename} (${snap.size} rows)`);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
