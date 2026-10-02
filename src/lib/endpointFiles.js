import { getFunctions, httpsCallable } from 'firebase/functions';

// Endpoint file attachments + SSO-gated download (2026-08-18).
//
// ── Why this file exists ──
// Before this, every library-hosted skill file was a static object on Firebase
// Hosting (`/skills/*`). Measured, not assumed:
//
//     curl https://wolfy-ai-library.web.app/skills/duplicate-check.zip
//     → HTTP 200 · 4,879 bytes · no cookie, no token, no VPN
//
// Firebase Hosting is a CDN with no auth layer, so "our files require login"
// is simply not expressible there. The fix is to stop serving files from
// Hosting and route every download through a Cloud Function that checks the
// caller's Firebase Auth token.
//
// ── The /f/{agentId} trick ──
// An uploaded file's `endpoint` becomes `https://<host>/f/{agentId}`. Hosting
// rewrites `**` → index.html, so that URL loads the SPA, which already forces
// Google SSO before rendering anything. Paste the link into a chat and the
// recipient must log in — the gate survives sharing, which a Storage download
// token never would.
//
// ── The one rule every call site must obey ──
// Only OUR OWN file URLs get the authed-download treatment. The library has 38
// endpoints on the internal GitLab and 2 on Cloud Run; those are other systems'
// links and must keep behaving as plain anchors. `isLibraryFileUrl()` is the
// single source of truth for that distinction — never re-derive the host check
// at a call site (same anti-drift rule as normalizeProgress / agentApproveAreas
// / isInternalToolName).

/** Hosts that serve this SPA. Both Hosting targets in .firebaserc, plus dev. */
const LIBRARY_HOSTS = new Set([
  'wolfy-ai-library.web.app',
  'wolfy-481609.web.app',
  'wolfy-ai-library.firebaseapp.com',
  'wolfy-481609.firebaseapp.com',
  'localhost',
  '127.0.0.1',
]);

/** Path prefix that marks "this is a file we host and gate". */
const FILE_PATH_PREFIX = '/f/';

/**
 * Extensions the upload accepts. Deliberately short: these are skill packages
 * and their docs, not a general file share. Mirrored server-side — the server
 * is authoritative, this copy only drives the file picker and pre-flight.
 */
export const ALLOWED_EXT = ['zip', 'md', 'txt', 'pdf', 'csv'];

/** `accept` attribute for <input type="file">. */
export const ACCEPT_ATTR = ALLOWED_EXT.map((e) => `.${e}`).join(',');

/**
 * 5 MB. Callables cap the request at 10 MB and base64 inflates by ~33%, so
 * 5 MB of file is ~6.7 MB on the wire — comfortably inside the limit. For
 * scale: the largest thing being migrated (the whole `figma-use` folder) is
 * 728 KB, and the existing skill zips are ~5 KB each.
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Lowercased extension without the dot, or '' when there isn't one. */
export function fileExt(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || '').trim());
  return m ? m[1].toLowerCase() : '';
}

/**
 * Is this endpoint a file WE host and gate behind SSO?
 * Returns false for every external endpoint (GitLab, Cloud Run, anything else)
 * and also for our own app homepage — 2 agents point at `/`, which is a
 * "go use the app" link, not a download.
 */
export function isLibraryFileUrl(endpoint) {
  const s = String(endpoint || '').trim();
  if (!s) return false;
  try {
    const u = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : `https://${s}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return LIBRARY_HOSTS.has(u.hostname) && u.pathname.startsWith(FILE_PATH_PREFIX);
  } catch {
    return false;
  }
}

/** The agentId encoded in one of our file URLs, or '' if it isn't one. */
export function libraryFileAgentId(endpoint) {
  if (!isLibraryFileUrl(endpoint)) return '';
  try {
    const s = String(endpoint).trim();
    const u = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s) ? s : `https://${s}`);
    return decodeURIComponent(u.pathname.slice(FILE_PATH_PREFIX.length).split('/')[0] || '');
  } catch {
    return '';
  }
}

/** Build the endpoint value stored on an agent for an uploaded file. */
export function buildLibraryFileUrl(origin, agentId) {
  return `${String(origin || '').replace(/\/+$/, '')}${FILE_PATH_PREFIX}${encodeURIComponent(agentId)}`;
}

/** Human-readable size for the UI. */
export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Local pre-flight before spending an upload round-trip. The server repeats
 * every one of these checks (and adds magic-byte sniffing, which a browser
 * cannot be trusted to do) — this exists purely so the user gets an instant,
 * specific error instead of a generic failure 3 seconds later.
 * Returns an error string, or '' when the file looks acceptable.
 */
export function validateUploadFile(file) {
  if (!file) return 'ยังไม่ได้เลือกไฟล์';
  const ext = fileExt(file.name);
  if (!ALLOWED_EXT.includes(ext)) {
    return `นามสกุล .${ext || '(ไม่มี)'} ไม่รองรับ — รับเฉพาะ ${ALLOWED_EXT.map((e) => `.${e}`).join(', ')}`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `ไฟล์ใหญ่เกินไป (${formatBytes(file.size)}) — จำกัดที่ ${formatBytes(MAX_UPLOAD_BYTES)}`;
  }
  if (file.size === 0) return 'ไฟล์ว่างเปล่า';
  return '';
}

