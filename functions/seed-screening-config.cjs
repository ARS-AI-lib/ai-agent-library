// Seed /config/screening from DEFAULT_CONFIG (src/lib/screening.js). Dry-run unless --apply.
// Never overwrites an existing doc (edits live in Assessment Settings). Needs ADC.
//   node functions/seed-screening-config.cjs [--apply]
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
function loadEsm(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', file), 'utf8').replace(/^\s*import\s[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return new Function(`${code}\n;return { ${[...new Set(decls)].join(', ')} };`)();
}
const { DEFAULT_CONFIG } = loadEsm('screening.js');
const { validateScreeningConfig } = require('./screeningConfigRules');
const APPLY = process.argv.includes('--apply');
(async () => {
  const err = validateScreeningConfig(DEFAULT_CONFIG);
  if (err) { console.error('DEFAULT_CONFIG invalid:', err); process.exit(1); }
  const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT || 'wolfy-481609' }), 'ai-agent-lib');
  const ref = db.doc('config/screening');
  const snap = await ref.get();
  if (snap.exists) { console.log(`/config/screening already exists (version ${snap.data().version}) — nothing to do`); process.exit(0); }
  console.log(`would write ${DEFAULT_CONFIG.questions.length} questions, ${DEFAULT_CONFIG.questions.reduce((n, q) => n + q.options.length, 0)} options`);
  if (!APPLY) { console.log('dry-run — pass --apply to write'); process.exit(0); }
  await ref.set({ ...DEFAULT_CONFIG, version: 1, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'seed', history: [{ by: 'seed', at: new Date().toISOString(), version: 1, summary: 'seeded from bank questionnaire' }] });
  console.log('written');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
