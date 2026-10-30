// Count every category tag from live Firestore data (READ-ONLY, 2026-10-30).
//
//   node functions/count-categories.cjs
//
// Written because CLAUDE.md §23 carried numbers nobody had re-measured
// ("CLICX / Core bank ยังเป็น 0", "239 ตัว มีแค่ 5 ตัวที่ผูกกับ product") and at
// least one of them was already false before 2026-10-30. This reports the real
// counts so the doc can be corrected from data, not from memory.
//
// Counts `category` through the real `agentCategories()` helper (CLAUDE.md §23:
// never read the field by hand) and splits products from disciplines using
// `VERTICAL_CATEGORIES` — the single source of truth for the product list.
// Writes nothing.
const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const SRC = path.join(__dirname, '..', 'src', 'lib');

function loadEsm(file, injected = {}) {
  const code = fs
    .readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  const body = `${code}\n;return { ${[...new Set(decls)].join(', ')} };`;
  return new Function(...names, body)(...names.map((n) => injected[n]));
}

const tier = loadEsm('tier.js');
const utils = loadEsm('agentUtils.js', { getType: tier.getType, getTier: tier.getTier });
const areas = loadEsm('approveAreas.js', {
  agentProcessIds: utils.agentProcessIds,
  splitRoles: utils.splitRoles,
  agentCategories: utils.agentCategories,
  isInternalOrExternal: tier.isInternalOrExternal,
});
const { agentCategories } = utils;
const { VERTICAL_CATEGORIES, CATEGORY_AREA } = areas;
if (typeof agentCategories !== 'function') {
  console.error('✗ failed to load src/lib/agentUtils.js — aborting');
  process.exit(1);
}

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

const pad = (s, n) => String(s).padEnd(n);
const num = (n) => String(n).padStart(4);

(async () => {
  const [agentSnap, schemaSnap] = await Promise.all([
    db.collection('agents').get(),
    db.doc('config/schema').get(),
  ]);
  const rows = agentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const schemaCats = Array.isArray(schemaSnap.data()?.category) ? schemaSnap.data().category : [];
  const areaKeys = Object.keys(CATEGORY_AREA);

  const live = (a) => a.approvalStatus === 'approved' && !a.archived;
  const rowsLive = rows.filter(live);

  // Tally. `blank` = doc whose category is missing/empty; `legacy` = a bare
  // string (pre-array docs) which agentCategories() intentionally drops — we
  // report it rather than let it vanish silently.
  const tally = (set) => {
    const m = new Map();
    let blank = 0;
    const legacy = [];
    for (const a of set) {
      const cats = agentCategories(a);
      if (!cats.length) {
        blank++;
        if (typeof a.category === 'string' && a.category.trim()) legacy.push(a.id);
      }
      for (const c of cats) m.set(c, (m.get(c) || 0) + 1);
    }
    return { m, blank, legacy };
  };
  const all = tally(rows);
  const liv = tally(rowsLive);

  const multiProduct = rows.filter((a) => agentCategories(a).filter((c) => VERTICAL_CATEGORIES.includes(c)).length > 1);
  const unknown = [...new Set([...all.m.keys(), ...liv.m.keys()].filter((c) => !areaKeys.includes(c) && !schemaCats.includes(c)))];
  const notInSchema = [...new Set([...all.m.keys()].filter((c) => !schemaCats.includes(c)))];

  const totalProducts = (t) => [...t.m.entries()].filter(([c]) => VERTICAL_CATEGORIES.includes(c)).reduce((s, [, n]) => s + n, 0);
  const docsWithProduct = (set) => set.filter((a) => agentCategories(a).some((c) => VERTICAL_CATEGORIES.includes(c))).length;

  console.log(`docs in collection: ${rows.length}   ·   live (approved + not archived): ${rowsLive.length}\n`);

  console.log(`── PRODUCT VERTICALS (VERTICAL_CATEGORIES, ${VERTICAL_CATEGORIES.length}) ──`);
  for (const c of VERTICAL_CATEGORIES) console.log(`  ${pad(c, 30)} live ${num(liv.m.get(c) || 0)}  ·  all ${num(all.m.get(c) || 0)}`);
  console.log(`  ${pad('— docs carrying >=1 product', 30)} live ${num(docsWithProduct(rowsLive))}  ·  all ${num(docsWithProduct(rows))}   (tags: live ${totalProducts(liv)} · all ${totalProducts(all)})`);

  console.log(`\n── NON-PRODUCT CATEGORIES (= keys of CATEGORY_AREA that are not verts, ${areaKeys.length - VERTICAL_CATEGORIES.length}) ──`);
  for (const c of areaKeys) {
    if (VERTICAL_CATEGORIES.includes(c)) continue;
    console.log(`  ${pad(c, 30)} live ${num(liv.m.get(c) || 0)}  ·  all ${num(all.m.get(c) || 0)}`);
  }

  console.log(`\n── DATA QUALITY ──`);
  console.log(`  docs with NO category at all          live ${num(liv.blank)}  ·  all ${num(all.blank)}`);
  console.log(`  docs with a legacy STRING category    all ${num(all.legacy.length)}${all.legacy.length ? `  (${all.legacy.join(', ')})` : ''}`);
  console.log(`  docs carrying 2+ PRODUCTS (by design?) all ${num(multiProduct.length)}`);
  for (const a of multiProduct) {
    const p = agentCategories(a).filter((c) => VERTICAL_CATEGORIES.includes(c));
    console.log(`      ${pad(a.id, 22)} [${p.join(' + ')}]  ${String(a.agentName || '').slice(0, 40)}`);
  }
  console.log(`  values on docs but NOT in /config/schema.category (${notInSchema.length})${notInSchema.length ? `: ${notInSchema.join(', ')}` : ''}`);
  if (unknown.length) console.log(`  ⚠ values in NEITHER schema NOR CATEGORY_AREA (${unknown.length}): ${unknown.join(', ')}`);

  const schemaZero = schemaCats.filter((c) => !all.m.get(c));
  console.log(`\n── /config/schema.category (${schemaCats.length} values) ──`);
  console.log(`  with 0 docs (${schemaZero.length}): ${schemaZero.join(' · ') || '—'}`);
})().catch((e) => { console.error(e); process.exit(1); });
