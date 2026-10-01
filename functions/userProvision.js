// First-login provisioning must CREATE /users/{uid}, never overwrite it.
//
// 2026-10-01 incident: claimPendingRoleGrant used userRef.set() (no merge),
// and the client called it whenever its /users snapshot said "doesn't
// exist" — which a cache-only snapshot does during a brief network drop.
// The admin SDK bypasses rules, so an existing committee member was
// silently reset to role "user" with approveAreas wiped.
//
// DocumentReference.create() is atomic and fails with ALREADY_EXISTS
// (gRPC code 6) if the doc is there, so the existing doc is left untouched.

const ALREADY_EXISTS = 6;

async function createUserDocOnce(userRef, data) {
  try {
    await userRef.create(data);
    return { created: true };
  } catch (e) {
    if (e && (e.code === ALREADY_EXISTS || e.code === 'already-exists')) {
      return { created: false };
    }
    throw e;
  }
}

// Audit entry for a /users/{uid} write, or null when role/approveAreas did
// not change. `source` is best-effort: UserManagementModal stamps updatedBy
// with each save, so a changed updatedAt+updatedBy pair means the admin UI.
function roleAuditEntry(uid, before, after) {
  const b = before || null;
  const a = after || null;
  const areas = (d) => (Array.isArray(d && d.approveAreas) ? [...d.approveAreas].sort() : []);
  const same = (b && b.role) === (a && a.role)
    && JSON.stringify(areas(b)) === JSON.stringify(areas(a));
  if (same) return null;
  const ts = (d) => (d && d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : null);
  let source = 'other';
  if (!b) source = 'provision';
  else if (!a) source = 'delete';
  else if (a.updatedBy && ts(a) !== ts(b)) source = 'admin-ui';
  return {
    uid,
    email: (a && a.email) || (b && b.email) || '',
    before: b ? { role: b.role || null, approveAreas: areas(b) } : null,
    after: a ? { role: a.role || null, approveAreas: areas(a) } : null,
    by: source === 'admin-ui' ? a.updatedBy : null,
    source,
  };
}

module.exports = { createUserDocOnce, roleAuditEntry };
