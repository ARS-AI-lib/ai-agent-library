#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
// Verify delayAlertRules.js (2026-10-05).
//   node verify-delay-alerts.cjs            offline cases only
//   node verify-delay-alerts.cjs --live     + parity vs src/lib on live data (read-only)
//   node verify-delay-alerts.cjs --preview  + print every digest that would go out now

const fs = require('fs');
const path = require('path');
const R = require('./delayAlertRules');

let pass = 0; let fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  ✗', msg); } };

// ── offline ──────────────────────────────────────────────────────────
const D = (s) => new Date(`${s}T00:00:00Z`);              // a Bangkok calendar day
const at = (s, hhmm = '09:30') => new Date(`${s}T${hhmm}:00+07:00`);

// business-day math (2026-10-05 is a Monday)
ok(R.businessDaysBetween(D('2026-10-05'), D('2026-10-09')) === 4, 'Mon→Fri = 4');
ok(R.businessDaysBetween(D('2026-10-05'), D('2026-10-12')) === 5, 'Mon→next Mon = 5');
ok(R.businessDaysBetween(D('2026-10-09'), D('2026-10-12')) === 1, 'Fri→Mon = 1 (weekend skipped)');
ok(R.businessDaysBetween(D('2026-10-05'), D('2026-10-02')) === -1, 'Mon→previous Fri = -1');
ok(R.businessDaysBetween(D('2026-10-05'), D('2026-10-05')) === 0, 'same day = 0');
ok(R.bkkDay(new Date('2026-10-04T18:00:00Z')).toISOString().startsWith('2026-10-05'), 'UTC 18:00 = next day in Bangkok');

const base = { approvalStatus: 'approved', creatorEmails: ['a@arise.tech'], aiAgent: true, skillMd: false };
const now = at('2026-10-05');
const ts = (s) => ({ toDate: () => D(s) });
const mk = (id, extra) => ({ id, agentName: id, ...base, ...extra });

const agents = [
  mk('late', { devProgress: 50, launchDate: ts('2026-10-02') }),
  mk('due', { devProgress: 95, launchDate: ts('2026-10-12') }),            // 5 bd, Pilot still counts
  mk('far', { devProgress: 85, launchDate: ts('2026-10-13') }),            // 6 bd, not at risk → none
  mk('risky', { devProgress: 0, launchDate: ts('2026-10-16'), createdAt: ts('2026-01-01') }), // 9 bd, 0% → risk
  mk('done', { devProgress: 100, launchDate: ts('2026-09-01') }),
  mk('archived', { devProgress: 10, launchDate: ts('2026-09-01'), archived: true }),
  mk('pending', { devProgress: 10, launchDate: ts('2026-09-01'), approvalStatus: 'pending' }),
  mk('staleIp', { devProgress: 40, phaseSince: ts('2026-06-01') }),          // ~90 bd > 60
  mk('freshIp', { devProgress: 40, phaseSince: ts('2026-09-01') }),          // ~25 bd
  mk('stalePilot', { devProgress: 92, phaseSince: ts('2026-08-01') }),       // ~45 bd > 30
  mk('freshPilot', { devProgress: 92, phaseSince: ts('2026-09-10') }),       // ~18 bd
  mk('parent', { devProgress: 100, childSkillIds: ['child'] }),
  mk('child', { devProgress: 20, aiAgent: false, skillMd: true, launchDate: ts('2026-09-01') }),
  mk('noMail', { devProgress: 20, launchDate: ts('2026-09-01'), creatorEmails: [] }),
  mk('str', { devProgress: '30%', launchDate: ts('2026-09-30') }),
];
// milestones pin the axis so the risk check is deterministic
const digests = R.buildDigests(agents, { milestones: [{ start: ts('2026-01-01'), end: ts('2026-12-31') }], now });
ok(digests.length === 1 && digests[0].email === 'a@arise.tech', 'one digest per creator');
const cat = Object.fromEntries((digests[0]?.items || []).map((i) => [i.id, i.category]));
ok(cat.late === 'delayed', 'past launch → delayed');
ok(cat.str === 'delayed', '"30%" string progress handled');
ok(cat.due === 'due5', 'launch in 5 bd (Pilot) → due5');
ok(!cat.far, 'launch in 6 bd and on track → nothing');
ok(cat.risky === 'risk10', 'launch in 9 bd and behind → risk10');
ok(!cat.done && !cat.archived && !cat.pending, 'done / archived / pending excluded');
ok(cat.staleIp === 'stale' && !cat.freshIp, 'In Progress stale > 60 bd only');
ok(cat.stalePilot === 'stale' && !cat.freshPilot, 'Pilot stale > 30 bd only');
ok(!cat.child, 'linked sub-skill excluded');
ok(!cat.noMail, 'no creatorEmails → no digest');
const order = digests[0].items.map((i) => i.category);
ok(order.join() === [...order].sort((a, b) => R.RANK[a] - R.RANK[b]).join(), 'items sorted by priority');
const r = R.renderDigest(digests[0], { forEmail: 'x@arise.tech' });
ok(r.to.length === 1 && r.to[0] === 'x@arise.tech' && r.html.includes('Dry run'), 'dry-run copy goes to the reviewer and says so');
ok(r.html.includes('/?agent=late'), 'deep link per item');

