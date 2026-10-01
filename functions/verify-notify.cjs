#!/usr/bin/env node
/**
 * Exercise the notification rules against LIVE data (2026-08-20).
 *
 * Requires functions/notifyRules.js — the same module index.js calls, not a
 * copy — so a routing change that breaks the matrix shows up here rather than
 * in someone's inbox. Same reasoning as verify-endpoint-files.cjs and
 * verify-agent-ready.cjs.
 *
 * Read-only, and it NEVER sends: buildNotification() is pure, and sendMail()
 * is not imported at all. This is what lets the whole system be proven before
 * a single real email exists.
 *
 * Usage:  node functions/verify-notify.cjs           # assertions
 *         node functions/verify-notify.cjs --preview # + rendered previews
 */

const admin = require('firebase-admin');
const { buildNotification, EVENT_TYPES, areaApprovers } = require('./notifyRules');

const PREVIEW = process.argv.includes('--preview');

admin.initializeApp({ projectId: 'wolfy-481609' });
const db = admin.firestore();
db.settings({ databaseId: 'ai-agent-lib' });

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = got === want;
  ok ? (pass += 1) : (fail += 1);
  console.log(`   ${ok ? '✓' : '✗'} ${label}${ok ? '' : `   (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
}

(async () => {
  const [agentSnap, userSnap] = await Promise.all([
    db.collection('agents').get(),
    db.collection('users').get(),
  ]);
  const agents = agentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const users = userSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.emailOptOut !== true);
  const live = agents.filter((a) => a.approvalStatus === 'approved' && a.archived !== true);

  console.log(`agents ${agents.length} · users ${users.length} · event types ${EVENT_TYPES.length}\n`);

  const build = (type, doc, extra = {}) => buildNotification({ type, doc, agent: extra.agent || doc, users, ...extra });

  // ── 1. verification gate: a claim that isn't true sends nothing ──────
  console.log('1) verification — forged/stale events resolve to nothing');
  const approved = live.find((a) => a.approvalStatus === 'approved' && !a.matchingAgent);
  check('claiming "pending" on an APPROVED agent -> null',
    build('agent.pending', approved), null);
  check('claiming "archived" on a NOT-archived agent -> null',
    build('agent.archived', approved), null);
  check('claiming "deploy.approved" on a never-requested agent -> null',
    build('deploy.approved', live.find((a) => (a.deploymentStatus || 'none') === 'none')), null);
  const realApproved = build('agent.approved', approved);
  check('the TRUE claim on the same agent does produce an email', !!realApproved, true);

  // ── 2. one email per logical action ─────────────────────────────────
  console.log('\n2) cascade — one human action must not become N emails');
  const parent = live.find((a) => a.agentName === 'VA Agent (Orchestrator Agent)')
    || live.find((a) => agents.some((k) => k.matchingAgent === a.agentName));
  const children = agents.filter((k) => k.matchingAgent === parent?.agentName);
  console.log(`   parent "${parent?.agentName}" has ${children.length} sub-skills`);
  const emitted = [parent, ...children]
    .map((d) => build('deploy.requested', { ...d, deploymentStatus: 'requested' }))
    .filter(Boolean).length;
  check(`deploy.requested across parent + ${children.length} children emits exactly 1`, emitted, 1);
  check('a sub-skill on its own emits nothing (carries matchingAgent)',
    build('agent.approved', children[0]), null);

  // ── 3. routing ──────────────────────────────────────────────────────
  console.log('\n3) routing');
  const withArea = live.find((a) => (a.approveArea || []).length && a.approvalStatus === 'approved' && !a.matchingAgent);
  const pendRoute = build('agent.pending', { ...withArea, approvalStatus: 'pending' });
  const expected = new Set(areaApprovers(withArea, users).map((u) => u.email?.toLowerCase()).filter(Boolean));
  check(`area routing for "${withArea.agentName}" [${(withArea.approveArea || []).join(', ')}] matches areaApprovers()`,
    pendRoute.to.length === expected.size && pendRoute.to.every((e) => expected.has(e)), true);

  const noArea = { ...withArea, approveArea: [], approvalStatus: 'pending' };
  const fullAccess = users.filter((u) => u.role === 'admin' || u.role === 'committee').length;
  check(`an agent with NO stored area falls back to admin/committee (${fullAccess})`,
    build('agent.pending', noArea).to.length, fullAccess);

  const creators = build('agent.approved', approved).to;
  check('decision mail goes to creatorEmails, not to approvers',
    creators.every((e) => (approved.creatorEmails || []).map((x) => x.toLowerCase()).includes(e)), true);

  check('an agent with no creatorEmails produces no decision mail',
    build('agent.approved', { ...approved, creatorEmails: [] }), null);

  // ── 4. opt-out ──────────────────────────────────────────────────────
  console.log('\n4) opt-out');
  const optedOut = users.filter((u) => areaApprovers(withArea, users).some((x) => x.id === u.id));
  const without = users.filter((u) => u.id !== optedOut[0]?.id);
  const before = build('agent.pending', { ...withArea, approvalStatus: 'pending' }).to.length;
  const after = buildNotification({ type: 'agent.pending', doc: { ...withArea, approvalStatus: 'pending' }, agent: withArea, users: without }).to.length;
  check(`removing one recipient (as emailOptOut does) drops the count ${before} -> ${after}`, after, before - 1);

  // ── 5. every event type renders ─────────────────────────────────────
  console.log(`\n5) all ${EVENT_TYPES.length} event types render a subject and a body`);
  const rr = { id: 'r1', agentId: parent?.id, currentName: parent?.agentName, requestedName: `${parent?.agentName} v2`, status: 'pending', createdByEmail: 'someone@arise.tech' };
  const cases = {
    'agent.pending': [{ ...approved, approvalStatus: 'pending' }, {}],
    'agent.approved': [approved, {}],
    'agent.rejected': [{ ...approved, approvalStatus: 'rejected', rejectionReason: 'ซ้ำกับของเดิม' }, {}],
    'deploy.requested': [{ ...approved, deploymentStatus: 'requested' }, {}],
    'deploy.approved': [{ ...approved, deploymentStatus: 'approved' }, {}],
    'deploy.rejected': [{ ...approved, deploymentStatus: 'rejected' }, {}],
    'agent.archived': [{ ...approved, archived: true, archiveReason: 'รวมกับตัวอื่นแล้ว' }, {}],
    'agent.ready': [{ ...approved, devProgress: 100 }, {}],
    'rename.requested': [rr, { agent: parent }],
    'rename.decided': [{ ...rr, status: 'approved', appliedName: rr.requestedName, childrenUpdated: children.length }, { agent: parent }],
    'user.roleChanged': [{ ...users.find((u) => u.role === 'approver') }, {}],
    // 2026-09-30 link requests: doc = the skill, ctx.agent = the target agent.
    'link.requested': [{ ...approved, linkSuggestion: { agentId: parent?.id, agentName: parent?.agentName, status: 'pending' } }, { agent: parent }],
    'link.decided': [{ ...approved, linkSuggestion: { agentId: parent?.id, agentName: parent?.agentName, status: 'accepted' } }, { agent: parent }],
  };
  check('every declared event type has a test case', Object.keys(cases).length, EVENT_TYPES.length);
  let rendered = 0;
  for (const [type, [doc, extra]] of Object.entries(cases)) {
    const n = buildNotification({ type, doc, agent: extra.agent || doc, users, subSkillCount: children.length });
    const ok = !!(n && n.subject && n.html && n.text && n.to.length);
    if (ok) rendered += 1; else console.log(`   ✗ ${type} produced nothing`);
    if (PREVIEW && n) {
      console.log(`\n   ── ${type} → ${n.to.length} recipient(s)`);
      console.log(`   ${n.subject}`);
      console.log(n.text.split('\n').slice(1).map((l) => `   | ${l}`).join('\n'));
    }
  }
  check(`all ${Object.keys(cases).length} render`, rendered, Object.keys(cases).length);
  check('every subject is prefixed [AI Library]',
    Object.entries(cases).every(([type, [doc, extra]]) => {
      const n = buildNotification({ type, doc, agent: extra.agent || doc, users });
      return !n || n.subject.startsWith('[AI Library] ');
    }), true);

  // ── 6. volume sanity ────────────────────────────────────────────────
  console.log('\n6) blast radius of one event, on real data');
  const rows = ['agent.pending', 'deploy.requested', 'agent.approved', 'agent.archived']
    .map((t) => {
      const doc = t.startsWith('deploy') ? { ...withArea, deploymentStatus: 'requested' }
        : t === 'agent.approved' ? approved
          : t === 'agent.archived' ? { ...approved, archived: true }
            : { ...withArea, approvalStatus: 'pending' };
      const n = buildNotification({ type: t, doc, agent: doc, users });
      return `     ${t.padEnd(18)} -> ${n ? n.to.length : 0} recipient(s)`;
    });
  rows.forEach((r) => console.log(r));

  console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
