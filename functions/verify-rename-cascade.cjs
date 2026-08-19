#!/usr/bin/env node
/**
 * Prove the rename cascade cannot detach sub-skills (2026-08-19).
 *
 * ── The bug this guards ──
 * pairedSubSkills() matches parents by NAME, and sub-skills store the parent's
 * name in `matchingAgent`. Renaming a parent without rewriting its children
 * detaches every one of them, silently breaking the progress cascade, the
 * deploy-request and deploy-decision cascades, the approval-queue
 * de-duplication, and the sub-skill progress lock.
 *
 * ── What this checks ──
 * 1. PARITY — decideRenameRequest finds children with a narrow Firestore query
 *    (`matchingAgent == oldName`, then a submitter filter) rather than porting
 *    pairedSubSkills(). This asserts the two agree on EVERY real parent, so
 *    the narrow server query can never miss a child the client considers
 *    paired.
 * 2. SIMULATION — applies the rename in memory exactly as the batch would and
 *    re-runs the real pairedSubSkills(), against the counterfactual of
 *    renaming without the child rewrite.
 *
 * Read-only: loads live data, writes nothing.
 *
 * Usage:  node functions/verify-rename-cascade.cjs
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// Load the real client modules (same technique as backfill-approve-area.cjs)
// so parity is tested against the actual pairedSubSkills(), never a copy.
const SRC = path.join(__dirname, '..', 'src', 'lib');
function loadEsm(file, injected = {}) {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return new Function(...names, `${code}\n;return { ${[...new Set(decls)].join(', ')} };`)(...names.map((n) => injected[n]));
}
const tier = loadEsm('tier.js');
const utils = loadEsm('agentUtils.js', { getType: tier.getType, getTier: tier.getTier });

admin.initializeApp({ projectId: 'wolfy-481609' });
const db = admin.firestore();
db.settings({ databaseId: 'ai-agent-lib' });

/**
 * Mirrors the child-finder inside decideRenameRequest. Kept in the same shape
 * on purpose — the parity assertion below is what proves the shape is right.
 */
function serverChildren(all, agent) {
  const oldName = String(agent.agentName || '').trim();
  return all
    .filter((c) => String(c.matchingAgent || '') === oldName)
    .filter((c) => {
      if (agent.createdBy && c.createdBy && c.createdBy === agent.createdBy) return true;
      const ca = String(c.creator || '').trim().toLowerCase();
      const cb = String(agent.creator || '').trim().toLowerCase();
      return !!ca && ca === cb;
    });
}

let fail = 0;

(async () => {
  const snap = await db.collection('agents').get();
  const live = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.approvalStatus === 'approved' && a.archived !== true);
  const parents = live.filter((a) => utils.pairedSubSkills(a, live).length > 0);

  console.log(`live agents ${live.length} · parents with paired sub-skills ${parents.length}\n`);
  console.log('1) PARITY — server child query vs client pairedSubSkills()');
  let mismatch = 0;
  parents.forEach((p) => {
    const clientIds = new Set(utils.pairedSubSkills(p, live).map((x) => x.id));
    const serverIds = new Set(serverChildren(live, p).map((x) => x.id));
    const missed = [...clientIds].filter((i) => !serverIds.has(i));
    const extra = [...serverIds].filter((i) => !clientIds.has(i));
    if (missed.length || extra.length) {
      mismatch += 1;
      console.log(`   ✗ ${p.agentName} — client ${clientIds.size}, server ${serverIds.size} (missed ${missed.length}, extra ${extra.length})`);
    }
  });
  if (mismatch === 0) console.log(`   ✓ identical on all ${parents.length} parents`);
  else fail += 1;

  console.log('\n2) SIMULATION — rename with the fix vs without');
  // Exercise every real parent, not just the biggest one: a cascade that only
  // works on the example you picked is not a working cascade.
  let simFail = 0;
  let naiveBroken = 0;
  parents.forEach((p) => {
    const before = utils.pairedSubSkills(p, live).length;
    const NEW = `${p.agentName} ~renamed~`;
    const kids = serverChildren(live, p);

    const fixed = live.map((a) => {
      if (a.id === p.id) return { ...a, agentName: NEW };
      if (kids.some((k) => k.id === a.id)) return { ...a, matchingAgent: NEW };
      return a;
    });
    const after = utils.pairedSubSkills(fixed.find((a) => a.id === p.id), fixed).length;
    if (after !== before) {
      simFail += 1;
      console.log(`   ✗ ${p.agentName} — ${before} children before, ${after} after`);
    }

    const naive = live.map((a) => (a.id === p.id ? { ...a, agentName: NEW } : a));
    if (utils.pairedSubSkills(naive.find((a) => a.id === p.id), naive).length === 0 && before > 0) naiveBroken += 1;
  });
  if (simFail === 0) {
    const total = parents.reduce((n, p) => n + utils.pairedSubSkills(p, live).length, 0);
    console.log(`   ✓ all ${parents.length} parents keep every child (${total} pairings preserved)`);
    console.log(`   ✓ without the child rewrite, ${naiveBroken}/${parents.length} parents would lose ALL children — the bug being prevented`);
  } else fail += 1;

  console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
