// Guard the Usage report's pure helpers (2026-11-10).
//   node functions/verify-usage-page.cjs
//
// Same loader as verify-category-groups.cjs: strip import/export so the SHIPPED
// src/lib/usageReport.js is what gets tested. This module imports nothing.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'lib');
function loadEsm(file, injected = {}) {
  const code = fs
    .readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = `${code}\n;return { ${[...new Set(decls)].join(', ')} };`;
  return new Function(...names, body)(...names.map((n) => injected[n]));
}

const U = loadEsm('usageReport.js');
const { CSV_COLUMNS, CSV_HEADERS, groupUsageRows } = U;

let fails = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) {
    console.log('   got     :', JSON.stringify(a));
    console.log('   expected:', JSON.stringify(b));
    fails++;
  }
};

// 1-2. CSV columns: 8 keys, source gone
eq(CSV_COLUMNS, ['agentName', 'owner', 'area', 'category', 'adopterName', 'adopterEmail', 'project', 'adoptedDate'],
  'CSV_COLUMNS = 8 keys, no source');
eq(CSV_COLUMNS.includes('source'), false, 'source column removed from CSV');

// 3. headers renamed + Project / Task kept
eq(CSV_HEADERS, ['Agent/Skill Name', 'Owner', 'Area', 'Category', 'Adopter', 'Adopter Email', 'Project / Task', 'Adopted Date'],
  'CSV_HEADERS renamed + Project / Task kept');

// 4-7. grouping by agent — one bucket per AGENT ID, label = its name
const rows = [
  { agentId: 'A1', agentName: 'TC Writer', owner: 'Team A', adopterEmail: 'x@arise.tech' },
  { agentId: 'A1', agentName: 'TC Writer', owner: 'Team A', adopterEmail: 'y@arise.tech' },
  { agentId: 'B1', agentName: 'Guardrail', owner: 'Team B', adopterEmail: 'z@arise.tech' },
  { agentId: 'C1', agentName: '', owner: 'Team A', adopterEmail: 'w@arise.tech' },
];
const g = groupUsageRows(rows, 'agent');
eq(g.map((x) => x.label), ['TC Writer', 'Guardrail', '(no name)'],
  'groups sorted by size desc, empty name labeled (no name)');
eq(g[0].rows.map((r) => r.adopterEmail), ['x@arise.tech', 'y@arise.tech'],
  'input order kept inside a group');
eq(g[0].rows.length, 2, 'group row count = badge number');

// 8. 🔴 two DIFFERENT agents that share a name must NOT merge (spec: same agent)
const dup = [
  { agentId: 'P1', agentName: 'Copilot', owner: 'T', adopterEmail: 'a@arise.tech' },
  { agentId: 'P2', agentName: 'Copilot', owner: 'T', adopterEmail: 'b@arise.tech' },
];
const gd = groupUsageRows(dup, 'agent');
eq(gd.length, 2, 'distinct agents sharing a name stay in separate buckets');
eq(gd.every((x) => x.label === 'Copilot'), true, 'both duplicate-name buckets are labeled Copilot');
eq(gd.every((x) => x.rows.length === 1), true, 'each duplicate-name bucket holds only its own adopter');

// 9. two nameless DIFFERENT agents also stay separate (keyed by id, not the label)
eq(groupUsageRows([
  { agentId: 'N1', agentName: '', adopterEmail: 'p@arise.tech' },
  { agentId: 'N2', agentName: '', adopterEmail: 'q@arise.tech' },
], 'agent').length, 2, 'different nameless agents do not collapse into one bucket');

// 10-11. owner grouping + fallback + empty input
eq(groupUsageRows(rows, 'owner').map((x) => x.label), ['Team A', 'Team B'], 'owner grouping works');
eq(groupUsageRows([{ owner: '' }], 'owner')[0].label, '(no owner)', 'owner fallback bucket');
eq(groupUsageRows([], 'agent'), [], 'empty input → []');

if (fails) { console.error(`\n✗ ${fails} case(s) failed`); process.exit(1); }
console.log('\n✓ all usage-page cases pass');
