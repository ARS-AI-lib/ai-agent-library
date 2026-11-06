// Guard the Category → sidebar-group table (2026-11-06).
//   node functions/verify-category-groups.cjs
//
// Same loader as verify-fold-parity.cjs: strip import/export so the SHIPPED
// src/lib/approveAreas.js is what gets tested, with the two modules it imports
// injected (same shape as inspect-sit-name.cjs).
const fs = require('fs');
const path = require('path');

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
const A = loadEsm('approveAreas.js', {
  agentProcessIds: utils.agentProcessIds,
  splitRoles: utils.splitRoles,
  agentCategories: utils.agentCategories,
  isInternalOrExternal: tier.isInternalOrExternal,
});

const {
  CATEGORY_GROUPS, CATEGORY_ORDER, CATEGORY_GROUP, CATEGORY_FALLBACK_GROUP,
  categoryGroupName, groupCategories, VERTICAL_CATEGORIES, CATEGORY_AREA,
} = A;

let fails = 0;
const eq = (a, b, msg) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) {
    console.log('   got     :', JSON.stringify(a));
    console.log('   expected:', JSON.stringify(b));
    fails++;
  }
};

// 1. group order is exactly the 7 agreed labels, Business & Product first
eq(CATEGORY_ORDER, ['Business & Product', 'Support Functions', 'Design & Content',
  'Engineering', 'Quality', 'Operations', 'Assistants'], 'CATEGORY_ORDER = the 7 groups in order');

// 2. Business & Product is derived from VERTICAL_CATEGORIES (exact, same order)
eq(CATEGORY_GROUPS[0].items, VERTICAL_CATEGORIES, 'Business & Product items === VERTICAL_CATEGORIES');

// 3. Review Focus #3: every known category maps to a real group, not the fallback
const orphans = Object.keys(CATEGORY_AREA).filter((c) => categoryGroupName(c) === CATEGORY_FALLBACK_GROUP);
eq(orphans, [], 'every CATEGORY_AREA key maps to a defined group (no silent Unassigned)');

// 4. Review Focus #1: unknown category is kept, in the Unassigned bucket
const withUnknown = groupCategories(['Investment', 'Brand New Category']);
eq(withUnknown[withUnknown.length - 1], { group: 'Unassigned', items: ['Brand New Category'] },
  'unknown category lands in Unassigned');

// 5. Review Focus #2: empty input → no groups at all
eq(groupCategories([]), [], 'empty input returns no groups');

// 6. grouping buckets by group order and keeps input order inside each bucket
const g = groupCategories(['Security', 'Investment', 'QA', 'SIT', 'Virtual Assistant']);
eq(g.map((x) => x.group), ['Business & Product', 'Quality', 'Assistants'],
  'groups appear in CATEGORY_ORDER, empty groups omitted');
eq(g.find((x) => x.group === 'Quality').items, ['Security', 'QA', 'SIT'],
  'input order kept inside a bucket (not the table order)');

// 7. no name is ever dropped; every input name appears exactly once
const all = ['Investment', 'Requirements & Product', 'UX Research', 'Architecture', 'SIT',
  'DevOps & Platform', 'Virtual Assistant', 'Totally New'];
const flat = groupCategories(all).flatMap((x) => x.items);
eq([...flat].sort(), [...all].sort(), 'no name dropped or duplicated');

// 8. map agrees with the buckets (one table, not two)
eq(CATEGORY_GROUP['Virtual Assistant'], 'Assistants', "CATEGORY_GROUP['Virtual Assistant'] === 'Assistants'");
eq(CATEGORY_GROUP['Investment'], 'Business & Product', "CATEGORY_GROUP['Investment'] === 'Business & Product'");

if (fails) { console.error(`\n✗ ${fails} case(s) failed`); process.exit(1); }
console.log('\n✓ all category-group cases pass');
