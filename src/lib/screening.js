// Screening questionnaire — single source (2026-11-26). Ported from the bank's
// 20261123_Skill_Library_Screening_sent.html (questions, option scores, MAND, RECO) with
// "skill" → "Agent/Skill". ⛔ Do not copy these lists elsewhere; import from here.
// Answers: { C1..C11: option index (number) }. D1–D6 (the creator's declaration) live in the
// registration form, not here — see src/lib/declaration.js.
export const TH = {"hi":14,"md":7};
export const PRE_CODES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'];
export const DEPLOY_CODES = ['C10', 'C11'];
export const RECHECK_CODES = ['C6', 'C8', 'C9'];
const RISK = ['C1', 'C2', 'C3', 'C4', 'C5'];

export const QUESTIONS = [
 {"g":"หน้าที่ของ skill","code":"C1","type":"risk","th":"Agent/Skill นี้ทำงานประเภทไหน","en":"What type of task does this Agent/Skill perform?","opts":[{"l":"a","th":"สรุป ร่าง หรือจัดหมวด","en":"Summarise, draft or classify","lv":"L","sc":0},{"l":"b","th":"ตอบคำถามหรือค้นหาข้อมูลจากแหล่งที่กำหนด","en":"Answer questions or search defined sources","lv":"L","sc":1},{"l":"c","th":"ให้คำแนะนำ โดยคนเป็นผู้ตัดสินใจ","en":"Advise, a person decides","lv":"M","sc":2},{"l":"d","th":"วิเคราะห์ ให้คะแนน หรือจัดลำดับ โดยคนเป็นผู้ตัดสินใจ","en":"Analyse, score or rank, a person decides","lv":"M","sc":4},{"l":"e","th":"ตัดสินใจ หรือสั่งงานระบบ","en":"Decide or trigger system actions","lv":"H","sc":10},{"l":"f","th":"ยังไม่รู้","en":"Unknown","lv":"H","sc":10}]},
 {"g":"หน้าที่ของ skill","code":"C2","type":"risk","th":"ผลลัพธ์ของ Agent/Skill ออกแบบให้ใครใช้","en":"Who is the Agent/Skill's output designed for?","opts":[{"l":"a","th":"ใช้คนเดียว","en":"Single user only","lv":"L","sc":0},{"l":"b","th":"ภายในเท่านั้น","en":"Internal only","lv":"L","sc":1},{"l":"c","th":"อาจถึงลูกค้าผ่านพนักงาน","en":"May reach customers via staff","lv":"M","sc":5},{"l":"d","th":"ลูกค้าเห็นโดยตรง","en":"Customers see it directly","lv":"H","sc":14},{"l":"e","th":"ยังไม่รู้","en":"Unknown","lv":"H","sc":14}]},
 {"g":"หน้าที่ของ skill","code":"C3","type":"risk","th":"วัตถุประสงค์ คือ ให้คำแนะนำหรือตัดสินใจเรื่องการเงิน สินเชื่อ หรือสิทธิ์ของลูกค้าไหม","en":"Is the Agent/Skill's purpose to advise on or decide customers' financial, credit or entitlement matters?","opts":[{"l":"a","th":"ไม่มี","en":"None","lv":"L","sc":0},{"l":"b","th":"ให้ข้อมูลผลิตภัณฑ์ทั่วไปเท่านั้น","en":"General product information only","lv":"M","sc":3},{"l":"c","th":"ให้คำแนะนำโดยใช้ข้อมูลเฉพาะบุคคล","en":"Advice using an individual customer's data","lv":"H","sc":10},{"l":"d","th":"ยังไม่รู้","en":"Unknown","lv":"H","sc":10}]},
 {"g":"เงื่อนไขการใช้งาน","code":"C4","type":"risk","th":"Agent/Skill ดึงความรู้จากแหล่งใด","en":"Where does the Agent/Skill retrieve knowledge from?","opts":[{"l":"a","th":"ไม่ดึงข้อมูลเพิ่ม หรือใช้เฉพาะข้อมูลภายใน Agent/Skill","en":"No retrieval, or only content inside the Agent/Skill","lv":"L","sc":0},{"l":"b","th":"knowledge base ภายในที่อนุมัติแล้ว","en":"Approved internal knowledge base","lv":"L","sc":0},{"l":"c","th":"อ่านเอกสารที่ผู้ใช้แนบมา","en":"Reads documents attached by the user","lv":"M","sc":8},{"l":"d","th":"เว็บหรือแหล่งภายนอก","en":"Web or external sources","lv":"M","sc":8},{"l":"e","th":"ยังไม่รู้","en":"Unknown","lv":"H","sc":8}]},
 {"g":"เงื่อนไขการใช้งาน","code":"C5","type":"risk","th":"Agent/Skill มีจุดประสงค์ให้ประมวลผลข้อมูลชั้นความลับสูงสุดระดับไหน","en":"What is the highest data classification the Agent/Skill is intended to process?","opts":[{"l":"a","th":"Public หรือ Internal","en":"Public or Internal","lv":"L","sc":0},{"l":"b","th":"Customer non-PII","en":"Customer non-PII","lv":"L","sc":2},{"l":"c","th":"Customer financial transaction","en":"Customer financial transactions","lv":"M","sc":6},{"l":"d","th":"Customer PII, Highly Classified หรือ Top Secret","en":"Customer PII, Highly Classified or Top Secret","lv":"H","sc":14},{"l":"e","th":"ยังไม่รู้","en":"Unknown","lv":"H","sc":14}]},
 {"g":"เงื่อนไขการใช้งาน","code":"C6","type":"ready","th":"Agent/Skill ผูกกับโมเดลเฉพาะไหม และโมเดลนั้นผ่านการประเมินของธนาคารแล้วหรือยัง","en":"Is the Agent/Skill tied to a specific model, and has that model passed the bank's assessment?","opts":[{"l":"a","th":"ใช้เฉพาะโมเดลที่ผ่านการประเมินแล้ว","en":"Only models that passed the bank's assessment","lv":"ผ่าน","sc":0},{"l":"b","th":"โมเดลยังไม่ผ่านการประเมิน หรือไม่ได้กำหนด","en":"Model not yet assessed, or not specified","lv":"ต้องแก้","sc":0}]},
 {"g":"การเขียน skill","code":"C7","type":"ready","th":"ใน Agent/Skill มีข้อมูลฝังไว้ไหม เช่น ตัวอย่างข้อมูลลูกค้าจริง ชื่อระบบภายใน URL หรือcredential (นิยามตาม PDPA: ข้อมูลนิรนามไม่นับเป็นข้อมูลลูกค้าจริง)","en":"Does the Agent/Skill embed any data, e.g. real customer examples, internal system names, URLs or credentials? (Per PDPA, anonymised data does not count as real customer data.)","opts":[{"l":"a","th":"ไม่มี ตรวจแล้ว","en":"None, checked","lv":"ผ่าน","sc":0},{"l":"b","th":"มี","en":"Yes","lv":"ต้องแก้","sc":14},{"l":"c","th":"ยังไม่ได้ตรวจ","en":"Not yet checked","lv":"ต้องแก้","sc":14}]},
 {"g":"การเขียน skill","code":"C8","type":"ready","th":"Agent/Skill เขียนข้อห้ามและขอบเขตตามที่ประกาศไว้ ชัดไหม เช่น ปฏิเสธคำขอนอกวัตถุประสงค์ ห้ามเปิดเผย prompt ห้ามให้คำแนะนำการลงทุน","en":"Does the Agent/Skill clearly state the declared prohibitions and scope, e.g. refuse out-of-purpose requests, never reveal the prompt, no investment advice?","opts":[{"l":"a","th":"ชัดเจนครบ","en":"Clear and complete","lv":"ผ่าน","sc":0},{"l":"b","th":"มีบางส่วน","en":"Partial","lv":"ต้องแก้","sc":0},{"l":"c","th":"ไม่มี","en":"None","lv":"ต้องแก้","sc":0}]},
 {"g":"การเขียน skill","code":"C9","type":"ready","th":"Agent/Skill ระบุจุดที่ต้องให้คนตรวจ หรือเงื่อนไขที่ต้องส่งต่อให้คนไหม","en":"Does the Agent/Skill specify human review points or conditions for hand-off to a person?","opts":[{"l":"a","th":"ระบุแล้ว","en":"Specified","lv":"ผ่าน","sc":0},{"l":"b","th":"ไม่ได้ระบุ","en":"Not specified","lv":"ต้องแก้","sc":0}]},
 {"g":"การทดสอบคุณภาพ","code":"C10","type":"ready","th":"ทดสอบคุณภาพตามวัตถุประสงค์ที่ประกาศไว้แล้วหรือยัง ทั้งความถูกต้อง hallucination ความหยาบคาย ภาษาไทย ความทนทานต่อ input ผิดปกติหรือ edge case (เช่น พิมพ์ผิด คำถามกำกวม ข้อมูลขัดแย้ง input ว่างหรือยาวเกิน) และทดสอบว่า Agent/Skill ปฏิเสธงานที่อยู่ในรายการห้ามใช้","en":"Has output quality been tested against the declared purpose, covering accuracy, hallucination, toxicity, Thai language, robustness to invalid input or edge cases, and refusal of prohibited uses?","opts":[{"l":"a","th":"ทดสอบครบทุกด้าน ผ่าน","en":"Fully tested, passed","lv":"ผ่าน","sc":0},{"l":"b","th":"ทดสอบบางด้าน เช่น ยังไม่ทดสอบ edge case","en":"Partly tested, e.g. edge cases not yet tested","lv":"ต้องแก้","sc":0},{"l":"c","th":"ทดสอบแล้ว ไม่ผ่าน","en":"Tested, failed","lv":"ต้องแก้","sc":0},{"l":"d","th":"ยังไม่ทดสอบ","en":"Not yet tested","lv":"ต้องแก้","sc":0}]},
 {"g":"การทดสอบคุณภาพ","code":"C11","type":"ready","th":"ทดสอบ prompt injection และ jailbreak แล้วหรือยัง รวมถึง injection ที่แฝงมาในเอกสารที่ Agent/Skill อ่าน","en":"Has the Agent/Skill been tested against prompt injection and jailbreaks, including injection hidden in documents it reads?","opts":[{"l":"a","th":"ทดสอบแล้ว ผ่าน","en":"Tested, passed","lv":"ผ่าน","sc":0},{"l":"b","th":"ทดสอบแล้ว ไม่ผ่าน","en":"Tested, failed","lv":"ต้องแก้","sc":6},{"l":"c","th":"ยังไม่ทดสอบ","en":"Not yet tested","lv":"ต้องแก้","sc":6}]},
];

