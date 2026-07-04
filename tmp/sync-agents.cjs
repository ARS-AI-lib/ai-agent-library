// Smart sync: Sheet CSV → Firestore `agents` collection.
// - Adds CSV rows whose agentName has no matching Firestore doc.
// - Deletes Firestore docs that came from the Sheet (have `sourceSheetRow`)
//   but whose agentName no longer appears in the CSV.
// - Never touches docs that match an existing agentName (preserves
//   approvalStatus/devProgress/createdBy/etc. set via the app UI), and
//   never touches docs without `sourceSheetRow` (Pre-Reg-created agents).
//
// Usage:
//   node tmp/sync-agents.cjs                 # dry run — prints the plan only
//   node tmp/sync-agents.cjs --apply         # actually writes to Firestore

const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const CSV_PATH = path.join(__dirname, 'agents-2026-06-30.csv');
const APPLY = process.argv.includes('--apply');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

// ── Minimal CSV parser (handles quoted fields with commas/newlines) ──
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

function bool(v) { return String(v).trim().toUpperCase() === 'TRUE'; }

function parseDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mo, da, yr] = m;
  return new Date(Number(yr), Number(mo) - 1, Number(da));
}

function rowToAgent(row, header, sheetRowNum) {
  const get = (name) => (row[header.indexOf(name)] || '').trim();
  return {
    owner: get('Team'),
    creator: get('Owner'),
    agentName: get('Agent Name'),
    description: get('Description'),
    aiAgent: bool(get('AI Agent')),
    skillMd: bool(get('Skill.md')),
    matchingAgent: get('Matching Agent'),
    customerFacing: bool(get('Customer facing')),
    internalUse: bool(get('Internal use')),
    reusable: get('Reusable'),
    reuseCondition: get('Reuse Conditions'),
    sdlcStage: get('SDLC Stage'),
    sdlcProcessMapping: get('SDLC Process Mapping'),
    useCase: get('Use case'),
    coreAbility: get('Core Ability'),
    relatedRole: get('Related Role'),
    hml: bool(get('HML')),
    humanJob: get('Human Job'),
    input: get('Input'),
    output: get('Output'),
    tool: get('Tool'),
    llm: get('LLM'),
    dataPrivacy: get('Data Privacy'),
    businessValue: get('Business Value'),
    evaluationMetric: get('Evaluation metric'),
    developmentPhase: get('Development Phase'),
    devProgress: get('Dev_Progress'),
    launchDate: parseDate(get('Launch Date')),
    remark: get('Remark'),
    // bookkeeping
    status: 'active',
    approvalStatus: 'approved',
    sourceSheetRow: sheetRowNum,
    matchingAgentSuggestion: '',
    createdBy: '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

(async () => {
  const raw = fs.readFileSync(CSV_PATH, 'utf-8').replace(/^﻿/, '');
  const rows = parseCSV(raw);
  const header = rows[0];
  const dataRows = rows.slice(1);

  const csvByName = new Map();
  dataRows.forEach((r, i) => {
    const name = (r[header.indexOf('Agent Name')] || '').trim();
    if (name) csvByName.set(name, { row: r, sheetRowNum: i + 2 }); // +2: header + 1-index
  });

  const snap = await db.collection('agents').get();
  const existingByName = new Map();
  snap.forEach((d) => existingByName.set(d.data().agentName, { id: d.id, data: d.data() }));

  const toInsert = [];
  for (const [name, { row, sheetRowNum }] of csvByName) {
    if (!existingByName.has(name)) {
      toInsert.push(rowToAgent(row, header, sheetRowNum));
    }
  }

  const toDelete = [];
  for (const [name, { id, data }] of existingByName) {
    if (data.sourceSheetRow !== undefined && data.sourceSheetRow !== null && !csvByName.has(name)) {
      toDelete.push({ id, name });
    }
  }

  console.log(`CSV rows: ${dataRows.length}`);
  console.log(`Existing Firestore agents: ${snap.size}`);
  console.log('');
  console.log(`=== TO INSERT (${toInsert.length}) ===`);
  toInsert.forEach((a) => console.log(`  + ${a.agentName}`));
  console.log('');
  console.log(`=== TO DELETE (${toDelete.length}) ===`);
  toDelete.forEach((a) => console.log(`  - ${a.name}`));
  console.log('');
  console.log(`Unchanged (already in both): ${existingByName.size - toDelete.length}`);

  if (!APPLY) {
    console.log('\n— DRY RUN — re-run with --apply to write these changes.');
    return;
  }

  console.log('\nApplying changes…');
  const batchSize = 400;
  for (let i = 0; i < toInsert.length; i += batchSize) {
    const batch = db.batch();
    toInsert.slice(i, i + batchSize).forEach((a) => {
      const ref = db.collection('agents').doc();
      batch.set(ref, a);
    });
    await batch.commit();
  }
  for (let i = 0; i < toDelete.length; i += batchSize) {
    const batch = db.batch();
    toDelete.slice(i, i + batchSize).forEach(({ id }) => {
      batch.delete(db.collection('agents').doc(id));
    });
    await batch.commit();
  }
  console.log(`✅ Inserted ${toInsert.length}, deleted ${toDelete.length}.`);
})();
