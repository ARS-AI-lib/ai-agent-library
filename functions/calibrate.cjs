// Calibration: real 244-item library, embeddings vs the lexical scorer that is
// live today. Run: node functions/calibrate.cjs
const { GoogleGenAI } = require('@google/genai');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { embedTexts } = require('./embedText');

const PROJECT = 'wolfy-481609';
const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const db = getFirestore(app, 'ai-agent-lib');
const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: 'asia-southeast1' });

// ── verbatim copy of scoreText() from src/lib/skills.js, for comparison only ──
const norm = (s) => (Array.isArray(s) ? s.join(' ') : (s || '')).toString().toLowerCase().trim();
const MIN_TRIGRAM_HITS = 3;
const QUERY_STOPWORDS = new Set(['สร้าง','ช่วย','ทำ','ใช้','หา','ตัว','ไหน','เรื่อง','การ','ได้','บ้าง','มี','ที่','create','creating','make','making','help','helps','generate','generating','build','building','do','does','get','the','for','with','and','any']);
function scoreText(hay, query) {
  const q = norm(query);
  const raw = q.split(/\s+/).filter((w) => w.length >= 2);
  const meaningful = raw.filter((w) => !QUERY_STOPWORDS.has(w));
  const chunks = meaningful.length ? meaningful : raw;
  const flat = chunks.join('').replace(/\s+/g, '');
  const tri = flat.length >= 3 ? Array.from({ length: flat.length - 2 }, (_, i) => flat.slice(i, i + 3)) : (flat ? [flat] : []);
  const ch = chunks.filter((w) => hay.includes(w)).length;
  const tg = tri.filter((g) => hay.includes(g)).length;
  if (ch === 0 && tg < MIN_TRIGRAM_HITS) return 0;
  return ch * 5 + tg;
}
const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i]*b[i]; x += a[i]*a[i]; y += b[i]*b[i]; } return d / (Math.sqrt(x) * Math.sqrt(y)); };

const QUERIES = [
  ['มีอะไรช่วยเขียนเทสเคสได้บ้าง', false],
  ['เทสเคส', false],
  ['automate test', false],
  ['มีตัวไหนช่วยเรื่อง design system บ้าง', false],
  ['ตัวไหนช่วยวิเคราะห์สินเชื่อ', false],
  ['ตัวไหนช่วย debug bug', false],
  ['มีอะไรช่วยเรื่องเอกสาร', false],
  ['สร้าง user story', false],
  ['มีตัวไหนช่วยจองตั๋วเครื่องบิน', true],
  ['ช่วยแปลภาษาญี่ปุ่นเป็นไทย', true],
];

(async () => {
  const [aSnap, vSnap] = await Promise.all([db.collection('agents').get(), db.collection('agentVectors').get()]);
  const vecs = new Map(vSnap.docs.map((d) => [d.id, d.data().v]));
  // recommendLib equivalent: approved + not archived
  const lib = aSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.approvalStatus === 'approved' && a.archived !== true)
    .map((a) => ({
      id: a.id, name: a.agentName,
      hay: norm([a.agentName, a.description, a.input, a.output, a.businessValue, a.coreAbility].join(' ')),
      v: vecs.get(a.id),
    }));
  const withVec = lib.filter((a) => a.v);
  console.log(`recommendable: ${lib.length}   with vector: ${withVec.length}\n`);

  const qv = await embedTexts(ai, QUERIES.map(([q]) => q), 'RETRIEVAL_QUERY');
  const summary = [];

  QUERIES.forEach(([q, isFake], qi) => {
    const emb = withVec.map((a) => ({ n: a.name, s: cos(qv[qi], a.v) })).sort((x, y) => y.s - x.s);
    const lex = lib.map((a) => ({ n: a.name, s: scoreText(a.hay, q) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
    const top = lex.length ? lex[0].s : 0;
    const lexKept = lex.filter((x) => x.s >= Math.max(top * 0.4, 2));

    console.log(`${isFake ? '❌' : '  '} "${q}"`);
    console.log(`   embeddings              | ปัจจุบัน (lexical, ${lexKept.length} ผ่าน)`);
    for (let i = 0; i < 5; i++) {
      const e = emb[i] ? `${emb[i].s.toFixed(3)} ${emb[i].n}`.slice(0, 40).padEnd(40) : ''.padEnd(40);
      const l = lexKept[i] ? `${String(lexKept[i].s).padStart(3)} ${lexKept[i].n}`.slice(0, 36) : '—';
      console.log(`   ${e}| ${l}`);
    }
    console.log('');
    summary.push([q, isFake, emb[0]?.s || 0, emb[7]?.s || 0]);
  });

  console.log('════ คะแนน cosine: จริง vs หลอก ════');
  summary.forEach(([q, f, top]) => console.log(`  ${f ? '❌' : '  '} ${top.toFixed(3)}  ${q}`));
  const real = summary.filter((s) => !s[1]).map((s) => s[2]);
  const fake = summary.filter((s) => s[1]).map((s) => s[2]);
  console.log(`\n  จริงต่ำสุด ${Math.min(...real).toFixed(3)} | หลอกสูงสุด ${Math.max(...fake).toFixed(3)} → ${Math.min(...real) > Math.max(...fake) ? '✅ floor ใช้ได้' : '❌ ห้ามใช้ floor (ยืนยันเดิม)'}`);
})().catch((e) => { console.error('FAILED:', e.message || e); process.exit(1); });