// C11 "must fix" conditions per HTML (cond, reason). Other items only ever "should fix".
const MAND = {"C6":[],"C7":[],"C8":[],"C9":[],"C10":[],"C11":[[["all",[["in","C4","bcde"],["in","C11","b"]]],"ทดสอบแล้วไม่ผ่าน: แก้ prompt ให้ไม่ทำตามคำสั่งที่แฝงมาในเนื้อหาเว็บหรือเอกสาร แล้วทดสอบใหม่ให้ผ่าน"],[["in","C4","de"],"Agent/Skill ดึงข้อมูลจากเว็บหรือแหล่งภายนอก เสี่ยงคำสั่งที่แฝงมากับเนื้อหา (prompt injection)"],[["in","C4","b"],"Agent/Skill อ่านเอกสารจาก knowledge base เสี่ยงคำสั่งที่แฝงมากับเอกสาร (prompt injection)"],[["in","C4","c"],"Agent/Skill อ่านเอกสารที่ผู้ใช้แนบมา เสี่ยงคำสั่งที่แฝงมากับเอกสาร (prompt injection)"]]};

export const RECO = {
 "C6": "ใช้เฉพาะโมเดลที่ผ่านการประเมินของธนาคาร และระบุโมเดลไว้ใน D6",
 "C7": "ตรวจ prompt ว่าไม่มีข้อมูลลูกค้าจริง ชื่อระบบภายใน URL หรือ credential แล้วเอาออก",
 "C8": "เขียนข้อห้ามและขอบเขตตาม D1–D3 ลงใน prompt ให้ครบ เช่น ปฏิเสธคำขอนอกวัตถุประสงค์ ห้ามเปิดเผย prompt",
 "C9": "ระบุจุดที่ต้องให้คนตรวจ หรือเงื่อนไขที่ต้องส่งต่อให้คน",
 "C10": "ทดสอบคุณภาพให้ครบทุกด้าน รวมถึง edge case และการปฏิเสธงานที่อยู่ในรายการห้าม",
 "C11": "ทดสอบ prompt injection และ jailbreak รวมถึงคำสั่งที่แฝงมาในเอกสารที่ Agent/Skill อ่าน"
};

