// ALPHA regression suite. Exercises the REAL prompt + tool declarations that
// ship (required from chatPrompt.js, never copied), so a prompt edit that
// breaks tool routing or mode B fails here instead of in front of a user.
//
// Run before every chat deploy:  node functions/regression.cjs
const { GoogleGenAI } = require('@google/genai');
const { TOOL_DECLARATIONS, CHAT_SYSTEM_PROMPT } = require('./chatPrompt');

const ai = new GoogleGenAI({ vertexai: true, project: 'wolfy-481609', location: 'asia-southeast1' });
const CONFIG = { temperature: 0.4, maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: -1 } };

async function turn(contents) {
  const resp = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents,
    config: { ...CONFIG, systemInstruction: { role: 'system', parts: [{ text: CHAT_SYSTEM_PROMPT }] }, tools: [{ functionDeclarations: TOOL_DECLARATIONS }] },
  });
  const calls = resp?.functionCalls;
  if (Array.isArray(calls) && calls.length) return { kind: 'tool', name: calls[0].name, args: calls[0].args || {} };
  return { kind: 'text', text: (resp?.text || '').trim() };
}
const userTurn = (t) => [{ role: 'user', parts: [{ text: t }] }];
const withToolResult = (q, name, args, result) => [
  ...userTurn(q),
  { role: 'model', parts: [{ functionCall: { name, args } }] },
  { role: 'user', parts: [{ functionResponse: { name, response: { result } } }] },
];

// Reproduces the exact contents the CLIENT builds on the composing call:
// prior conversation, then the CURRENT question, then the tool exchange.
// The bug this guards against dropped the current question here, so the model
// answered whatever came before it.
const composeAfterHistory = (prior, q, name, args, result) => [
  ...prior,
  ...userTurn(q),
  { role: 'model', parts: [{ functionCall: { name, args } }] },
  { role: 'user', parts: [{ functionResponse: { name, response: { result } } }] },
];

// Realistic capability_search payload (shape matches skills.js output).
const TEST_HITS = [
  { agentName: 'TC Writer', type: 'agent', tier: 'T2', description: 'ระบบ AI ที่ช่วยออกแบบ Testcase Test Description และ Expected', status: 'Pilot', readiness: 'pilot', endpoint: '', creator: 'Chanchaisit K.', similarity: 0.739, matchedBy: 'both' },
  { agentName: 'Test Analysis', type: 'agent', tier: 'T2', description: 'ช่วยวางแผน Test scope จาก Requirement', status: 'Pilot', readiness: 'pilot', endpoint: '', creator: 'Chanchaisit K.', similarity: 0.694, matchedBy: 'semantic' },
  { agentName: 'Unit Test Generator', type: 'skill', tier: 'T1', description: 'ช่วยสร้าง unit test, mock, edge case และเพิ่ม coverage', status: 'To Do', readiness: 'in_dev', endpoint: '', creator: 'Navanit A.', similarity: 0.675, matchedBy: 'both' },
];
const NONSENSE_HITS = [
  { agentName: 'AI Agent Library Copilot', type: 'agent', tier: 'T1', description: 'ผู้ช่วยค้นหาข้อมูลในไลบรารี', status: 'Ready to Use', readiness: 'ready', endpoint: '', creator: 'Wolfy', similarity: 0.672, matchedBy: 'semantic' },
  { agentName: 'query_library', type: 'skill', tier: 'T1', description: 'ค้นหาและกรองรายการ agent/skill ในไลบรารี', status: 'Ready to Use', readiness: 'ready', endpoint: '', creator: 'Wolfy', similarity: 0.653, matchedBy: 'semantic' },
];

// Code-writing hits, to check the composed answer is about THIS question and
// not the previous one.
const CODE_HITS = [
  { agentName: 'be-dev (Golang TDD Worker)', type: 'skill', tier: 'T1', description: 'ช่วยเขียนโค้ด Go แบบ TDD: เขียน failing test ก่อน แล้ว implement', status: 'Ready to Use', readiness: 'ready', endpoint: '', creator: 'Saravuth R.', similarity: 0.74, matchedBy: 'both' },
  { agentName: 'fe-dev (Next.js CSR TDD Worker)', type: 'skill', tier: 'T1', description: 'ช่วยเขียน Next.js Pages Router ด้วย TDD: Jest + RTL', status: 'Ready to Use', readiness: 'ready', endpoint: '', creator: 'Saravuth R.', similarity: 0.72, matchedBy: 'semantic' },
  { agentName: 'Code Review Assistant', type: 'agent', tier: 'T2', description: 'ตรวจทานโค้ดและเสนอจุดที่ควรปรับปรุง', status: 'Pilot', readiness: 'pilot', endpoint: '', creator: 'Navanit A.', similarity: 0.70, matchedBy: 'both' },
];