/** Read a File into base64 (no data: prefix) for the callable payload. */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ — โปรดเลือกไฟล์อีกครั้ง'));
    // readAsDataURL gives "data:<mime>;base64,<payload>" — take the payload.
    r.onload = () => {
      const s = String(r.result || '');
      const i = s.indexOf(',');
      i >= 0 ? resolve(s.slice(i + 1)) : reject(new Error('อ่านไฟล์ไม่สำเร็จ — โปรดเลือกไฟล์อีกครั้ง'));
    };
    r.readAsDataURL(file);
  });
}

const fn = (name) => httpsCallable(getFunctions(undefined, 'asia-southeast1'), name);

/**
 * Attach a file to an agent's endpoint. Awaited, not fire-and-forget: the
 * caller is standing there waiting and must see whether it landed, or why it
 * didn't (wrong role, wrong area, agent not deploy-approved, bad file type).
 * Returns { ok, endpoint, replacedEndpoint }.
 */
export async function attachEndpointFile({ agentId, file }) {
  const dataBase64 = await fileToBase64(file);
  const { data } = await fn('attachEndpointFile')({
    agentId,
    filename: file.name,
    contentType: file.type || 'application/octet-stream',
    dataBase64,
    origin: window.location.origin,
  });
  return data;
}

/**
 * Fetch an attached file. THIS CALL IS THE SSO GATE — the callable rejects
 * anyone without a valid Firebase Auth token, so the bytes are unreachable
 * without an org login no matter how the URL was obtained.
 * Returns { name, contentType, dataBase64 }.
 */
export async function fetchEndpointFile(agentId, version) {
  // `version` is opt-in (2026-08-26): omitted, this is byte-for-byte the
  // pre-versioning call, so every existing caller is unaffected. Supplied, the
  // server applies the narrower admin-or-creator rule for old versions.
  const { data } = await fn('getEndpointFile')(version ? { agentId, version } : { agentId });
  return data;
}

/**
 * The endpoint-file update history for one agent (2026-08-26). Server-gated —
 * see listEndpointVersions in functions/index.js for why this cannot be a
 * plain Firestore read.
 */
export async function listEndpointVersions(agentId) {
  const { data } = await fn('listEndpointVersions')({ agentId });
  return data;
}

/**
 * Flip an agent to 100% / Ready to Use (2026-08-19).
 *
 * Awaited, never fire-and-forget: the server enforces the gate this feature
 * exists for (an endpoint URL or an uploaded file must exist), plus the
 * creator / area-approver / area-staff / admin permission, so the caller has
 * to see the refusal and why. Also fills in launchDate when the agent has
 * none, using the moment of the transition.
 *
 * Returns { ok, endpoint, launchWasAutoSet }.
 */
export async function markAgentReady({ agentId, endpointUrl, launchDate }) {
  const { data } = await fn('markAgentReady')({ agentId, endpointUrl, launchDate });
  return data;
}

/** Approve or reject a pending rename request. Returns { ok, verdict, childrenUpdated }. */
export async function decideRenameRequest({ requestId, verdict }) {
  const { data } = await fn('decideRenameRequest')({ requestId, verdict });
  return data;
}

/**
 * Hand the fetched bytes to the browser as a download. Same Blob →
 * createObjectURL → anchor.click() dance already proven in ExportDataModal's
 * CSV export, so downloads behave identically to something users already do.
 */
export function triggerDownload({ name, contentType, dataBase64 }) {
  const bin = atob(dataBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: contentType || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'download';
  a.click();
  URL.revokeObjectURL(url);
}

/** Fetch + save in one call, for the card/modal/chat click handlers. */
export async function downloadEndpointFile(agentId, version) {
  triggerDownload(await fetchEndpointFile(agentId, version));
}

/**
 * The click behaviour every render site shares (card, detail modal, chat).
 *
 * For one of OUR files: download in place, so an already-signed-in user gets
 * the file without a tab bouncing open and closed. If that fails for any
 * reason, fall back to navigating to the /f/ page, which can actually explain
 * what went wrong and offers a sign-in button.
 *
 * For anything else — the 38 internal-GitLab endpoints, Cloud Run, the app's
 * own homepage — this returns false and the caller lets the plain <a> do its
 * job untouched. Leave `href` set to the real URL at every call site: that
 * keeps middle-click, "open in new tab" and "copy link" working normally.
 */
export function handleEndpointClick(e, endpoint) {
  if (!isLibraryFileUrl(endpoint)) return false;
  // Let the browser handle modified clicks (new tab / new window / save-as).
  if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1)) return false;
  e?.preventDefault();
  const agentId = libraryFileAgentId(endpoint);
  downloadEndpointFile(agentId).catch(() => {
    window.open(String(endpoint), '_blank', 'noopener');
  });
  return true;
}