// ── live parity (read-only) ─────────────────────────────────────────
async function live(preview) {
  const admin = require('firebase-admin');
  admin.initializeApp({ projectId: 'wolfy-481609' });
  const db = require('firebase-admin/firestore').getFirestore('ai-agent-lib');
  const [snap, tl] = await Promise.all([db.collection('agents').get(), db.doc('config/timeline').get()]);
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const milestones = tl.exists ? (tl.data().milestones || []) : [];

  // Load the REAL client modules (same loadEsm pattern as backfill-approve-area.cjs).
  const SRC = path.join(__dirname, '..', 'src', 'lib');
  const loadEsm = (file, injected = {}) => {
    const code = fs.readFileSync(path.join(SRC, file), 'utf8')
      .replace(/^\s*import\s[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
    const names = Object.keys(injected);
    const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    return new Function(...names, `${code}\n;return { ${[...new Set(decls)].join(', ')} };`)(...names.map((n) => injected[n]));
  };
  const tier = loadEsm('tier.js');
  const utils = loadEsm('agentUtils.js', { getType: tier.getType, getTier: tier.getTier });
  const timeline = loadEsm('timeline.js', { getType: tier.getType, normalizeProgress: utils.normalizeProgress, agentUseCaseNames: utils.agentUseCaseNames });

  let mism = 0;
  for (const a of all) {
    if (R.getType(a) !== tier.getType(a)) mism++;
    if (R.normalizeProgress(a.devProgress) !== utils.normalizeProgress(a.devProgress)) mism++;
    if (R.isPairedSubSkill(a, all) !== utils.isPairedSubSkill(a, all)) mism++;
  }
  ok(mism === 0, `ports agree with src/lib on ${all.length} docs (getType/normalizeProgress/isPairedSubSkill), mismatches=${mism}`);

  // Risk parity with the Dashboard: same items, same axis, server run in Bangkok calendar.
  const approved = all.filter((a) => a.approvalStatus === 'approved' && a.archived !== true);
  const items = approved.map(timeline.toTimelineItem);
  const axis = timeline.autoFitRange(items, milestones).start;
  const today = timeline.startOfToday();
  const serverAxis = R.autoFitStart(approved, milestones);
  const serverToday = R.bkkDay(new Date());
  let rmis = 0; let riskCount = 0;
  for (const it of items) {
    const c = timeline.timelineStatus(it, axis, today);
    const ld = it.launch ? R.bkkDay(it.launch) : null;
    const s = R.timelineStatus(it.progress, ld, serverAxis, serverToday);
    if (c !== s) { rmis++; if (rmis <= 5) console.log('    risk mismatch', it.name, c, s); }
    if (c === 'risk') riskCount++;
  }
  ok(rmis === 0, `timelineStatus parity on ${items.length} live items (client risk=${riskCount}), mismatches=${rmis}`);

  const ds = R.buildDigests(all, { milestones, now: new Date() });
  const counts = {};
  ds.forEach((d) => d.items.forEach((i) => { counts[i.category] = (counts[i.category] || 0) + 1; }));
  console.log(`\n  live run now: ${ds.length} digests · ${JSON.stringify(counts)}`);
  if (preview) {
    for (const d of ds) {
      console.log(`\n  → ${d.email} (${d.items.length})`);
      d.items.forEach((i) => console.log(`     [${i.category}] ${i.name} · ${i.progress}% · ${i.launchDay ? i.launchDay.toISOString().slice(0, 10) : 'no launch'} · ${i.bdays} bd`));
    }
  }
}

(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--live') || args.includes('--preview')) await live(args.includes('--preview'));
  console.log(`\n${fail ? '✗' : '✓'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