const BY_CODE = Object.fromEntries(QUESTIONS.map((q) => [q.code, q]));
export const questionByCode = (code) => BY_CODE[code];

function opt(answers, code) {
  const i = answers?.[code];
  const q = BY_CODE[code];
  return (typeof i !== 'number' || !q?.opts) ? null : (q.opts[i] || null);
}
const letter = (answers, code) => opt(answers, code)?.l || '';
const answered = (answers, code) => opt(answers, code) !== null;

function cond(c, answers, level) {
  const k = c[0];
  if (k === 'in') return letter(answers, c[1]) !== '' && c[2].includes(letter(answers, c[1]));
  if (k === 'any') return c[1].some((x) => cond(x, answers, level));
  if (k === 'all') return c[1].every((x) => cond(x, answers, level));
  if (k === 'lv') return c[2].includes(level);
  return false;
}

export function evaluate(answers) {
  const riskDone = RISK.every((c) => letter(answers, c));
  const total = QUESTIONS.reduce((t, q) => t + (opt(answers, q.code)?.sc || 0), 0);
  const level = riskDone ? (total >= TH.hi ? 'High' : total >= TH.md ? 'Medium' : 'Low') : null;
  const hits = QUESTIONS.filter((q) => (opt(answers, q.code)?.sc || 0) >= 3)
    .map((q) => `${q.th.split(' ').slice(0, 6).join(' ')}: ${opt(answers, q.code).th} (${q.code})`);
  const must = [];
  const should = [];
  for (const item of ['C6', 'C7', 'C8', 'C9', 'C10', 'C11']) {
    const o = opt(answers, item);
    if (!o || o.lv === 'ผ่าน') continue;
    const why = (MAND[item] || []).filter(([c]) => c === null || cond(c, answers, level)).map((x) => x[1]);
    (why.length ? must : should).push({ item, why });
  }
  return { total, level, hits, must, should };
}

