#!/usr/bin/env node
/**
 * Prove the childSkillIds link is a pure SUPERSET, and that the cascade guard
 * protects finished work (2026-08-20).
 *
 * Loads the real src/lib modules (same loadEsm technique as
 * verify-rename-cascade.cjs) so this exercises the actual resolver, not a copy.
 *
 * What it checks:
 *  1. SUPERSET — with no childSkillIds anywhere in live data, the new union
 *     branch must resolve EXACTLY the pairings the old heuristic did. This is
 *     the regression that would silently detach 51 existing sub-skills.
 *  2. THE GAP IT CLOSES — an explicit cross-submitter link (the case that
 *     fails today, ~98% of real pairs) must now resolve.
 *  3. CASCADE GUARD — a child further along than its parent is excluded; a
 *     child behind the parent is still included.
 *  4. MULTI-PARENT — linking a skill that already has a parent leaves the
 *     original intact.
 *  5. TYPE LABEL — agentTypeLabel() agrees everywhere, including for the 22
 *     CSV-imported docs that carry BOTH flags.
 *
 * Read-only: loads live data, writes nothing.
 *
 * Usage:  node functions/verify-child-links.cjs
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

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

let pass = 0;
let fail = 0;
function check(label, got, want) {
  const ok = got === want;
  ok ? (pass += 1) : (fail += 1);
  console.log(`   ${ok ? '✓' : '✗'} ${label}${ok ? '' : `   (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
}

/** The pre-change resolver, kept verbatim so "superset" is a real comparison. */
function oldPairedSubSkills(agent, all) {
  if (!agent || tier.getType(agent) !== 'agent') return [];
  const sameSubmitter = (a, b) => {
    if (a?.createdBy && b?.createdBy && a.createdBy === b.createdBy) return true;
    const ca = (a?.creator || '').trim().toLowerCase();
    const cb = (b?.creator || '').trim().toLowerCase();
    return !!ca && ca === cb;
  };
  return all.filter((s) => tier.getType(s) === 'skill'
    && s.id !== agent.id
    && sameSubmitter(s, agent)
    && utils.matchingAgentNames(s).includes(agent.agentName));
}

