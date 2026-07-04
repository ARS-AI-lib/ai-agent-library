// SDLC Catalog Migration Script
// Migrates:
//   1. /sdlcProcesses — 57 hardcoded processes (faithful port of ADOPT_GROUPS from legacy HTML)
//      + owner/creator backfilled from the SDLC sheet (gid=1166115430)
//   2. /sdlcUseCases  — Use Case rows from the same sheet, linked to their processId
//
// Source of truth for the 57-process catalog: legacy Agent-lib.html ADOPT_GROUPS (lines 992-1045)
// Source of truth for use cases: Google Sheet "SDLC" tab (gid=1166115430), columns:
//   A=Group, B=Stage, C=Process, D=Use Case, E=Creator, F=Owner
//
// Safe to re-run: process IDs are stable (e.g. "1.1"), so .set() overwrites cleanly.
// Use Case IDs (UC001, UC002, ...) are assigned in sheet-row order — if the sheet's row
// order changes between runs, IDs will shift. Acceptable since this is meant to be re-run
// after editing the Sheet (no Admin CRUD UI for catalog, per Round 3 decision).

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const https = require('https');

const app = initializeApp({ projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

const SHEET_ID = '16UUi0oLkJr8YXu7J33-FvJxiEMUcE8cqyNHE4aYpfDc';
const SDLC_GID = '1166115430';

// ── Hardcoded process catalog: [group, stage, id, name] — faithful port of ADOPT_GROUPS ──
const PROCESS_CATALOG = [
  // Discovery > Initiation
  ['Discovery', 'Initiation', '1.1', 'Feasibility Study'],
  ['Discovery', 'Initiation', '1.2', 'Deep Research & Benchmark'],
  ['Discovery', 'Initiation', '1.3', 'Proposal and TOR'],
  ['Discovery', 'Initiation', '1.4', 'Legal & Compliance'],
  ['Discovery', 'Initiation', '1.5', 'Requirement Exploration'],
  ['Discovery', 'Initiation', '1.6', 'Project Initiation & Resource Planning'],
  // Discovery > Discovery
  ['Discovery', 'Discovery', '2.1', 'Requirement Gathering'],
  ['Discovery', 'Discovery', '2.2', 'High-level User Story Development'],
  // Development > Design
  ['Development', 'Design', '3.1', 'User Experience Research'],
  ['Development', 'Design', '3.2', 'User Journey Design'],
  ['Development', 'Design', '3.3', 'User Interface Design (Low-fi)'],
  ['Development', 'Design', '4.1', 'High-level Design'],
  ['Development', 'Design', '4.2', 'Effort Estimation'],
  ['Development', 'Design', '5.1', 'Data Insight & Analysis'],
  ['Development', 'Design', 'Data Requirement Gathering', 'Data Requirement Gathering'],
  ['Development', 'Design', 'DevOps', 'DevOps'],
  // Development > Build
  ['Development', 'Build', '6.1', 'Ideation & Planning'],
  ['Development', 'Build', '6.2', 'Project Governance'],
  ['Development', 'Build', '7.1', 'Detailed User Story Development'],
  ['Development', 'Build', '7.2', 'Development Support'],
  ['Development', 'Build', '7.3', 'Test Support'],
  ['Development', 'Build', '7.4', 'Deployment Support'],
  ['Development', 'Build', '8.1', 'User Interface Design (Hi-fi)'],
  ['Development', 'Build', '8.2', 'Copywriting'],
  ['Development', 'Build', '9.1', 'Detailed Design'],
  ['Development', 'Build', '10.1', 'Development'],
  ['Development', 'Build', '10.2', 'Unit Test'],
  ['Development', 'Build', '10.3', 'Code Review'],
  ['Development', 'Build', '10.4', 'Test Support'],
  ['Development', 'Build', 'NFR Gathering', 'NFR Gathering'],
  ['Development', 'Build', 'Performance Test Scripting', 'Performance Test Scripting'],
  ['Development', 'Build', 'Penetration Test Scenario Development', 'Penetration Test Scenario Development'],
  ['Development', 'Build', 'Penetration Test Execution', 'Penetration Test Execution'],
  ['Development', 'Build', 'Environment Provisioning', 'Environment Provisioning'],
  ['Development', 'Build', 'CI/CD Pipeline Development', 'CI/CD Pipeline Development'],
  ['Development', 'Build', 'Data Development', 'Data Development'],
  ['Development', 'Build', 'Data Test Support', 'Data Test Support'],
  // Development > Test
  ['Development', 'Test', '11.1', 'Test Approach'],
  ['Development', 'Test', '11.2', 'Test Case Development'],
  ['Development', 'Test', '11.3', 'Defect Management'],
  ['Development', 'Test', '12.1', 'SIT Test Data Preparation'],
  ['Development', 'Test', '12.2', 'SIT Test Execution'],
  ['Development', 'Test', '13.1', 'UAT Test Data Preparation'],
  ['Development', 'Test', '13.2', 'UAT Test Execution'],
  // Development > Deployment
  ['Development', 'Deployment', '14.1', 'Runbook Development'],
  ['Development', 'Deployment', '14.2A', 'IVT Test Case Development'],
  ['Development', 'Deployment', '14.2B', 'PVT Test Case Development'],
  ['Development', 'Deployment', '14.3A', 'IVT Test Case Execution'],
  ['Development', 'Deployment', '14.3B', 'PVT Test Case Execution'],
  ['Development', 'Deployment', '14.4', 'CAB Document & Presentation'],
  // After Development > Post Development
  ['After Development', 'Post Development', 'Incident Management', 'Incident Management'],
  ['After Development', 'Post Development', 'Problem Management', 'Problem Management'],
  ['After Development', 'Post Development', 'E2E Monitoring', 'E2E Monitoring'],
  ['After Development', 'Post Development', 'Capacity Planning', 'Capacity Planning'],
  ['After Development', 'Post Development', 'FinOps', 'FinOps'],
  ['After Development', 'Post Development', 'Capacity Monitoring', 'Capacity Monitoring'],
  ['After Development', 'Post Development', 'Self Repairing', 'Self Repairing'],
];

console.log(`Hardcoded catalog: ${PROCESS_CATALOG.length} processes\n`);

// ── Helpers ──

// Strips zero-width spaces / BOM and collapses whitespace — the raw Sheet has \u200b
// littered through free-text process names (e.g. "DevOps\u200b", "FinOps\u200b").
function cleanText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Same regex as legacy HTML's extractProcessId() — numeric "1.1"/"14.2A" prefix wins;
// otherwise the whole (cleaned) string is the id.
function extractProcessId(s) {
  const t = cleanText(s);
  if (!t) return '';
  const m = t.match(/^(\d+\.\d+[A-Za-z]?)\b/);
  return m ? m[1] : t;
}

function fetchSheetViz(gid, query) {
  return new Promise((resolve, reject) => {
    const q = encodeURIComponent(query);
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?gid=${gid}&headers=1&tq=${q}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data.substring(data.indexOf('{'), data.lastIndexOf('}') + 1));
          resolve(json.table);
        } catch (e) {
          reject(new Error(`Parse failed: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function cellVal(cell) {
  return cell && cell.v != null ? cleanText(cell.v) : '';
}

async function commitInChunks(db, ops) {
  // ops: array of {ref, data}
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach(({ ref, data }) => batch.set(ref, data));
    await batch.commit();
  }
}

async function main() {
  console.log('Fetching SDLC catalog sheet (gid=1166115430)...');
  const table = await fetchSheetViz(SDLC_GID, 'SELECT A,B,C,D,E,F');
  const rawRows = (table.rows || []).map(r => ({
    group: cellVal(r.c[0]),
    stage: cellVal(r.c[1]),
    process: cellVal(r.c[2]),
    useCase: cellVal(r.c[3]),
    creator: cellVal(r.c[4]),
    owner: cellVal(r.c[5]),
  })).filter(r => r.process);
  console.log(`✓ ${rawRows.length} raw rows fetched\n`);

  // ── Build process map: hardcoded catalog first, then backfill owner/creator from sheet ──
  const processMap = new Map(); // id -> { id, name, stage, group, creator, owner }
  PROCESS_CATALOG.forEach(([group, stage, id, name]) => {
    processMap.set(id, { id, name, stage, group, creator: '', owner: '' });
  });

  let unmatchedProcesses = new Set();
  const useCaseMap = new Map(); // key: processId|||useCaseName -> {id, name, processId, processName, creator, owner}
  let ucCounter = 0;

  rawRows.forEach(r => {
    const procId = extractProcessId(r.process);
    let proc = processMap.get(procId);

    if (!proc) {
      // Process string from the Sheet didn't match the hardcoded catalog (typo, new process, etc.)
      unmatchedProcesses.add(`"${r.process}" → id="${procId}"`);
      proc = { id: procId, name: r.process, stage: r.stage, group: r.group, creator: '', owner: '' };
      processMap.set(procId, proc);
    }

    // First-non-empty-wins, same convention as legacy parseSDLCSheet()
    if (r.creator && !proc.creator) proc.creator = r.creator;
    if (r.owner && !proc.owner) proc.owner = r.owner;

    if (r.useCase) {
      const key = `${procId}|||${r.useCase}`;
      if (!useCaseMap.has(key)) {
        ucCounter++;
        // Sanitize process ID for use case's processId field too
        const sanitizedProcId = procId.replace(/\//g, '_');
        useCaseMap.set(key, {
          id: `UC${String(ucCounter).padStart(3, '0')}`,
          name: r.useCase,
          processId: sanitizedProcId,
          processName: proc.name,
          creator: r.creator || '',
          owner: r.owner || '',
        });
      }
    }
  });

  console.log(`✓ Processes total: ${processMap.size} (${PROCESS_CATALOG.length} hardcoded + ${processMap.size - PROCESS_CATALOG.length} extra found in Sheet)`);
  console.log(`✓ Use Cases (deduped by process+name): ${useCaseMap.size}\n`);

  if (unmatchedProcesses.size) {
    console.log(`⚠️  Process strings in Sheet that didn't match the hardcoded catalog (added as extra):`);
    unmatchedProcesses.forEach(s => console.log(`   - ${s}`));
    console.log('');
  }

  // ── Write /sdlcProcesses ──
  console.log('Writing /sdlcProcesses...');
  const procOps = Array.from(processMap.values()).map(proc => {
    // Sanitize ID: free-text processes (e.g. "CI/CD Pipeline Development") have slashes
    // which aren't allowed in Firestore doc IDs — replace with underscores
    const sanitizedId = proc.id.replace(/\//g, '_');
    return {
      ref: db.collection('sdlcProcesses').doc(sanitizedId),
      data: {
        id: sanitizedId, // store the sanitized version for consistency
        name: proc.name,
        stage: proc.stage,
        group: proc.group,
        creator: proc.creator,
        owner: proc.owner,
      },
    };
  });
  await commitInChunks(db, procOps);
  console.log(`✅ ${procOps.length} processes written\n`);

  // ── Write /sdlcUseCases ──
  console.log('Writing /sdlcUseCases...');
  const ucOps = Array.from(useCaseMap.values()).map(uc => ({
    ref: db.collection('sdlcUseCases').doc(uc.id),
    data: uc,
  }));
  await commitInChunks(db, ucOps);
  console.log(`✅ ${ucOps.length} use cases written\n`);

  console.log('🎉 SDLC catalog migration complete!');
  console.log(`   /sdlcProcesses: ${procOps.length} docs`);
  console.log(`   /sdlcUseCases:  ${ucOps.length} docs`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
