// Screening questionnaire engine (2026-11-26). The QUESTIONS live in a config object
// (`/config/screening`, editable in Assessment Settings); DEFAULT_CONFIG below is the seed and the
// fallback — ported from the bank's 20261123_Skill_Library_Screening_sent.html with "skill" → "Agent/Skill".
// Answers are stored as { questionId: optionId } (stable ids). v1 records stored option INDEXES;
// normalizeAnswers() converts them. ⛔ Do not copy scoring/gate logic elsewhere — import from here.
// D1–D6 (the creator's declaration) live in the registration form: see src/lib/declaration.js.
export const HIT_SCORE = 3;   // an option scoring >= this is a "main factor"

export const DEFAULT_CONFIG = {
  version: 1,
  thresholds: { md: 7, hi: 14 },
  questions: [
  {
    id: "C1", code: "C1", stage: 'pre', group: "หน้าที่ของ skill",
    th: "Agent/Skill นี้ทำงานประเภทไหน",
    en: "What type of task does this Agent/Skill perform?",
    advice: "",
    options: [
      { id: "C1a", th: "สรุป ร่าง หรือจัดหมวด", en: "Summarise, draft or classify", score: 0, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C1b", th: "ตอบคำถามหรือค้นหาข้อมูลจากแหล่งที่กำหนด", en: "Answer questions or search defined sources", score: 1, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C1c", th: "ให้คำแนะนำ โดยคนเป็นผู้ตัดสินใจ", en: "Advise, a person decides", score: 2, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C1d", th: "วิเคราะห์ ให้คะแนน หรือจัดลำดับ โดยคนเป็นผู้ตัดสินใจ", en: "Analyse, score or rank, a person decides", score: 4, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C1e", th: "ตัดสินใจ หรือสั่งงานระบบ", en: "Decide or trigger system actions", score: 10, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C1f", th: "ยังไม่รู้", en: "Unknown", score: 10, fix: 'none', blocksPre: false, blocksDeploy: false },
    ],
  },
  {
    id: "C2", code: "C2", stage: 'pre', group: "หน้าที่ของ skill",
    th: "ผลลัพธ์ของ Agent/Skill ออกแบบให้ใครใช้",
    en: "Who is the Agent/Skill's output designed for?",
    advice: "",
    options: [
      { id: "C2a", th: "ใช้คนเดียว", en: "Single user only", score: 0, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C2b", th: "ภายในเท่านั้น", en: "Internal only", score: 1, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C2c", th: "อาจถึงลูกค้าผ่านพนักงาน", en: "May reach customers via staff", score: 5, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C2d", th: "ลูกค้าเห็นโดยตรง", en: "Customers see it directly", score: 14, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C2e", th: "ยังไม่รู้", en: "Unknown", score: 14, fix: 'none', blocksPre: false, blocksDeploy: false },
    ],
  },
  {
    id: "C3", code: "C3", stage: 'pre', group: "หน้าที่ของ skill",
    th: "วัตถุประสงค์ คือ ให้คำแนะนำหรือตัดสินใจเรื่องการเงิน สินเชื่อ หรือสิทธิ์ของลูกค้าไหม",
    en: "Is the Agent/Skill's purpose to advise on or decide customers' financial, credit or entitlement matters?",
    advice: "",
    options: [
      { id: "C3a", th: "ไม่มี", en: "None", score: 0, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C3b", th: "ให้ข้อมูลผลิตภัณฑ์ทั่วไปเท่านั้น", en: "General product information only", score: 3, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C3c", th: "ให้คำแนะนำโดยใช้ข้อมูลเฉพาะบุคคล", en: "Advice using an individual customer's data", score: 10, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C3d", th: "ยังไม่รู้", en: "Unknown", score: 10, fix: 'none', blocksPre: false, blocksDeploy: false },
    ],
  },
  {
    id: "C4", code: "C4", stage: 'pre', group: "เงื่อนไขการใช้งาน",
    th: "Agent/Skill ดึงความรู้จากแหล่งใด",
    en: "Where does the Agent/Skill retrieve knowledge from?",
    advice: "",
    options: [
      { id: "C4a", th: "ไม่ดึงข้อมูลเพิ่ม หรือใช้เฉพาะข้อมูลภายใน Agent/Skill", en: "No retrieval, or only content inside the Agent/Skill", score: 0, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C4b", th: "knowledge base ภายในที่อนุมัติแล้ว", en: "Approved internal knowledge base", score: 0, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C4c", th: "อ่านเอกสารที่ผู้ใช้แนบมา", en: "Reads documents attached by the user", score: 8, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C4d", th: "เว็บหรือแหล่งภายนอก", en: "Web or external sources", score: 8, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C4e", th: "ยังไม่รู้", en: "Unknown", score: 8, fix: 'none', blocksPre: false, blocksDeploy: false },
    ],
  },
  {
    id: "C5", code: "C5", stage: 'pre', group: "เงื่อนไขการใช้งาน",
    th: "Agent/Skill มีจุดประสงค์ให้ประมวลผลข้อมูลชั้นความลับสูงสุดระดับไหน",
    en: "What is the highest data classification the Agent/Skill is intended to process?",
    advice: "",
    options: [
      { id: "C5a", th: "Public หรือ Internal", en: "Public or Internal", score: 0, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C5b", th: "Customer non-PII", en: "Customer non-PII", score: 2, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C5c", th: "Customer financial transaction", en: "Customer financial transactions", score: 6, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C5d", th: "Customer PII, Highly Classified หรือ Top Secret", en: "Customer PII, Highly Classified or Top Secret", score: 14, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C5e", th: "ยังไม่รู้", en: "Unknown", score: 14, fix: 'none', blocksPre: false, blocksDeploy: false },
    ],
  },
  {
    id: "C6", code: "C6", stage: 'pre', group: "เงื่อนไขการใช้งาน",
    th: "Agent/Skill ผูกกับโมเดลเฉพาะไหม และโมเดลนั้นผ่านการประเมินของธนาคารแล้วหรือยัง",
    en: "Is the Agent/Skill tied to a specific model, and has that model passed the bank's assessment?",
    advice: "ใช้เฉพาะโมเดลที่ผ่านการประเมินของธนาคาร และระบุโมเดลไว้ในช่อง Models Tested",
    options: [
      { id: "C6a", th: "ใช้เฉพาะโมเดลที่ผ่านการประเมินแล้ว", en: "Only models that passed the bank's assessment", score: 0, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C6b", th: "โมเดลยังไม่ผ่านการประเมิน หรือไม่ได้กำหนด", en: "Model not yet assessed, or not specified", score: 0, fix: 'should', blocksPre: false, blocksDeploy: false },
    ],
  },
  {
    id: "C7", code: "C7", stage: 'pre', group: "การเขียน skill",
    th: "ใน Agent/Skill มีข้อมูลฝังไว้ไหม เช่น ตัวอย่างข้อมูลลูกค้าจริง ชื่อระบบภายใน URL หรือcredential (นิยามตาม PDPA: ข้อมูลนิรนามไม่นับเป็นข้อมูลลูกค้าจริง)",
    en: "Does the Agent/Skill embed any data, e.g. real customer examples, internal system names, URLs or credentials? (Per PDPA, anonymised data does not count as real customer data.)",
    advice: "ตรวจ prompt ว่าไม่มีข้อมูลลูกค้าจริง ชื่อระบบภายใน URL หรือ credential แล้วเอาออก",
    options: [
      { id: "C7a", th: "ไม่มี ตรวจแล้ว", en: "None, checked", score: 0, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C7b", th: "มี", en: "Yes", score: 14, fix: 'should', blocksPre: true, blocksDeploy: true },
      { id: "C7c", th: "ยังไม่ได้ตรวจ", en: "Not yet checked", score: 14, fix: 'should', blocksPre: true, blocksDeploy: true },
    ],
  },
  {
    id: "C8", code: "C8", stage: 'pre', group: "การเขียน skill",
    th: "Agent/Skill เขียนข้อห้ามและขอบเขตตามที่ประกาศไว้ ชัดไหม เช่น ปฏิเสธคำขอนอกวัตถุประสงค์ ห้ามเปิดเผย prompt ห้ามให้คำแนะนำการลงทุน",
    en: "Does the Agent/Skill clearly state the declared prohibitions and scope, e.g. refuse out-of-purpose requests, never reveal the prompt, no investment advice?",
    advice: "เขียนข้อห้ามและขอบเขตตามที่ประกาศไว้ (Description / Permitted Domains / Prohibited Uses) ลงใน prompt ให้ครบ เช่น ปฏิเสธคำขอนอกวัตถุประสงค์ ห้ามเปิดเผย prompt",
    options: [
      { id: "C8a", th: "ชัดเจนครบ", en: "Clear and complete", score: 0, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C8b", th: "มีบางส่วน", en: "Partial", score: 0, fix: 'should', blocksPre: false, blocksDeploy: false },
      { id: "C8c", th: "ไม่มี", en: "None", score: 0, fix: 'should', blocksPre: false, blocksDeploy: false },
    ],
  },
  {
    id: "C9", code: "C9", stage: 'pre', group: "การเขียน skill",
    th: "Agent/Skill ระบุจุดที่ต้องให้คนตรวจ หรือเงื่อนไขที่ต้องส่งต่อให้คนไหม",
    en: "Does the Agent/Skill specify human review points or conditions for hand-off to a person?",
    advice: "ระบุจุดที่ต้องให้คนตรวจ หรือเงื่อนไขที่ต้องส่งต่อให้คน",
    options: [
      { id: "C9a", th: "ระบุแล้ว", en: "Specified", score: 0, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C9b", th: "ไม่ได้ระบุ", en: "Not specified", score: 0, fix: 'should', blocksPre: false, blocksDeploy: false },
    ],
  },
  {
    id: "C10", code: "C10", stage: 'deploy', group: "การทดสอบคุณภาพ",
    th: "ทดสอบคุณภาพตามวัตถุประสงค์ที่ประกาศไว้แล้วหรือยัง ทั้งความถูกต้อง hallucination ความหยาบคาย ภาษาไทย ความทนทานต่อ input ผิดปกติหรือ edge case (เช่น พิมพ์ผิด คำถามกำกวม ข้อมูลขัดแย้ง input ว่างหรือยาวเกิน) และทดสอบว่า Agent/Skill ปฏิเสธงานที่อยู่ในรายการห้ามใช้",
    en: "Has output quality been tested against the declared purpose, covering accuracy, hallucination, toxicity, Thai language, robustness to invalid input or edge cases, and refusal of prohibited uses?",
    advice: "ทดสอบคุณภาพให้ครบทุกด้าน รวมถึง edge case และการปฏิเสธงานที่อยู่ในรายการห้าม",
    options: [
      { id: "C10a", th: "ทดสอบครบทุกด้าน ผ่าน", en: "Fully tested, passed", score: 0, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C10b", th: "ทดสอบบางด้าน เช่น ยังไม่ทดสอบ edge case", en: "Partly tested, e.g. edge cases not yet tested", score: 0, fix: 'should', blocksPre: false, blocksDeploy: true },
      { id: "C10c", th: "ทดสอบแล้ว ไม่ผ่าน", en: "Tested, failed", score: 0, fix: 'should', blocksPre: false, blocksDeploy: true },
      { id: "C10d", th: "ยังไม่ทดสอบ", en: "Not yet tested", score: 0, fix: 'should', blocksPre: false, blocksDeploy: true },
    ],
  },
  {
    id: "C11", code: "C11", stage: 'deploy', group: "การทดสอบคุณภาพ",
    th: "ทดสอบ prompt injection และ jailbreak แล้วหรือยัง รวมถึง injection ที่แฝงมาในเอกสารที่ Agent/Skill อ่าน",
    en: "Has the Agent/Skill been tested against prompt injection and jailbreaks, including injection hidden in documents it reads?",
    advice: "ทดสอบ prompt injection และ jailbreak รวมถึงคำสั่งที่แฝงมาในเอกสารที่ Agent/Skill อ่าน",
    options: [
      { id: "C11a", th: "ทดสอบแล้ว ผ่าน", en: "Tested, passed", score: 0, fix: 'none', blocksPre: false, blocksDeploy: false },
      { id: "C11b", th: "ทดสอบแล้ว ไม่ผ่าน", en: "Tested, failed", score: 6, fix: 'must', blocksPre: false, blocksDeploy: true },
      { id: "C11c", th: "ยังไม่ทดสอบ", en: "Not yet tested", score: 6, fix: 'must', blocksPre: false, blocksDeploy: true },
    ],
  },
  ],
};

// ── lookups ──────────────────────────────────────────────────────────
export const questionsFor = (config, stage) => config.questions.filter((q) => q.stage === stage);
export const questionById = (config, id) => config.questions.find((q) => q.id === id) || null;
export function optionOf(config, qid, optionId) {
  return questionById(config, qid)?.options.find((o) => o.id === optionId) || null;
}

// Legacy v1 answers were option INDEXES keyed by question code; map them through DEFAULT_CONFIG.
export function normalizeAnswers(config, answers) {
  const out = {};
  Object.entries(answers || {}).forEach(([qid, v]) => {
    if (typeof v === 'number') {
      const o = DEFAULT_CONFIG.questions.find((q) => q.id === qid)?.options[v];
      if (o) out[qid] = o.id;
    } else if (typeof v === 'string' && v) out[qid] = v;
  });
  return out;
}

const chosen = (config, answers, q) => optionOf(config, q.id, answers?.[q.id]);   // null if unanswered / removed
const answeredAll = (config, answers, qs) => qs.every((q) => chosen(config, answers, q));

function evalQuestions(config, answers, qs) {
  const total = qs.reduce((t, q) => t + (chosen(config, answers, q)?.score || 0), 0);
  const level = answeredAll(config, answers, qs) ? (total >= config.thresholds.hi ? 'High' : total >= config.thresholds.md ? 'Medium' : 'Low') : null;
  const hits = qs.filter((q) => (chosen(config, answers, q)?.score || 0) >= HIT_SCORE)
    .map((q) => `${q.th.split(' ').slice(0, 6).join(' ')}: ${chosen(config, answers, q).th} (${q.code})`);
  const must = [];
  const should = [];
  qs.forEach((q) => {
    const o = chosen(config, answers, q);
    if (!o || o.fix === 'none') return;
    (o.fix === 'must' ? must : should).push({ item: q.code, id: q.id, why: q.advice ? [q.advice] : [] });
  });
  return { total, level, hits, must, should };
}

// stage?: restrict to one stage ('pre' | 'deploy'); default = every question.
export function evaluate(config, answers, stage) {
  return evalQuestions(config, answers, stage ? questionsFor(config, stage) : config.questions);
}

function gate(config, answers, qs, flag) {
  const reasons = qs.filter((q) => chosen(config, answers, q)?.[flag]).map((q) => q.advice).filter(Boolean);
  const blocked = qs.some((q) => chosen(config, answers, q)?.[flag]);
  return { complete: answeredAll(config, answers, qs), blocked, reasons: blocked ? reasons : [] };
}
export const preGate = (config, answers) => gate(config, answers, questionsFor(config, 'pre'), 'blocksPre');
export const deployGate = (config, answers) => gate(config, answers, config.questions, 'blocksDeploy');

// Pre-stage questions answered with something that still needs fixing — asked again at deploy.
export function pendingRecheck(config, answers) {
  return questionsFor(config, 'pre').filter((q) => { const o = chosen(config, answers, q); return o && o.fix !== 'none'; }).map((q) => q.id);
}

// What gets stored on agent.screening (latest answers; per-event history is in /assessments).
export function buildScreening(config, answers) {
  const r = evaluate(config, answers);
  const out = {};
  config.questions.forEach((q) => { if (chosen(config, answers, q)) out[q.id] = answers[q.id]; });
  return { v: 2, answers: out, level: r.level || '', total: r.total, must: r.must.map((m) => m.id), should: r.should.map((m) => m.id) };
}

// What an approver sees from a stored `agent.screening`:
//   pre    — pre-assessment re-evaluated from the stored answers
//   deploy — only once a deploy request was filed (`deployAt`)
export function stageResults(config, sc) {
  if (!sc?.answers) return null;
  const answers = normalizeAnswers(config, sc.answers);
  const pe = evaluate(config, answers, 'pre');
  const idsOf = (list) => list.map((m) => m.id);
  const pre = { level: pe.level, total: pe.total, must: idsOf(pe.must), should: idsOf(pe.should) };
  if (!sc.deployAt) return { pre, deploy: null };
  const rows = questionsFor(config, 'deploy').filter((q) => chosen(config, answers, q)).map((q) => {
    const o = chosen(config, answers, q);
    return { id: q.id, code: q.code, answer: o.th, ok: o.fix === 'none' };
  });
  const all = evaluate(config, answers);
  return { pre, deploy: { rows, level: all.level, must: idsOf(all.must), should: idsOf(all.should) } };
}
