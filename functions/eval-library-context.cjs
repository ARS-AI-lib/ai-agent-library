// Leave-one-out eval: does team context make Pre-Reg area/category answers
// more consistent with how the library is already filed? Read-only.
//   node functions/eval-library-context.cjs [N=40]
//
// For each sampled approved item: hide its own area/category, build a draft
// from its fields, and run the REAL prompt (duplicatePrompt.js) twice —
//   without: no team context, candidates without owner/area/category (old behaviour)
//   with:    team context (item excluded) + candidates carrying owner/area/category
// Candidates are the same in both runs (same-category items, a stand-in for the
// client ranker), so the only difference is the context.
// Caveat: 54 stored areas were themselves AI-suggested (2026-09-28 backfill), so
// agreement partly measures consistency, not ground truth.
const { GoogleGenAI } = require('@google/genai');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { buildPrompt } = require('./duplicatePrompt');
const { summarizeTeam } = require('./libraryContextRules');
const { GEN_MODEL, THINK_OFF } = require('./modelConfig');

const N = Number(process.argv[2]) || 40;
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' }), 'ai-agent-lib');
const ai = new GoogleGenAI({ vertexai: true, project: 'wolfy-481609', location: 'asia-southeast1' });
const CONFIG = { temperature: 0.1, maxOutputTokens: 4096, responseMimeType: 'application/json', thinkingConfig: THINK_OFF };

async function ask(prompt) {
  for (let t = 0; t < 3; t += 1) {
    try {
      const r = await ai.models.generateContent({ model: GEN_MODEL, contents: [{ role: 'user', parts: [{ text: prompt }] }], config: CONFIG });
      return JSON.parse((r.text || '').replace(/^```(?:json)?|```$/g, ''));
    } catch (e) { if (t === 2) return null; }
  }
  return null;
}

(async () => {
  const schema = (await db.collection('config').doc('schema').get()).data() || {};
  const all = schema.category || [];
  const products = (schema.productCategory || []).filter((p) => all.includes(p));
  const catOpts = { all, products, disciplines: all.filter((c) => !products.includes(c)) };
  const areaOpts = schema.approveArea || [];
  const abil = schema.coreAbility || [];

  const agents = (await db.collection('agents').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const live = agents.filter((a) => a.approvalStatus === 'approved' && !a.archived && (a.approveArea || []).length && a.owner);
  // Stratified: every multi-item team gets a share; shuffled deterministically.
  const shuffled = live.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).filter((_, i) => i % Math.max(1, Math.floor(live.length / N)) === 0).slice(0, N);

  const disc = (cats) => (cats || []).filter((c) => !products.includes(c));
  const res = { without: { area: 0, cat: 0 }, with: { area: 0, cat: 0 }, n: 0, rows: [] };
  const run = async (a) => {
    const draft = { name: a.agentName, type: a.aiAgent === false && a.skillMd ? 'Skill' : 'Agent', scope: a.customerFacing ? 'External' : 'Internal', description: a.description, ability: a.coreAbility, input: a.input, output: a.output, businessValue: a.businessValue, owner: a.owner };
    const peers = agents.filter((b) => b.id !== a.id && b.approvalStatus === 'approved' && !b.archived && disc(b.category).some((c) => disc(a.category).includes(c))).slice(0, 8);
    const cands = (withCtx) => peers.map((b) => ({ agentName: b.agentName, description: b.description, coreAbility: b.coreAbility, reusable: b.reusable, ruleConfidence: 30, ...(withCtx ? { owner: b.owner, approveArea: b.approveArea || [], category: b.category || [] } : {}) }));
    const team = summarizeTeam(agents, a.owner, { excludeId: a.id, products });
    const [wo, wi] = await Promise.all([
      ask(buildPrompt(draft, cands(false), [], abil, catOpts, areaOpts, null)),
      ask(buildPrompt(draft, cands(true), [], abil, catOpts, areaOpts, team)),
    ]);
    if (!wo || !wi) return;
    const truthA = new Set(a.approveArea);
    const truthC = new Set(disc(a.category));
    const hitA = (r) => (Array.isArray(r.suggested_approve_area) ? r.suggested_approve_area : [r.suggested_approve_area]).some((x) => truthA.has(x));
    const hitC = (r) => (Array.isArray(r.suggested_category) ? r.suggested_category : [r.suggested_category]).some((x) => truthC.has(x));
    res.n += 1;
    res.without.area += hitA(wo); res.with.area += hitA(wi);
    res.without.cat += hitC(wo); res.with.cat += hitC(wi);
    res.rows.push({ name: a.agentName, team: a.owner, dom: team?.dominantArea || '-', truth: a.approveArea.join('+'), wo: (wo.suggested_approve_area || []).join('+'), wi: (wi.suggested_approve_area || []).join('+'), why: (wi.approve_area_reason || '').slice(0, 90) });
  };
  for (let i = 0; i < shuffled.length; i += 4) await Promise.all(shuffled.slice(i, i + 4).map(run));

  res.rows.forEach((r) => console.log(`${r.wo === r.truth ? ' ' : '·'}${r.wi.split('+').some((x) => r.truth.split('+').includes(x)) ? '✓' : '✗'} ${r.name.slice(0, 38).padEnd(38)} [${r.team}] dom=${r.dom} | truth=${r.truth} | without=${r.wo} | with=${r.wi}`));
  const pct = (x) => `${x}/${res.n} (${Math.round((x / res.n) * 100)}%)`;
  console.log(`\nApprove Area agreement   without ${pct(res.without.area)}  →  with ${pct(res.with.area)}`);
  console.log(`Category (discipline)    without ${pct(res.without.cat)}  →  with ${pct(res.with.cat)}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
