// Single source of truth (functions/ side) for accounts that must never be
// demoted from admin by any automated mechanism — the backfill script and
// the claimPendingRoleGrant callable both check this before touching a
// role. This is a convenience guard, NOT the real security boundary: rules
// syntax can't require() a JS module, so firestore.rules duplicates this
// exact email literally in its own guard on /users/{uid} update. If this
// list ever changes, the matching literal in firestore.rules (and the
// client-side copy in src/components/UserManagementModal.jsx, which only
// disables the UI control) must be updated too.
//
// Guaranteeing this account can never lose admin is how the system
// guarantees "at least one admin always exists" — no dynamic last-admin
// counting is needed since this one account can never be the thing that
// drops the count to zero.
const PROTECTED_ADMIN_EMAILS = ['tinnapat.p@arise.tech'];

function isProtectedAdminEmail(email) {
  return PROTECTED_ADMIN_EMAILS.includes((email || '').toLowerCase());
}

module.exports = { PROTECTED_ADMIN_EMAILS, isProtectedAdminEmail };
