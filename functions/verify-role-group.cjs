// Run before deploying classifyRoleGroup. Offline — no Firestore, no Vertex.
//   node functions/verify-role-group.cjs
const fs = require('fs');
const path = require('path');
const R = require('./roleGroupRules');

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fail += 1; };

// 1. Keys must equal ROLE_GROUP_ORDER in the client (functions can't import src/).
const src = fs.readFileSync(path.join(__dirname, '../src/lib/roleGroups.js'), 'utf8');
const m = src.match(/export const ROLE_GROUP_ORDER = \[([\s\S]*?)\];/);
const clientKeys = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
ok(JSON.stringify(clientKeys) === JSON.stringify(R.ROLE_GROUP_KEYS), `ROLE_GROUP_KEYS == src ROLE_GROUP_ORDER (${clientKeys.length}/15)`);

// 2. Prompt carries the v5 evidence order and the SIT definition.
ok(/1\) name[\s\S]*2\) description[\s\S]*3\) relatedRole[\s\S]*4\) output/.test(R.ROLE_GROUP_SYSTEM), 'prompt order: name > description > relatedRole > output');
ok(/TBC/.test(R.ROLE_GROUP_SYSTEM), 'prompt handles TBC descriptions');
ok(/"Tester" role is the SIT-TQM team/.test(R.ROLE_GROUP_SYSTEM), 'prompt: Tester = SIT-TQM');
ok(JSON.stringify(R.ROLE_GROUP_SCHEMA.items.properties.primary.enum) === JSON.stringify(R.ROLE_GROUP_KEYS), 'schema primary enum = 15 keys');

// 3. Never overwrite a stored roleGroup.
ok(R.needsRoleGroup({ approvalStatus: 'approved' }) === true, 'approved without roleGroup -> classify');
ok(R.needsRoleGroup({ approvalStatus: 'approved', roleGroup: 'UX/UI' }) === false, 'stored roleGroup -> skip (no overwrite)');
ok(R.needsRoleGroup({ approvalStatus: 'approved', roleGroup: 'UX/UI', roleGroupSource: 'admin' }) === false, 'admin override -> skip');
ok(R.needsRoleGroup({ approvalStatus: 'pending' }) === false, 'pending -> skip');
ok(R.needsRoleGroup({ approvalStatus: 'approved', archived: true }) === false, 'archived -> skip');

// 4. Sanitizer drops invented groups / unknown ids and de-dupes secondary.
const t = [{ id: 'a' }, { id: 'b' }];
const s = R.sanitizeResults([
  { id: 'a', primary: 'UX/UI', secondary: ['UX/UI', 'Software Engineer', 'Made Up', 'SIT', 'UAT'], reason: 'x' },
  { id: 'b', primary: 'Wizard', secondary: [], reason: 'y' },
  { id: 'zzz', primary: 'UX/UI', secondary: [], reason: 'z' },
], t);
ok(s.a && s.a.primary === 'UX/UI' && JSON.stringify(s.a.secondary) === '["Software Engineer","SIT"]', 'secondary: drop primary/unknown, max 2');
ok(!s.b, 'invented primary rejected');
ok(!s.zzz, 'unrequested id ignored');

// 5. Baseline examples come only from classified items and exclude targets.
const ex = R.pickExamples(
  [{ id: 'n', relatedRole: ['Tester'], category: ['SIT'] }],
  [
    { id: 'n', roleGroup: 'SIT', relatedRole: ['Tester'] },
    { id: 'p', roleGroup: 'SIT', relatedRole: ['Tester'] },
    { id: 'q', roleGroup: 'UX/UI', relatedRole: ['UI Designer'] },
    { id: 'r', roleGroup: 'Bogus', relatedRole: ['Tester'] },
  ],
);
ok(ex.map((e) => e.id).join() === 'p', 'examples: similar + classified only, target excluded');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
