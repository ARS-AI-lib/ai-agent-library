// One-time seed for /config/schema.team — the canonical org team list used
// as PreRegModal's Owner autocomplete + the Owner filter's option set
// (2026-08-10). Source: an org-wide team roster the user supplied, NOT
// derived from existing agent.owner values — those are free text and mostly
// don't match real team names (submitter codenames like "Wolfy",
// "arise-devops", "นกลงทุน" instead). This is additive only (arrayUnion):
// existing agent.owner values are explicitly left untouched per decision.
//
//   node functions/seed-team-schema.cjs           # dry run
//   node functions/seed-team-schema.cjs --apply
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');

const TEAMS = [
  'People Experience', 'Technology Enablement', 'Cloud Center of Excellence',
  'CEO Office', 'Corporate Experience', 'Design Office', 'Solar', 'Data',
  'Strategy Office', 'Transformation Management Office', 'Finance', 'Insurance',
  'Investment', 'Lotto', 'MarTech', 'Mobile as a Service', 'NEXT',
  'Open Bank : Mini App', 'Open Bank: Bank in Bank', 'Open Bank: Open API',
  'Open Bank: Paotang ID', 'Operation Portal', 'Paotang', 'Payment',
  'Production Reliability', 'Skillbased', 'TDP', 'Tech Innovation',
  'Transformation Innovation Lab', 'TungNgern', 'U-App', 'Welfare', 'eKYC',
  'Digital Core Banking', 'CDI', 'Health Platform', 'DGL',
  'Aomplearn & O2O & AriseWeb', 'Connext', 'Digital Payment Processor (DPP)',
  'FinOps', 'E-learning Platform', 'Fulfillment Portal',
];

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

(async () => {
  const ref = db.doc('config/schema');
  const cur = (await ref.get()).data() || {};
  const curTeams = Array.isArray(cur.team) ? cur.team : [];
  const existing = new Set(curTeams.map((t) => t.toLowerCase()));
  const adding = [...new Set(TEAMS)].filter((t) => !existing.has(t.toLowerCase()));

  console.log(`=== /config/schema.team: ${curTeams.length} -> ${curTeams.length + adding.length} ===`);
  adding.forEach((t) => console.log(`  +  ${t}`));
  if (!adding.length) console.log('  (already up to date)');

  console.log(`\n${APPLY ? 'WRITING' : 'DRY RUN — would write'} ${adding.length} new team(s)`);
  if (!APPLY) { console.log('re-run with --apply to write.'); return; }
  if (!adding.length) { console.log('nothing to do.'); return; }

  await ref.set({ team: FieldValue.arrayUnion(...adding) }, { merge: true });
  console.log('✓ written');
})();
