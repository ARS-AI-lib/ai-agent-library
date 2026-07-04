// Reads a CSV produced (and hand-edited) from export-agents-csv.cjs and
// writes back ONLY the fields that actually changed per row (diff-only —
// untouched cells never overwrite Firestore, even if Excel reformatted them
// slightly differently than the original export).
//
// Usage (Cloud Shell):
//   node import-agents-csv.cjs agents-export-2026-07-04.csv --dry-run   # preview only, no writes
//   node import-agents-csv.cjs agents-export-2026-07-04.csv             # actually update
//
// Row matching is by the `id` column — do not delete/retype it in the CSV.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const fs = require('fs');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

const ARRAY_FIELDS = new Set(['coreAbility', 'relatedRole', 'sdlcStage', 'sdlcProcessMapping', 'creatorEmails']);
const BOOL_FIELDS = new Set(['aiAgent', 'skillMd', 'customerFacing', 'internalUse', 'hml']);
const NUMBER_FIELDS = new Set(['devProgress']);
const DATE_FIELDS = new Set(['launchDate']);
// Never diffed/written even if present as a column — id is the key, not a field.
const SKIP_FIELDS = new Set(['id']);

// ── Character-by-character CSV parser (per project convention: handles
// quoted fields containing commas/newlines, not a naive split(',')). ──
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      cell += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { row.push(cell); cell = ''; i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; continue; }
    cell += c; i += 1;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

function parseCellValue(field, str) {
  if (ARRAY_FIELDS.has(field)) {
    return str.split(';').map((s) => s.trim()).filter(Boolean);
  }
  if (BOOL_FIELDS.has(field)) return str.trim().toUpperCase() === 'TRUE';
  if (NUMBER_FIELDS.has(field)) {
    const n = parseInt(str.replace('%', '').trim(), 10);
    return isNaN(n) ? 0 : n;
  }
  if (DATE_FIELDS.has(field)) {
    if (!str.trim()) return null;
    const d = new Date(str.trim());
    return isNaN(d) ? null : Timestamp.fromDate(d);
  }
  return str;
}

// Firestore's own value for a field, normalized to the SAME shape the CSV
// cell parses into — so comparison is apples-to-apples (e.g. array order,
// Timestamp vs Date, number vs string).
function currentValueFor(field, data) {
  const raw = data[field];
  if (ARRAY_FIELDS.has(field)) return Array.isArray(raw) ? raw : (raw ? [raw] : []);
  if (BOOL_FIELDS.has(field)) return raw === true;
  if (NUMBER_FIELDS.has(field)) {
    const n = typeof raw === 'number' ? raw : parseInt(String(raw || '').replace('%', ''), 10);
    return isNaN(n) ? 0 : n;
  }
  if (DATE_FIELDS.has(field)) {
    if (!raw) return null;
    const d = raw.toDate ? raw.toDate() : new Date(raw);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  return raw == null ? '' : String(raw);
}

function valuesEqual(field, csvVal, curVal) {
  if (ARRAY_FIELDS.has(field)) {
    if (csvVal.length !== curVal.length) return false;
    return csvVal.every((v, i) => v === curVal[i]);
  }
  if (DATE_FIELDS.has(field)) {
    const csvStr = csvVal ? csvVal.toDate().toISOString().slice(0, 10) : null;
    return csvStr === curVal;
  }
  return csvVal === curVal;
}

async function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!file) {
    console.error('Usage: node import-agents-csv.cjs <file.csv> [--dry-run]');
    process.exit(1);
  }

  const text = fs.readFileSync(file, 'utf8');
  const rows = parseCsv(text);
  const header = rows[0];
  const idIdx = header.indexOf('id');
  if (idIdx === -1) throw new Error('CSV missing required "id" column');

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Read ${rows.length - 1} rows from ${file}\n`);

  let changedDocs = 0;
  let changedFields = 0;
  let missing = 0;
  let created = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const id = row[idIdx];

    // Blank id = a brand-new row (not in Firestore yet) — CREATE it instead of
    // diffing. Every non-skip column is written as-is; fields the app itself
    // manages (createdAt/updatedAt) are stamped fresh here.
    if (!id) {
      const doc = {};
      header.forEach((field, i) => {
        if (SKIP_FIELDS.has(field)) return;
        doc[field] = parseCellValue(field, row[i] ?? '');
      });
      const label = doc.agentName || `row ${r + 1}`;
      if (dryRun) {
        console.log(`[DRY RUN] Would CREATE new doc — ${label}`);
      } else {
        const ref = await db.collection('agents').add({ ...doc, createdAt: new Date(), updatedAt: new Date() });
        console.log(`✓ Created ${label} → id ${ref.id} (write this back into the "id" column so future imports diff it instead of re-creating)`);
      }
      created += 1;
      continue;
    }

    const ref = db.collection('agents').doc(id);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`⚠️  Skipped — no such doc: ${id}`); missing += 1; continue; }
    const data = snap.data();

    const patch = {};
    header.forEach((field, i) => {
      if (SKIP_FIELDS.has(field)) return;
      const csvVal = parseCellValue(field, row[i] ?? '');
      const curVal = currentValueFor(field, data);
      if (!valuesEqual(field, csvVal, curVal)) {
        patch[field] = csvVal;
      }
    });

    const fields = Object.keys(patch);
    if (fields.length === 0) continue;

    changedDocs += 1;
    changedFields += fields.length;
    console.log(`${dryRun ? '[DRY RUN] ' : ''}${id} (${data.agentName || '?'}) — ${fields.join(', ')}`);

    if (!dryRun) {
      await ref.update({ ...patch, updatedAt: new Date() });
    }
  }

  console.log(`\n${dryRun ? '[DRY RUN] Would update' : 'Updated'} ${changedDocs} docs, ${changedFields} field changes total. ${created} new doc(s) ${dryRun ? 'would be created' : 'created'}.`);
  if (missing > 0) console.log(`⚠️  ${missing} row(s) had an id not found in Firestore — check for accidental edits to the id column.`);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
