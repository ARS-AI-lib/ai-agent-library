/**
 * Upload/authorisation rules for endpoint file attachments (2026-08-18).
 *
 * Split out of index.js for the same reason embedText.js and chatPrompt.js
 * were: so verify-endpoint-files.cjs can exercise THE REAL RULES rather than a
 * copy that drifts. These are the checks that decide who may publish a file
 * into the library, so a test against a stale duplicate would be worse than no
 * test at all.
 *
 * Everything here is pure — no Firestore, no Storage, no network — which is
 * what makes it testable against the live agent/user data offline.
 */

const { checkAgentActor } = require('./agentReadyRules');

const ALLOWED_EXT = new Set(['zip', 'md', 'txt', 'pdf', 'csv']);
// Retained for the client-side menu gate only. The authoritative actor test is
// checkAgentActor() — see checkUploadPermission below for why this set alone
// is no longer sufficient.
const UPLOAD_ROLES = new Set(['admin', 'staff', 'approver']);
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_DOMAINS = ['arise.tech', 'infinitaskt.com', 'krungthai.com'];

function extOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

/** Basename only — a filename must never escape its agent's storage folder. */
function safeName(name) {
  const base = String(name || '').split(/[\\/]/).pop().trim();
  return base.replace(/[^\w.\-฀-๿ ]+/g, '_').slice(0, 120) || 'file';
}

/**
 * Does the payload actually look like the extension claims?
 *
 * The extension is what the browser labels the download and what the OS acts
 * on, so it has to agree with the bytes — otherwise `report.zip` can be an
 * executable. Text formats have no magic number, so the test inverts: real
 * text has no NUL byte in it.
 */
function contentMatchesExt(ext, buf) {
  if (ext === 'zip') return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b; // "PK"
  if (ext === 'pdf') return buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === '%PDF';
  return !buf.subarray(0, 8192).includes(0);
}

function isOrgEmail(email) {
  const e = String(email || '').toLowerCase();
  return ALLOWED_DOMAINS.some((d) => e.endsWith(`@${d}`));
}

/**
 * May this user attach a file to this agent?
 * Returns null when allowed, or { code, message } describing the refusal.
 *
 * ── 2026-08-19: the actor test moved to checkAgentActor() ──
 * The requirement is that editing the endpoint or the uploaded file uses the
 * SAME permission set as flipping an agent to 100%, so both call one helper
 * rather than each keeping their own list. That also fixed a real gap: this
 * function used to reject on `UPLOAD_ROLES.has(role)` first, which meant a
 * base-`user` CREATOR — the person who actually built the thing — was denied
 * upload on their own agent. checkAgentActor allows admin, the creator (by
 * creatorEmails, since `createdBy` is import-mangled on 157 of 239 agents),
 * and area-matched approver/staff.
 *
 * The deploy-approval precondition stays here rather than moving into the
 * shared helper: it is specific to publishing an artefact, not to acting on
 * an agent in general.
 */
function checkUploadPermission({ agent, role, userEmail, userUid, userApproveAreas }) {
  if (!agent) return { code: 'not-found', message: 'Agent not found.' };
  if (agent.approvalStatus !== 'approved' || agent.archived === true) {
    return { code: 'failed-precondition', message: 'Agent must be approved and not archived.' };
  }
  // Eligibility is deploy-approval alone. The original ask also listed
  // "devProgress = 100" and "has a deployment request", but live data showed
  // all 26 deploy-approved agents are already at 100 and approval implies the
  // request — clauses that filter nothing are just extra places to drift.
  if (agent.deploymentStatus !== 'approved') {
    return {
      code: 'failed-precondition',
      message: 'Agent must have an approved deployment request before a file can be attached.',
    };
  }
  return checkAgentActor({ agent, role, userEmail, userUid, userApproveAreas });
}

/**
 * Is this file acceptable? Returns null when fine, or { code, message }.
 * `buf` is the decoded payload, so size is checked on real bytes rather than
 * on a base64 string that is 33% larger than the file it represents.
 */
function checkUploadFile({ filename, buf }) {
  const ext = extOf(filename);
  if (!ALLOWED_EXT.has(ext)) {
    return { code: 'invalid-argument', message: `Unsupported file type: .${ext || '(none)'}` };
  }
  if (!buf || !buf.length) return { code: 'invalid-argument', message: 'File is empty.' };
  if (buf.length > MAX_UPLOAD_BYTES) {
    return { code: 'invalid-argument', message: `File exceeds ${MAX_UPLOAD_BYTES} bytes.` };
  }
  if (!contentMatchesExt(ext, buf)) {
    return { code: 'invalid-argument', message: `File contents do not match a .${ext} file.` };
  }
  return null;
}

module.exports = {
  ALLOWED_EXT, UPLOAD_ROLES, MAX_UPLOAD_BYTES, ALLOWED_DOMAINS,
  extOf, safeName, contentMatchesExt, isOrgEmail,
  checkUploadPermission, checkUploadFile,
};
