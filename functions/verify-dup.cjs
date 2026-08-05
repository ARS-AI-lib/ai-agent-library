// Does the semantic arm actually rescue duplicates the rule scorer buries?
// Real library, real vectors. Run: node functions/verify-dup.cjs
const { GoogleGenAI } = require('@google/genai');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { embedTexts } = require('./embedText');

const PROJECT = 'wolfy-481609';
const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const db = getFirestore(app, 'ai-agent-lib');
const ai = new GoogleGenAI({ vertexai: true, project: PROJECT, location: 'asia-southeast1' });

// ── verbatim from src/lib/similarity.js ──
const norm = (s) => (s || '').toString().toLowerCase().replace(/tbc/g, '').replace(/[.,;:()/\-_]/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').filter((w) => w.length > 2);
function jaccard(a, b) { const ta = new Set(toks(a)), tb = new Set(toks(b)); if (!ta.size || !tb.size) return 0; let i = 0; ta.forEach((t) => { if (tb.has(t)) i++; }); return i / (ta.size + tb.size - i); }
function lev(a, b) { const m = a.length, n = b.length; const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 0; j <= n; j++) dp[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]); return dp[m][n]; }
function levSim(a, b) { const na = norm(a), nb = norm(b); if (!na || !nb) return 0; if (na === nb) return 100; return Math.max(0, (1 - lev(na, nb) / Math.max(na.length, nb.length)) * 100); }
function textSim(a, b) { const na = norm(a), nb = norm(b); if (!na || !nb) return 0; if (na === nb) return 100; return Math.max(jaccard(a, b) * 100, levSim(a, b)); }
const W = { agentName: .25, description: .25, coreAbility: .15, input: .15, output: .15, businessValue: .05 };
const at = (v) => (Array.isArray(v) ? v.join(', ') : v || '');
function scoreDraftAgainst(d, e) {
  const f = { agentName: textSim(d.agentName, e.agentName), description: textSim(d.description, e.description), coreAbility: textSim(at(d.coreAbility), at(e.coreAbility)), input: textSim(d.input, e.input), output: textSim(d.output, e.output), businessValue: textSim(d.businessValue, e.businessValue) };
  return Object.entries(W).reduce((s, [k, w]) => s + (f[k] || 0) * w, 0);
}
const cos = (a, b) => { if (!a || !b) return 0; let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i]*b[i]; x += a[i]*a[i]; y += b[i]*b[i]; } return d / (Math.sqrt(x) * Math.sqrt(y)); };

const RULE_WINDOW = 15;
const SEM_TOP_K = 12;

// Drafts that ARE duplicates of something real, worded differently on purpose.
const DRAFTS = [
  ['ไทย เขียนคนละคำ', 'TC Writer', { agentName: 'ผู้ช่วยร่างกรณีทดสอบ', description: 'เครื่องมือช่วยยกร่างกรณีทดสอบ พร้อมผลลัพธ์ที่คาดหวัง จากเอกสารความต้องการ', input: 'เอกสารความต้องการ', output: 'กรณีทดสอบ', coreAbility: ['Testing & QA'], businessValue: 'ลดเวลาทีมทดสอบ' }],
  ['อังกฤษ ทับของไทย', 'TC Writer', { agentName: 'Test Case Generator', description: 'Generates test cases with expected results from requirement documents automatically', input: 'requirement doc', output: 'test cases', coreAbility: ['Testing & QA'], businessValue: 'faster QA' }],
  ['ไทย ทับ user story', 'User Story Writer', { agentName: 'ตัวช่วยแตกความต้องการเป็นเรื่องเล่าผู้ใช้', description: 'แปลงความต้องการทางธุรกิจให้เป็นเรื่องเล่าของผู้ใช้ พร้อมเงื่อนไขการยอมรับ', input: 'ความต้องการธุรกิจ', output: 'เรื่องเล่าผู้ใช้', coreAbility: ['Documentation'], businessValue: '' }],
];

(async () => {
  const [aSnap, vSnap] = await Promise.all([db.collection('agents').get(), db.collection('agentVectors').get()]);
  const vecs = new Map(vSnap.docs.map((d) => [d.id, d.data().v]));
  const lib = aSnap.docs.map((d) => ({ id: d.id, ...d.data() })); // analysisLib = everything
  console.log(`library (incl. archived): ${lib.length}\n`);

  const qv = await embedTexts(ai, DRAFTS.map(([, , d]) =>
    [d.agentName, d.description, `input: ${d.input}`, `output: ${d.output}`, at(d.coreAbility), d.businessValue].join('. ').replace(/\s+/g, ' ').trim()
  ), 'RETRIEVAL_QUERY');

  DRAFTS.forEach(([label, target, draft], i) => {
    const ruleRank = lib.map((e) => ({ n: e.agentName, s: scoreDraftAgainst(draft, e) })).sort((a, b) => b.s - a.s);
    const rulePos = ruleRank.findIndex((x) => x.n === target) + 1;
    const inWindow = rulePos > 0 && rulePos <= RULE_WINDOW;

    const semRank = lib.map((e) => ({ n: e.agentName, s: cos(qv[i], vecs.get(e.id)) })).sort((a, b) => b.s - a.s);
    const semPos = semRank.findIndex((x) => x.n === target) + 1;
    const inSem = semPos > 0 && semPos <= SEM_TOP_K;

    console.log(`— ${label}  (ตัวซ้ำจริง: ${target})`);
    console.log(`   rule-based  อันดับ #${rulePos}/${lib.length}  → ${inWindow ? 'อยู่ใน top-15 ✅' : 'หลุด top-15 ❌ AI ไม่เห็น'}`);
    console.log(`   semantic    อันดับ #${semPos}/${lib.length}  → ${inSem ? 'อยู่ใน top-12 ✅' : 'หลุด top-12 ❌'}`);
    console.log(`   union       → ${inWindow || inSem ? '✅ AI ได้เห็น' : '❌ ยังพลาด'}\n`);
  });
})().catch((e) => { console.error('FAILED:', e.message || e); process.exit(1); });
