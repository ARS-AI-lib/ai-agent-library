// Duplicate-check eval (2026-11-26). Read-only against Firestore; calls Vertex.
//   node functions/eval-duplicate.cjs            # run
//   node functions/eval-duplicate.cjs --regen    # rebuild the reworded cases file
// Env: DUP_THINK=MINIMAL|LOW|MEDIUM|HIGH (default = modelConfig DUP_THINK or THINK_OFF)
//
// Two sets:
//   must-block — real library items reworded by Gemini (new name, Thai wording,
//                same job). The original stays in the library; the check must block.
//   LOO        — the latest approved items as drafts vs library minus themselves.
//                Blocks here are listed for a human to judge (some are real duplicates
//                already in the library, some would be false blocks).
// Candidates mirror search_library in src/lib/skills.js (rule top-15 ∪ semantic top-12).
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { buildPrompt } = require('./duplicatePrompt');
const { embedTexts } = require('./embedText');
const mc = require('./modelConfig');

const SRC = path.join(__dirname, '..', 'src', 'lib');
function loadEsm(file, injected = {}) {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8')
    .replace(/^\s*import\s[^;]*;\s*$/gm, '').replace(/^export\s+/gm, '');
  const names = Object.keys(injected);
  const decls = [...code.matchAll(/^(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  return new Function(...names, `${code}\n;return { ${[...new Set(decls)].join(', ')} };`)(...names.map((n) => injected[n]));
}
const { rankCandidates, scoreDraftAgainst } = loadEsm('similarity.js');
const { duplicateBlock } = loadEsm('dupBlock.js');

const CASES_FILE = path.join(__dirname, 'eval-duplicate-cases.json');
const N_BLOCK = 12;
const N_LOO = 30;
const THINK = process.env.DUP_THINK ? { thinkingLevel: process.env.DUP_THINK } : (mc.DUP_THINK || mc.THINK_OFF);
const db = getFirestore(initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' }), 'ai-agent-lib');
const ai = new GoogleGenAI({ vertexai: true, project: 'wolfy-481609', location: 'asia-southeast1' });
const CONFIG = { temperature: 0.1, maxOutputTokens: mc.DUP_MAX_TOKENS || 4096, responseMimeType: 'application/json', thinkingConfig: THINK };

async function ask(prompt, config = CONFIG) {
  for (let t = 0; t < 3; t += 1) {
    try {
      const r = await ai.models.generateContent({ model: mc.GEN_MODEL, contents: [{ role: 'user', parts: [{ text: prompt }] }], config });
      return JSON.parse((r.text || '').replace(/^```(?:json)?\s*|```\s*$/g, ''));
    } catch (e) { if (t === 2) { console.warn('  ask failed:', e.message?.slice(0, 120)); return null; } }
  }
  return null;
}
const cosine = (a, b) => { if (!a || !b) return 0; let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / (Math.sqrt(x) * Math.sqrt(y)); };
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const useCaseNames = (a) => arr(a.useCase).join(', ');

(async () => {
  const schema = (await db.collection('config').doc('schema').get()).data() || {};
  const all = schema.category || [];
  const products = (schema.productCategory || []).filter((p) => all.includes(p));
  const catOpts = { all, products, disciplines: all.filter((c) => !products.includes(c)) };
  const agents = (await db.collection('agents').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const lib = agents.filter((a) => a.approvalStatus === 'approved');
  const vectors = new Map((await db.collection('agentVectors').get()).docs.map((d) => [d.id, d.data()?.v]).filter(([, v]) => Array.isArray(v)));
  const archivedByName = new Map(lib.map((a) => [String(a.agentName || '').trim().toLowerCase(), a.archived === true]));
  const isArchived = (name) => archivedByName.get(String(name || '').trim().toLowerCase()) === true;
  const live = lib.filter((a) => !a.archived);

  // ── cases ──
  let cases = fs.existsSync(CASES_FILE) && !process.argv.includes('--regen') ? JSON.parse(fs.readFileSync(CASES_FILE, 'utf8')) : null;
  if (!cases) {
    const pool = live.filter((a) => a.reusable === 'Reusable' && (a.description || '').length > 80 && a.input && a.output)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const step = Math.max(1, Math.floor(pool.length / N_BLOCK));
    const picks = pool.filter((_, i) => i % step === 0).slice(0, N_BLOCK);
    cases = [];
    for (const a of picks) {
      const r = await ask(`เขียน Agent/Skill ด้านล่างใหม่ เหมือนเป็นอีกคนที่ไม่รู้ว่ามีตัวนี้อยู่แล้ว แล้วกำลังจะลงทะเบียนงานเดียวกัน:
- ตั้งชื่อใหม่ที่ไม่ซ้ำคำเดิม
- เขียน description/input/output/businessValue ใหม่เป็นภาษาไทยปนอังกฤษ ด้วยถ้อยคำต่างจากเดิม แต่ทำงานเหมือนเดิมทุกอย่าง
ตอบ JSON: {"name":"","description":"","input":"","output":"","businessValue":""}
ต้นฉบับ: ${JSON.stringify({ name: a.agentName, description: a.description, input: a.input, output: a.output, businessValue: a.businessValue })}`,
      { temperature: 0.7, maxOutputTokens: 2048, responseMimeType: 'application/json', thinkingConfig: mc.THINK_OFF });
      if (r?.name) cases.push({ originalId: a.id, originalName: a.agentName, owner: a.owner || '', ability: arr(a.coreAbility), ...r });
    }
    fs.writeFileSync(CASES_FILE, `${JSON.stringify(cases, null, 2)}\n`);
    console.log(`wrote ${cases.length} cases → ${path.relative(process.cwd(), CASES_FILE)}`);
  }

  // ── one run ──
  async function check(draft, excludeId) {
    const library = lib.filter((a) => a.id !== excludeId);
    const d = { agentName: draft.name, description: draft.description, coreAbility: arr(draft.ability), input: draft.input, output: draft.output, businessValue: draft.businessValue };
    const rule = rankCandidates(d, library, 15);
    const [qv] = await embedTexts(ai, [[d.agentName, d.description, `input: ${d.input}`, `output: ${d.output}`, d.coreAbility.join(', '), d.businessValue].join('. ').replace(/\s+/g, ' ').trim()], 'RETRIEVAL_QUERY');
    const seen = new Set(rule.map((r) => r.existing.id));
    const sem = library.map((a) => ({ a, s: cosine(qv, vectors.get(a.id)) })).filter((x) => x.s > 0 && !seen.has(x.a.id))
      .sort((x, y) => y.s - x.s).slice(0, 12).map(({ a }) => ({ existing: a, ...scoreDraftAgainst(d, a) }));
    const top = [...rule, ...sem];
    const candidates = top.map((m) => ({
      agentName: m.existing.agentName, description: m.existing.description || '', coreAbility: m.existing.coreAbility,
      useCase: useCaseNames(m.existing), reusable: m.existing.reusable || '', reuseCondition: m.existing.reuseCondition || '',
      archived: m.existing.archived === true, archiveReason: m.existing.archiveReason || '', ruleConfidence: Math.round(m.confidence),
      owner: m.existing.owner || '', approveArea: arr(m.existing.approveArea), category: arr(m.existing.category),
      input: m.existing.input || '', output: m.existing.output || '',
    }));
    const payload = { name: d.agentName, type: 'Agent', scope: 'Internal', description: d.description, owner: draft.owner || '', ability: d.coreAbility, input: d.input, output: d.output, businessValue: d.businessValue, reusable: 'Reusable', reuseCondition: '' };
    const res = await ask(buildPrompt(payload, candidates, [], schema.coreAbility || [], catOpts, schema.approveArea || [], null));
    return { res, top };
  }
  const oldBlock = (r) => (r?.candidates || []).some((c) => c.verdict === 'clear_duplicate' && c.confidence >= 70);

  console.log(`model=${mc.GEN_MODEL} think=${THINK.thinkingLevel}\n── must-block (${cases.length}) ──`);
  const mb = { n: 0, sent: 0, aiFound: 0, old: 0, neu: 0, soft: 0 };
  const runCase = async (c) => {
    const { res, top } = await check(c, null);
    if (!res) return;
    const pos = top.findIndex((m) => m.existing.id === c.originalId);
    const hit = (res.candidates || []).find((x) => x.agentName === c.originalName);
    const nb = duplicateBlock(res, isArchived);
    mb.n += 1; mb.sent += pos >= 0 && pos < (Number(process.env.DUP_CAP) || 999) ? 1 : 0;
    mb.aiFound += hit ? 1 : 0; mb.old += oldBlock(res) ? 1 : 0; mb.neu += nb.blocked ? 1 : 0; mb.soft += nb.needsJustification ? 1 : 0;
    console.log(`${nb.blocked ? '✓' : nb.needsJustification ? '~' : '✗'} ${c.name.slice(0, 40).padEnd(40)} ← ${c.originalName.slice(0, 32).padEnd(32)} pos=${pos} ai=${hit ? `${hit.verdict}/${hit.confidence}` : '-'} risk=${res.overall_risk} old=${oldBlock(res) ? 'B' : '-'}`);
  };
  for (let i = 0; i < cases.length; i += 4) await Promise.all(cases.slice(i, i + 4).map(runCase));

  const loo = live.slice().sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)).slice(0, N_LOO);
  console.log(`\n── leave-one-out (${loo.length} latest approved) — blocks to review ──`);
  const lo = { n: 0, old: 0, neu: 0, soft: 0 };
  const runLoo = async (a) => {
    const { res } = await check({ name: a.agentName, description: a.description, ability: a.coreAbility, input: a.input, output: a.output, businessValue: a.businessValue, owner: a.owner }, a.id);
    if (!res) return;
    const nb = duplicateBlock(res, isArchived);
    lo.n += 1; lo.old += oldBlock(res) ? 1 : 0; lo.neu += nb.blocked ? 1 : 0; lo.soft += nb.needsJustification ? 1 : 0;
    if (nb.blocked || nb.needsJustification || oldBlock(res)) console.log(`${nb.blocked ? 'B' : nb.needsJustification ? 'J' : '-'} ${a.agentName.slice(0, 40).padEnd(40)} ≈ ${(nb.candidate?.agentName || '-').slice(0, 36).padEnd(36)} ${nb.candidate?.verdict || ''}/${nb.candidate?.confidence ?? ''} [${nb.reason || 'old-only'}]`);
  };
  for (let i = 0; i < loo.length; i += 4) await Promise.all(loo.slice(i, i + 4).map(runLoo));

  console.log(`\nmust-block: AI saw original ${mb.aiFound}/${mb.n} · blocked old-rule ${mb.old}/${mb.n} · new-rule hard ${mb.neu}/${mb.n} + reason-required ${mb.soft}/${mb.n}${process.env.DUP_CAP ? ` · original within cap ${mb.sent}/${mb.n}` : ''}`);
  console.log(`LOO:        blocked old-rule ${lo.old}/${lo.n} · new-rule hard ${lo.neu}/${lo.n} + reason-required ${lo.soft}/${lo.n}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
