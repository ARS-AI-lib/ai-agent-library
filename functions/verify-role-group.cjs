// Run before deploying classifyRoleGroup / manageRoleGroups. Offline — no Firestore, no Vertex.
//   node functions/verify-role-group.cjs
const fs = require('fs');
const path = require('path');
const R = require('./roleGroupRules');
const A = require('./roleGroupAdminRules');

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fail += 1; };
const G = A.DEFAULT_ROLE_GROUPS;
const KEYS = R.keysOf(G);

// ── Defaults match what the client falls back to (src/lib/roleGroups.js) ──
const src = fs.readFileSync(path.join(__dirname, '../src/lib/roleGroups.js'), 'utf8');
const m = src.match(/export const ROLE_GROUP_ORDER = \[([\s\S]*?)\];/);
const clientKeys = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
ok(JSON.stringify(clientKeys) === JSON.stringify(KEYS), `default keys == client fallback ROLE_GROUP_ORDER (${clientKeys.length})`);
ok(!A.validateGroups(G).error, 'default groups validate');

// ── Prompt (v5) built from config ──
const sys = R.buildSystem(G);
ok(/1\) name[\s\S]*2\) description[\s\S]*3\) relatedRole[\s\S]*4\) output/.test(sys), 'prompt order: name > description > relatedRole > output');
ok(/"Tester" role is the SIT-TQM team/.test(sys), 'group definitions reach the prompt');
ok(JSON.stringify(R.buildSchema(G).items.properties.primary.enum) === JSON.stringify(KEYS), 'schema enum = configured keys');
const custom = [...G, { key: 'Legal', label: 'Legal', roles: ['Lawyer'], definition: 'legal review' }];
ok(R.buildSchema(custom).items.properties.primary.enum.includes('Legal') && /Legal = legal review/.test(R.buildSystem(custom)), 'a new group reaches enum + prompt');

// ── Never overwrite ──
ok(R.needsRoleGroup({ approvalStatus: 'approved' }, KEYS) === true, 'approved without roleGroup -> classify');
ok(R.needsRoleGroup({ approvalStatus: 'approved', roleGroup: 'UX/UI' }, KEYS) === false, 'stored roleGroup -> skip');
ok(R.needsRoleGroup({ approvalStatus: 'pending' }, KEYS) === false, 'pending -> skip');
ok(R.needsRoleGroup({ approvalStatus: 'approved', archived: true }, KEYS) === false, 'archived -> skip');

// ── Sanitizer ──
const s = R.sanitizeResults([
  { id: 'a', primary: 'UX/UI', secondary: ['UX/UI', 'Software Engineer', 'Made Up', 'SIT', 'UAT'], reason: 'x' },
  { id: 'b', primary: 'Wizard', secondary: [], reason: 'y' },
], [{ id: 'a' }, { id: 'b' }], KEYS);
ok(s.a && JSON.stringify(s.a.secondary) === '["Software Engineer","SIT"]', 'secondary: drop primary/unknown, max 2');
ok(!s.b, 'invented primary rejected');
const ex = R.pickExamples([{ id: 'n', relatedRole: ['Tester'] }], [
  { id: 'n', roleGroup: 'SIT', relatedRole: ['Tester'] },
  { id: 'p', roleGroup: 'SIT', relatedRole: ['Tester'] },
  { id: 'r', roleGroup: 'Bogus', relatedRole: ['Tester'] },
], KEYS);
ok(ex.map((e) => e.id).join() === 'p', 'examples: classified + similar only, target excluded');

// ── Management actions ──
const up = (g) => A.applyAction(G, { type: 'upsertGroup', group: g });
ok(up({ label: 'UX/UI', roles: [], definition: 'x' }).error, 'reject duplicate group name');
ok(up({ label: 'QA Team', roles: ['qa engineer'], definition: 'x' }).error?.includes('already in group'), 'reject role already in another group (case/space folded)');
ok(up({ label: 'Empty Def', roles: [], definition: '' }).error, 'reject empty definition');
const added = up({ label: 'Legal', roles: ['Lawyer', 'lawyer'], definition: 'legal review' });
ok(!added.error && added.groups.at(-1).key === 'Legal' && added.groups.at(-1).roles.length === 1, 'add group: new key, roles de-duplicated');
const renamed = up({ key: 'SIT', label: 'SIT Team', roles: ['Tester', 'SIT'], definition: 'sit' });
ok(!renamed.error && renamed.groups.find((g) => g.key === 'SIT').label === 'SIT Team', 'rename keeps key (stored roleGroup unaffected)');
ok(A.applyAction(G, { type: 'deleteGroup', key: 'UAT' }).error, 'delete without target -> error');
ok(A.applyAction(G, { type: 'deleteGroup', key: 'UAT', moveTo: 'UAT' }).error, 'delete into itself -> error');
const del = A.applyAction(G, { type: 'deleteGroup', key: 'UAT', moveTo: 'SIT' });
ok(!del.error && del.groups.length === 14 && del.moves.to === 'SIT', 'delete with target -> group gone + move planned');
ok(A.applyAction([G[0]], { type: 'deleteGroup', key: G[0].key, moveTo: 'x' }).error, 'cannot delete the last group');
ok(A.applyAction(G, { type: 'reorder', keys: KEYS.slice(1) }).error, 'reorder must list every group');
ok(!A.applyAction(G, { type: 'reorder', keys: [...KEYS].reverse() }).error, 'reorder full list ok');
const rc = A.reclassifyTargets([
  { id: 1, roleGroup: 'SIT', roleGroupSource: 'ai', approvalStatus: 'approved' },
  { id: 2, roleGroup: 'SIT', roleGroupSource: 'admin', approvalStatus: 'approved' },
  { id: 3, roleGroup: 'UAT', roleGroupSource: 'ai', approvalStatus: 'approved' },
], 'SIT');
ok(rc.map((x) => x.id).join() === '1', 're-classify touches AI-set items only');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
