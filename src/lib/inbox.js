import { toJsDate, isMyAgent, isPairedSubSkill } from './agentUtils';
import { nextStep } from './mySubmissions';
import { visiblePending, visibleDeployRequests, visibleRenameRequests, visibleLinkRequests, visibleAssessmentReviews, queueAreaEmptyForApprover } from './pendingQueue';

// Inbox (announcements + "my requests") — pure logic, no Firebase, no React.
//
// allowedAudiences() / canPostAnnouncements() MIRROR the `audienceOk` helper in
// firestore.rules. They must change together: the rules are authoritative, this
// copy only decides what the UI offers and shows.
const DAY = 24 * 60 * 60 * 1000;

export const AUDIENCES = ['all', 'approvers', 'leads'];
export const AUDIENCE_LABEL = { all: 'Everyone', approvers: 'Approvers and above', leads: 'Admin & Committee' };
export const REJECTED_WINDOW_DAYS = 14;
export const READ_IDS_CAP = 300;

const TITLE_MAX = 120;
const BODY_MAX = 5000;

export function allowedAudiences(role) {
  if (role === 'user' || role === 'workshop') return ['all'];
  if (role === 'staff' || role === 'approver') return ['all', 'approvers'];
  if (role === 'committee' || role === 'admin') return ['all', 'approvers', 'leads'];
  return [];
}

export function canPostAnnouncements(role) {
  return role === 'committee' || role === 'admin';
}

function ms(v) {
  const d = toJsDate(v);
  return d ? d.getTime() : 0;
}

// Drops expired announcements (expiresAt <= now), pinned first, then newest.
export function activeAnnouncements(list, now = Date.now()) {
  return (list || [])
    .filter((a) => {
      const exp = toJsDate(a.expiresAt);
      return !exp || exp.getTime() > now;
    })
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || ms(b.createdAt) - ms(a.createdAt));
}

export function unreadAnnouncements(active, readIds) {
  const read = new Set(readIds || []);
  return (active || []).filter((a) => !read.has(a.id));
}

export function pruneReadIds(readIds, knownIds, cap = READ_IDS_CAP) {
  const known = new Set(knownIds || []);
  return [...(readIds || [])].filter((id) => known.has(id)).slice(-cap);
}

export function validateAnnouncement(d) {
  const title = String(d?.title ?? '').trim();
  const body = String(d?.body ?? '');
  if (!title) return 'กรุณากรอกหัวข้อประกาศ';
  if (title.length > TITLE_MAX) return `หัวข้อต้องไม่เกิน ${TITLE_MAX} ตัวอักษร`;
  if (!body.trim()) return 'กรุณากรอกเนื้อหาประกาศ';
  if (body.length > BODY_MAX) return `เนื้อหาต้องไม่เกิน ${BODY_MAX} ตัวอักษร`;
  if (!AUDIENCES.includes(d?.audience)) return 'กรุณาเลือกกลุ่มผู้รับประกาศ';
  return null;
}

// Plain-text -> segments. Only http(s) URLs get an href; everything else stays
// text, so announcement content is never interpreted as HTML or a script URL.
export function splitLinks(text) {
  const out = [];
  const push = (seg) => { if (seg.text) out.push(seg); };
  const s = String(text ?? '');
  // [label](https://…) first (label shown, href must be http(s)), then bare http(s) URLs.
  const re = /\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)<>"']+)\)|https?:\/\/[^\s<>"']+/g;
  let last = 0;
  let m;
  let pendingTail = '';
  while ((m = re.exec(s))) {
    if (m[1] !== undefined) {
      push({ text: pendingTail + s.slice(last, m.index) });
      pendingTail = '';
      push({ text: m[1], href: m[2] });
      last = m.index + m[0].length;
      continue;
    }
    let url = m[0];
    const tail = url.match(/[.,;:!?)]+$/);
    if (tail) url = url.slice(0, url.length - tail[0].length);
    push({ text: pendingTail ? pendingTail + s.slice(last, m.index) : s.slice(last, m.index) });
    pendingTail = '';
    if (url) push({ text: url, href: url });
    pendingTail = tail ? tail[0] : '';
    last = m.index + m[0].length;
  }
  push({ text: pendingTail + s.slice(last) });
  return out;
}

export function myRequestItems({ pending, allAgents, rejected, user, now = Date.now() }) {
  const seen = new Set();
  const pool = [];
  for (const a of [...(pending || []), ...(allAgents || []), ...(rejected || [])]) {
    if (!a || seen.has(a.id)) continue;
    seen.add(a.id);
    pool.push(a);
  }
  const items = [];
  for (const agent of pool) {
    if (!isMyAgent(agent, user)) continue;
    if (isPairedSubSkill(agent, pool)) continue;
    if (agent.approvalStatus === 'rejected') {
      const when = toJsDate(agent.rejectedAt) || toJsDate(agent.updatedAt);
      if (!when || now - when.getTime() > REJECTED_WINDOW_DAYS * DAY) continue;
    }
    const step = nextStep(agent, now);
    if (step.tone === 'wait' || step.tone === 'bad') items.push({ agent, step });
  }
  return items;
}

// Approver queue size WITHOUT the base-user "own submissions" fallback that
// visiblePending applies — an inbox badge must not count a user's own items.
export function inboxQueueCount(pending, deployRequests, renameReqs, agents, v, reviews = []) {
  const hasAreaMatch = v.fullAccess || (v.areas.size > 0 && !queueAreaEmptyForApprover(pending, v));
  return (hasAreaMatch ? visiblePending(pending, v).length : 0)
    + visibleDeployRequests(deployRequests, agents, v).length
    + visibleRenameRequests(renameReqs, agents, v).length
    + visibleLinkRequests([...(agents || []), ...(pending || [])], v).length
    + visibleAssessmentReviews(reviews, agents, v).length;
}

export function showToApprove(v, queueCount) {
  return !!v.fullAccess || queueCount > 0;
}

// Per-person messages share the announcements' read-state doc; their ids are
// stored as `msg:{id}` so they cannot collide with an announcement id.
export const msgReadId = (id) => `msg:${id}`;

// Only http(s) URLs may become a link; javascript:/data:/relative -> null.
export function safeHttpUrl(u) {
  if (typeof u !== 'string' || !u.trim()) return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

// Ids the read-state may keep. `msg:` ids are only pruned once the messages
// listener has delivered; before that, already-stored msg: ids are preserved.
export function knownReadIds(annIds, messages, messagesLoaded, readIds) {
  const msgIds = messagesLoaded
    ? (messages || []).map((m) => msgReadId(m.id))
    : [...(readIds || [])].filter((id) => String(id).startsWith('msg:'));
  return [...(annIds || []), ...msgIds];
}

export function unreadMessages(messages, readIds) {
  const read = new Set(readIds || []);
  return (messages || []).filter((m) => !read.has(msgReadId(m.id)));
}

export function inboxBadgeCount({ unreadCount, queueCount, unreadMessages: unreadMsgs }) {
  return (unreadCount || 0) + (queueCount || 0) + (unreadMsgs || 0);
}
