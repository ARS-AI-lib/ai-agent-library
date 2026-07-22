// Directory lookup for the "Creator / Team member" picker in PreRegModal.
//
// Design (2026-07-03, revised): only an ADMIN's browser ever calls the Google
// People API directly (via their own OAuth token from the sign-in popup,
// which only exists in-memory for that session). The admin's fetch is synced
// into Firestore (`/config/directory`) once per admin login (or on-demand via
// the "Sync directory now" button in UserManagementModal). Every OTHER user —
// and the admin on later reloads — reads that Firestore doc instead, which
// works under their normal Firebase session with no Google OAuth token at
// all. This is what makes the picker survive page reloads / persisted
// sessions for everyone: a silently-refreshed Google token was tried and
// reintroduced unpredictable account-chooser popups on multi-account
// machines, which is worse than this once-removed sync model.
//
// Only arise.tech / infinitaskt.com accounts are kept — krungthai.com /
// ktbgs.co.th show up in the same Workspace directory but aren't part of this
// app's user base, so they're just noise in the picker.
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { db, auth } from './firebase';

const DIRECTORY_SCOPE = 'https://www.googleapis.com/auth/directory.readonly';

const ALLOWED_DOMAINS = ['arise.tech', 'infinitaskt.com'];
const DIRECTORY_DOC = doc(db, 'config', 'directory');

// Only set on an admin's session, right after their sign-in popup — used
// exclusively by syncDirectoryToFirestore(). Regular users never need this.
let accessToken = null;

let cachedPeople = null;      // in-memory mirror of /config/directory.people
let cacheLoadPromise = null;

export function setDirectoryToken(token) {
  accessToken = token || null;
}

export function hasDirectoryToken() {
  return !!accessToken;
}

async function fetchFromPeopleApi() {
  if (!accessToken) throw new Error('no-token');
  let people = [];
  let pageToken = '';
  do {
    const url = new URL('https://people.googleapis.com/v1/people:listDirectoryPeople');
    url.searchParams.set('readMask', 'names,emailAddresses');
    url.searchParams.set('sources', 'DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE');
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message || `directory fetch failed (${res.status})`);
    }
    const data = await res.json();
    people = people.concat(
      (data.people || [])
        .map((p) => ({
          name: p.names?.[0]?.displayName || '',
          email: p.emailAddresses?.[0]?.value || '',
        }))
        .filter((p) => p.email && ALLOWED_DOMAINS.includes(p.email.split('@')[1]?.toLowerCase()))
    );
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return people;
}

// Acquire a Google OAuth token carrying the sensitive directory.readonly scope
// ON DEMAND — only when an admin actually runs a sync. reauthenticateWithPopup
// (not signInWithPopup) keeps the current signed-in account, just prompting for
// the extra scope. This is the ONLY place the sensitive scope is requested, so
// regular sign-in stays friction-free (see firebase.js note).
async function acquireDirectoryToken() {
  const current = auth.currentUser;
  if (!current) throw new Error('ต้อง sign in ก่อนจึงจะ sync directory ได้');
  const provider = new GoogleAuthProvider();
  provider.addScope(DIRECTORY_SCOPE);
  const result = await reauthenticateWithPopup(current, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  accessToken = credential?.accessToken || null;
  if (!accessToken) throw new Error('ไม่ได้รับสิทธิ์เข้าถึง directory จาก Google');
  return accessToken;
}

// Admin-only: pull the live directory from the People API (using an on-demand
// token acquired right here) and persist it to /config/directory for everyone
// else to read. Returns { count } on success.
export async function syncDirectoryToFirestore() {
  await acquireDirectoryToken();
  const people = await fetchFromPeopleApi();
  await setDoc(DIRECTORY_DOC, { people, updatedAt: serverTimestamp() });
  cachedPeople = people; // refresh this session's own cache too
  return { count: people.length };
}

// Reads the last-synced info without loading the full list — used by the
// admin panel to show "last synced" state.
export async function getDirectoryMeta() {
  const snap = await getDoc(DIRECTORY_DOC);
  if (!snap.exists()) return null;
  const data = snap.data();
  return { count: data.people?.length || 0, updatedAt: data.updatedAt || null };
}

async function loadCache() {
  if (cachedPeople) return cachedPeople;
  if (cacheLoadPromise) return cacheLoadPromise;
  cacheLoadPromise = (async () => {
    const snap = await getDoc(DIRECTORY_DOC);
    if (!snap.exists()) throw new Error('no-directory-data');
    const people = snap.data()?.people || [];
    cachedPeople = people;
    return people;
  })();
  try {
    return await cacheLoadPromise;
  } finally {
    cacheLoadPromise = null;
  }
}

// Fire-and-forget: load the Firestore-cached directory into memory as early
// as possible (e.g. right after login) so the first keystroke in the Creator
// picker doesn't pay the Firestore round-trip. No Google token needed here —
// safe to call for every user, not just admins.
export function warmDirectory() {
  if (cachedPeople || cacheLoadPromise) return;
  loadCache().catch(() => {});
}

// Resolve a list of emails to their directory display names (case-insensitive),
// reading the same Firestore-cached directory as searchDirectory. Used by
// EditAgentModal to re-hydrate creator chips (which load from creatorEmails
// with no name) so the `creator` display field can be rewritten on save.
// Returns [{ email, name }] — name is '' if the email isn't in the cache.
export async function lookupDirectoryNames(emails) {
  const list = (emails || []).filter(Boolean);
  if (!list.length) return [];
  let people = [];
  try {
    people = await loadCache();
  } catch {
    people = [];
  }
  const byEmail = new Map(people.map((p) => [(p.email || '').toLowerCase(), p.name || '']));
  return list.map((e) => ({ email: e, name: byEmail.get((e || '').toLowerCase()) || '' }));
}

// Returns up to `limit` {name, email} matches for a free-text query (matches
// against name OR email, case-insensitive substring). Throws if the
// Firestore directory doc doesn't exist yet (caller falls back to manual
// email entry — happens only before the very first admin sync).
export async function searchDirectory(query, limit = 8) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const people = await loadCache();
  const out = [];
  for (const p of people) {
    if (p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)) {
      out.push(p);
      if (out.length >= limit) break;
    }
  }
  return out;
}