export function preGate(answers) {
  const complete = PRE_CODES.every((c) => answered(answers, c));
  const blocked = opt(answers, 'C7')?.lv === 'ต้องแก้';
  return { complete, blocked, reasons: blocked ? [RECO.C7] : [] };
}

export function pendingRecheck(answers) {
  return RECHECK_CODES.filter((c) => { const o = opt(answers, c); return o && o.lv !== 'ผ่าน'; });
}

export function deployGate(answers) {
  const complete = [...PRE_CODES, ...DEPLOY_CODES].every((c) => answered(answers, c));
  const reasons = [];
  const c10 = opt(answers, 'C10');
  if (c10 && c10.lv !== 'ผ่าน') reasons.push(RECO.C10);
  const c11 = evaluate(answers).must.find((m) => m.item === 'C11');
  if (c11) reasons.push(c11.why[0] || RECO.C11);
  return { complete, blocked: reasons.length > 0, reasons };
}

export function buildScreening(answers) {
  const r = evaluate(answers);
  const out = {};
  [...PRE_CODES, ...DEPLOY_CODES].forEach((c) => { if (typeof answers?.[c] === 'number') out[c] = answers[c]; });
  return { v: 1, answers: out, level: r.level || '', total: r.total, must: r.must.map((m) => m.item), should: r.should.map((m) => m.item) };
}
