// Offline checks for userProvision.js (2026-10-01 role-reset incident).
// Run: node functions/verify-user-provision.cjs
const { createUserDocOnce, roleAuditEntry } = require('./userProvision');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };

// Mock DocumentReference with Firestore's create() semantics.
function mockRef(existing) {
  const ref = { doc: existing ? { ...existing } : null, writes: 0 };
  ref.create = async (data) => {
    if (ref.doc) { const e = new Error('ALREADY_EXISTS'); e.code = 6; throw e; }
    ref.doc = { ...data }; ref.writes++;
  };
  return ref;
}

(async () => {
  console.log('createUserDocOnce');
  const existing = mockRef({ role: 'committee', approveAreas: ['QA', 'SIT'] });
  const r1 = await createUserDocOnce(existing, { role: 'user', approveAreas: [] });
  ok('existing committee doc is NOT overwritten', r1.created === false && existing.doc.role === 'committee' && existing.doc.approveAreas.length === 2);

  const fresh = mockRef(null);
  const r2 = await createUserDocOnce(fresh, { role: 'user', approveAreas: [] });
  ok('missing doc is created as user', r2.created === true && fresh.doc.role === 'user');

  const boom = { create: async () => { const e = new Error('unavailable'); e.code = 14; throw e; } };
  let threw = false; try { await createUserDocOnce(boom, {}); } catch { threw = true; }
  ok('other errors still propagate', threw);

  console.log('roleAuditEntry');
  const t = (ms) => ({ toMillis: () => ms });
  ok('no change -> null', roleAuditEntry('u', { role: 'user', approveAreas: [] }, { role: 'user', approveAreas: [], displayName: 'x' }) === null);
  ok('area order ignored', roleAuditEntry('u', { role: 'approver', approveAreas: ['A', 'B'] }, { role: 'approver', approveAreas: ['B', 'A'] }) === null);
  const ui = roleAuditEntry('u', { role: 'user', updatedAt: t(1) }, { role: 'committee', updatedAt: t(2), updatedBy: 'admin1', email: 'a@x' });
  ok('admin UI change tagged admin-ui with actor', ui.source === 'admin-ui' && ui.by === 'admin1' && ui.after.role === 'committee');
  const reset = roleAuditEntry('u', { role: 'committee', approveAreas: ['QA'], updatedAt: t(5), updatedBy: 'admin1' }, { role: 'user', approveAreas: [], updatedAt: t(5), updatedBy: 'admin1' });
  ok('overwrite without a new UI save -> source other', reset.source === 'other' && reset.by === null && reset.before.role === 'committee');
  ok('first create -> provision', roleAuditEntry('u', null, { role: 'user' }).source === 'provision');
  ok('delete -> delete', roleAuditEntry('u', { role: 'staff' }, null).source === 'delete');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