const CASES = [
  { name: '🐞 "มี Agent N ตัว" ปนกับ process id ต้องไม่กรอง type (Agent เป็นคำทั่วไป ไม่ใช่หมวด)',
    run: () => turn(userTurn('1.2 Deep Research & Benchmark: มี Agent 2 ตัว อะไรบ้าง')),
    check: (r) => {
      if (r.kind !== 'tool' || r.name !== 'query_library') return `ได้ ${r.kind}:${r.name}`;
      if (!r.args?.sdlcProcessMapping?.includes('1.2')) return `ไม่ได้กรอง process 1.2: ${JSON.stringify(r.args)}`;
      return r.args?.type && r.args.type !== 'all' ? `ใส่ type filter ผิด: ${r.args.type} (ของจริงมีแต่ Skill จะได้ 0 ผลลัพธ์)` : null;
    } },
  { name: '🐞 คำถามหมวดตรงๆ ("Agent มีกี่ตัว") ยังต้องกรอง type ได้ตามปกติ',
    run: () => turn(userTurn('Agent มีกี่ตัว')),
    check: (r) => (r.kind === 'tool' && r.name === 'query_library' && r.args?.type === 'Agent') ? null : `ได้ ${r.kind}:${r.name} args=${JSON.stringify(r.args||{})}` },
  { name: '🐞 คำตอบต้องตรงคำถามล่าสุด ไม่ใช่คำถามก่อนหน้า (off-by-one)',
    run: () => turn(composeAfterHistory(
      [
        { role: 'user', parts: [{ text: 'มีอะไรให้ใช้บ้าง' }] },
        { role: 'model', parts: [{ text: 'มี Agent พร้อมใช้หลายตัวครับ\n@@ User Story Writer | เขียน user story บน JIRA\n@@ Epic Writer | เขียน Epic บน JIRA' }] },
      ],
      'อะไรช่วยเขียน code ได้',
      'capability_search', { query: 'เขียน code', intent: 'all' }, CODE_HITS,
    )),
    check: (r) => {
      if (r.kind !== 'text') return `เรียก tool ซ้ำ (${r.name})`;
      // The previous answer's entries must NOT come back as this answer.
      if (/@@\s*(User Story Writer|Epic Writer)/.test(r.text)) return `ตอบคำถามก่อนหน้า: ${r.text.slice(0, 90)}`;
      const named = r.text.split('\n').filter((l) => l.trim().startsWith('@@'));
      if (!named.length) return `ไม่มีบรรทัด @@: ${r.text.slice(0, 90)}`;
      return /dev|Code Review/i.test(named.join(' ')) ? null : `ไม่ได้แนะนำตัวที่เกี่ยวกับ code: ${named.join(' | ').slice(0, 90)}`;
    } },

  { name: 'คำถามความสามารถ → ต้องเรียก capability_search (ไม่ใช่ query_library)',
    run: () => turn(userTurn('มีอะไรช่วยเขียนเทสเคสได้บ้าง')),
    check: (r) => r.kind === 'tool' && r.name === 'capability_search' ? null : `ได้ ${r.kind}:${r.name || r.text?.slice(0, 60)}` },

  { name: 'คำถามเชิงตัวเลข → ต้องเรียก query_library',
    run: () => turn(userTurn('T2 มีกี่ตัว')),
    check: (r) => r.kind === 'tool' && r.name === 'query_library' ? null : `ได้ ${r.kind}:${r.name || r.text?.slice(0, 60)}` },

  { name: 'ขอที่พร้อมใช้ → intent ต้องเป็น usable_now',
    run: () => turn(userTurn('ขอ agent ที่พร้อมใช้งานเลยสำหรับทำ test case')),
    check: (r) => r.kind !== 'tool' ? `ไม่เรียก tool (${r.text?.slice(0, 60)})`
      : r.args?.intent === 'usable_now' ? null : `intent=${r.args?.intent}` },

  { name: 'เรียบเรียงผลลัพธ์ → ต้องใช้ @@ และห้ามใส่สถานะ/creator ในบรรทัด @@',
    run: () => turn(withToolResult('มีอะไรช่วยเขียนเทสเคสได้บ้าง', 'capability_search', { query: 'เขียน test case', intent: 'all' }, TEST_HITS)),
    check: (r) => {
      if (r.kind !== 'text') return `เรียก tool ซ้ำ (${r.name})`;
      const recs = r.text.split('\n').filter((l) => l.trim().startsWith('@@'));
      if (!recs.length) return 'ไม่มีบรรทัด @@ เลย';
      const dirty = recs.find((l) => /Ready to Use|Pilot|In Progress|To Do|Creator|T[12]\b|https?:/i.test(l));
      if (dirty) return `บรรทัด @@ มีสถานะ/creator/ลิงก์ปน: ${dirty.slice(0, 70)}`;
      return null;
    } },

  { name: 'คำถามไม่มีคำตอบในไลบรารี → ต้องบอกว่าไม่พบ ไม่ยัดเยียด',
    run: () => turn(withToolResult('มีตัวไหนช่วยจองตั๋วเครื่องบิน', 'capability_search', { query: 'จองตั๋วเครื่องบิน', intent: 'all' }, NONSENSE_HITS)),
    check: (r) => {
      if (r.kind !== 'text') return `เรียก tool ซ้ำ (${r.name})`;
      if (r.text.includes('@@')) return 'ยัดเยียดผลลัพธ์ด้วย @@ ทั้งที่ไม่เกี่ยว';
      return /ไม่พบ|ไม่มี|ยังไม่มี/.test(r.text) ? null : `ไม่ได้บอกว่าไม่พบ: ${r.text.slice(0, 80)}`;
    } },

  { name: 'โหมด B — Agile ต้องตอบได้ (ห้ามปฏิเสธ, ห้ามใช้ @@)',
    run: () => turn(userTurn('Scrum ต่างจาก Kanban ยังไง')),
    check: (r) => {
      if (r.kind === 'tool') return `ไปเรียก tool (${r.name}) ทั้งที่เป็นคำถามความรู้ทั่วไป`;
      if (r.text.includes('@@')) return 'ใช้ @@ กับคำตอบที่ไม่ใช่รายการ agent';
      if (/นอกเหนือ|ไม่ใช่เรื่องที่ผมช่วย/.test(r.text)) return `ปฏิเสธทั้งที่อยู่ในโหมด B: ${r.text.slice(0, 70)}`;
      return /scrum|sprint|kanban/i.test(r.text) ? null : `ตอบไม่ตรงเรื่อง: ${r.text.slice(0, 70)}`;
    } },

  { name: 'โหมด B — ขอความเห็นความเสี่ยง ต้องตอบได้',
    run: () => turn(userTurn('ถ้าจะทำ agent สรุปเอกสารสัญญา มีความเสี่ยงอะไรบ้าง')),
    check: (r) => {
      if (r.kind === 'tool') return `ไปเรียก tool (${r.name})`;
      if (/นอกเหนือ|ไม่ใช่เรื่องที่ผมช่วย/.test(r.text)) return `ปฏิเสธผิด: ${r.text.slice(0, 70)}`;
      return r.text.length > 60 ? null : `คำตอบสั้นผิดปกติ: ${r.text}`;
    } },

  { name: 'วิเคราะห์ gap → ต้องเรียก query_sdlc พร้อม withAgentCounts',
    run: () => turn(userTurn('process ไหนยังไม่มี AI ใช้งานบ้าง')),
    check: (r) => r.kind === 'tool' && r.name === 'query_sdlc' && r.args?.withAgentCounts
      ? null : `ได้ ${r.kind}:${r.name} args=${JSON.stringify(r.args || {})}` },

  { name: 'คำถามใหม่คนละเรื่อง → ห้าม anchor กับคำตอบเก่า',
    run: () => turn([
      ...userTurn('มีอะไรช่วยเขียนเทสเคสได้บ้าง'),
      { role: 'model', parts: [{ text: 'มีหลายตัวครับ\n@@ TC Writer | ออกแบบ testcase' }] },
      { role: 'user', parts: [{ text: 'แล้วมีตัวไหนช่วยทำ design system' }] },
    ]),
    check: (r) => {
      if (r.kind === 'tool') return r.name === 'capability_search' && /design/i.test(JSON.stringify(r.args)) ? null : `เรียก ${r.name} args=${JSON.stringify(r.args)}`;
      return `ตอบ text แทนการค้นใหม่: ${r.text.slice(0, 70)}`;
    } },
];

(async () => {
  let fail = 0;
  for (const c of CASES) {
    let problem;
    try { problem = c.check(await c.run()); }
    catch (e) { problem = `ERROR ${e.message || e}`; }
    if (problem) { fail++; console.log(`❌ ${c.name}\n     → ${problem}`); }
    else console.log(`✅ ${c.name}`);
  }
  console.log(`\n${fail === 0 ? '✅ ผ่านทั้งหมด' : `❌ ไม่ผ่าน ${fail}/${CASES.length}`}`);
  process.exit(fail === 0 ? 0 : 1);
})();