(async () => {
  const snap = await db.collection('agents').get();
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const live = all.filter((a) => a.approvalStatus === 'approved' && a.archived !== true);
  const agents = live.filter((a) => tier.getType(a) === 'agent');
  const skills = live.filter((a) => tier.getType(a) === 'skill');

  console.log(`live ${live.length} · agents ${agents.length} · skills ${skills.length}\n`);

  // ── 1. superset ─────────────────────────────────────────────────────
  console.log('1) SUPERSET — the new union must not change any existing pairing');
  const withLinks = live.filter((a) => utils.childSkillIdList(a).length > 0);
  console.log(`   docs already carrying childSkillIds: ${withLinks.length} (expected 0 before rollout)`);
  let drift = 0;
  let totalPairs = 0;
  agents.forEach((a) => {
    const before = new Set(oldPairedSubSkills(a, live).map((s) => s.id));
    const after = new Set(utils.pairedSubSkills(a, live).map((s) => s.id));
    totalPairs += before.size;
    const lost = [...before].filter((i) => !after.has(i));
    const gained = [...after].filter((i) => !before.has(i));
    if (lost.length || gained.length) {
      drift += 1;
      console.log(`   ✗ ${a.agentName} — lost ${lost.length}, gained ${gained.length}`);
    }
  });
  check(`all ${agents.length} agents resolve identically (${totalPairs} pairings intact)`, drift, 0);
  check('isPairedSubSkill unchanged for every skill',
    skills.every((s) => {
      const before = live.some((a) => tier.getType(a) === 'agent' && oldPairedSubSkills(a, live).some((x) => x.id === s.id));
      return utils.isPairedSubSkill(s, live) === before;
    }), true);

  // ── 2. the gap it closes ────────────────────────────────────────────
  console.log('\n2) THE GAP — explicit cross-submitter link now resolves');
  const parent = agents.find((a) => oldPairedSubSkills(a, live).length === 0);
  const foreign = skills.find((s) => {
    const ca = String(s.creator || '').trim().toLowerCase();
    const cb = String(parent?.creator || '').trim().toLowerCase();
    return ca && cb && ca !== cb && s.createdBy !== parent.createdBy;
  });
  console.log(`   parent "${parent.agentName}" (${parent.creator}) + foreign skill "${foreign.agentName}" (${foreign.creator})`);
  check('unlinked today (the silent-failure case)',
    oldPairedSubSkills(parent, live).some((s) => s.id === foreign.id), false);
  const linkedParent = { ...parent, childSkillIds: [foreign.id] };
  const fixture = live.map((a) => (a.id === parent.id ? linkedParent : a));
  check('resolves once explicitly linked',
    utils.pairedSubSkills(linkedParent, fixture).some((s) => s.id === foreign.id), true);
  check('and the skill now reports as a paired sub-skill',
    utils.isPairedSubSkill(foreign, fixture), true);

  // ── 3. cascade guard ────────────────────────────────────────────────
  console.log('\n3) CASCADE GUARD — a child ahead of the parent is not dragged back');
  const ahead = { ...foreign, id: 'child-ahead', devProgress: 100, endpoint: 'https://x/y', deploymentStatus: 'none' };
  const behind = { ...foreign, id: 'child-behind', devProgress: 0, deploymentStatus: 'none' };
  const p40 = { ...parent, devProgress: 40, deploymentStatus: 'none', childSkillIds: ['child-ahead', 'child-behind'] };
  const world = [...live.filter((a) => a.id !== parent.id), p40, ahead, behind];
  const targets = utils.cascadeTargets(p40, world).map((s) => s.id);
  check('parent at 40%: both children are linked', utils.pairedSubSkills(p40, world).length, 2);
  check('   child at 100% is EXCLUDED from cascade', targets.includes('child-ahead'), false);
  check('   child at 0% is still included', targets.includes('child-behind'), true);
  const deployedChild = { ...foreign, id: 'child-deployed', devProgress: 0, deploymentStatus: 'approved' };
  const world2 = [...live.filter((a) => a.id !== parent.id), { ...p40, childSkillIds: ['child-deployed'] }, deployedChild];
  check('   deploy-approved child excluded while parent is not',
    utils.cascadeTargets({ ...p40, childSkillIds: ['child-deployed'] }, world2).length, 0);

  // ── 4. multi-parent ─────────────────────────────────────────────────
  console.log('\n4) MULTI-PARENT — adding a parent does not steal from the first');
  const realParent = agents.find((a) => oldPairedSubSkills(a, live).length > 0);
  const realChild = oldPairedSubSkills(realParent, live)[0];
  const second = { ...parent, id: 'second-parent', childSkillIds: [realChild.id] };
  const world3 = [...live, second];
  check(`original parent "${realParent.agentName}" keeps the child`,
    utils.pairedSubSkills(realParent, world3).some((s) => s.id === realChild.id), true);
  check('new parent also resolves it',
    utils.pairedSubSkills(second, world3).some((s) => s.id === realChild.id), true);

  // ── 5. type label ───────────────────────────────────────────────────
  console.log('\n5) TYPE LABEL — one answer everywhere');
  const bothFlags = live.filter((a) => a.aiAgent === true && a.skillMd === true);
  console.log(`   CSV-imported docs carrying both flags: ${bothFlags.length}`);
  check('   none of them has children, so all read "Agent" now',
    bothFlags.every((a) => utils.agentTypeLabel(a, live) === 'Agent'), true);
  check('   an agent WITH children reads "Agent+Skill"',
    utils.agentTypeLabel(realParent, live), 'Agent+Skill');
  check('   a skill reads "Skill"', utils.agentTypeLabel(skills[0], live), 'Skill');
  check('   tier did NOT move for the both-flag docs (still Agent tier)',
    bothFlags.every((a) => ['T2', 'T4'].includes(tier.getTier(a))), true);

  console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
