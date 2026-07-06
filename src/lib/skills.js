// ── Library Copilot — Skill Registry ─────────────────────────────
// A "skill" is a deterministic, provider-agnostic capability the Library
// Copilot agent can invoke. Each skill has:
//   • describe — a tool descriptor (name/description/parameters) ready for
//     LLM function-calling when the chat entry point lands (phase-next).
//   • run(args, ctx) — a pure function over a context carrying `library`
//     (approved agents), `processes` (sdlcProcesses), and `useCases`
//     (sdlcUseCases). No side effects, no LLM, no network — so the same
//     skill runs client-side in the form today and in the Chat Assistant's
//     client-mediated tool loop unchanged.
//
// Two entry points share this one registry:
//   • Form check     — PreRegModal calls the skills directly (single-shot).
//   • Chat Assistant — ChatAssistant.jsx runs skills locally per turn; the
//     Cloud Function (`chatLibrary`) only decides WHICH skill to call and
//     composes the final answer — it never sees the raw library data except
//     for whatever a skill's result includes.

import { rankCandidates, findDuplicates } from './similarity';
import { findConnectionSuggestions } from './connections';
import { getType, getTier, isInternalOrExternal } from './tier';
import { agentStatus, ST_DEF } from './status';
import { splitRoles, agentProcessIds } from './agentUtils';

function norm(s) {
  return (Array.isArray(s) ? s.join(' ') : (s || '')).toString().toLowerCase().trim();
}

// devProgress may still be a legacy string ("90%") on a handful of un-migrated
// docs — same defensive coercion as useAgents.js's normalizeAgent.
function progressNum(agent) {
  const raw = agent?.devProgress;
  const num = typeof raw === 'number' ? raw : parseInt(String(raw || '').replace('%', ''), 10);
  return isNaN(num) ? 0 : num;
}

function matchesKeyword(agent, keyword) {
  if (!keyword) return true;
  const q = keyword.toLowerCase().trim();
  if (!q) return true;
  const hay = norm([
    agent.agentName, agent.owner, agent.description, agent.useCase,
    agent.coreAbility, agent.relatedRole,
  ].join(' '));
  return hay.includes(q);
}

// Thai has no whitespace between words within a phrase, so a naive
// split(/\s+/) treats an entire Thai clause as one giant "word" that never
// substring-matches (verified by a runtime smoke test — a real query like
// "สร้างเอกสารอัตโนมัติ" returned zero candidates against a doc containing
// "สร้างเอกสารจาก template อัตโนมัติ" until this fix). Character trigrams
// give a language-agnostic fallback: split on whitespace for chunk-level
// matches (works well for English/mixed text), AND trigram the whole query
// for a forgiving substring-overlap score that works without word boundaries.
// MIN_TRIGRAM_HITS guards against a single coincidental 3-char overlap
// counting as a match (also caught by testing: the English query "quantum
// blockchain" false-matched "Assistant" purely because "ant" — from
// "quANTum" — happens to appear inside "assistANT"; one fluke trigram is not
// a real signal, so require a small run of genuine overlap instead).
const MIN_TRIGRAM_HITS = 3;
function scoreText(hay, query) {
  const q = norm(query);
  const chunks = q.split(/\s+/).filter((w) => w.length >= 2);
  const flat = q.replace(/\s+/g, '');
  const trigrams = flat.length >= 3
    ? Array.from({ length: flat.length - 2 }, (_, i) => flat.slice(i, i + 3))
    : (flat ? [flat] : []);
  const chunkHits = chunks.filter((w) => hay.includes(w)).length;
  const trigramHits = trigrams.filter((g) => hay.includes(g)).length;
  if (chunkHits === 0 && trigramHits < MIN_TRIGRAM_HITS) return 0;
  // Whole-chunk hits are a much stronger signal than a single noisy trigram —
  // weight them higher so ranking still favors more precise matches.
  return chunkHits * 5 + trigramHits;
}

export const SKILLS = {
  search_library: {
    describe: {
      name: 'search_library',
      description: 'ค้นหา Agent/Skill ที่มีอยู่แล้วในไลบรารีที่ใกล้เคียงกับ draft ที่ให้มา (rule-based nearest-neighbour, ไม่กรอง threshold) คืน top-N พร้อมคะแนน',
      parameters: {
        draft: '{ agentName, description, coreAbility, input, output, businessValue }',
        limit: 'number — จำนวนที่คืน (default 15)',
      },
    },
    run: ({ draft, limit = 15 }, ctx) => rankCandidates(draft, ctx.library, limit),
  },

  duplicate_check: {
    describe: {
      name: 'duplicate_check',
      description: 'ให้คะแนนความซ้ำของ draft เทียบทั้งไลบรารี คืนเฉพาะที่ทับซ้อนเกินเกณฑ์ (>= medium) เรียงจากมากไปน้อย',
      parameters: {
        draft: '{ agentName, description, coreAbility, input, output, businessValue }',
        limit: 'number — จำนวนสูงสุด (default 5)',
      },
    },
    run: ({ draft, limit = 5 }, ctx) => findDuplicates(draft, ctx.library, limit),
  },

  connection_suggest: {
    describe: {
      name: 'connection_suggest',
      description: 'หา Agent/Skill ที่ draft สามารถ "ต่อกับตัวนี้ได้" — ส่งข้อมูลต่อ (data handoff), trigger, หรือใช้ context ร่วมกัน พร้อมทิศทางและเหตุผล',
      parameters: {
        draft: '{ agentName, input, output, tool, owner, sdlcProcessMapping }',
        limit: 'number — จำนวนสูงสุด (default 6)',
      },
    },
    run: ({ draft, limit = 6 }, ctx) => findConnectionSuggestions(draft, ctx.library, ctx.processes, limit),
  },

  get_agent_detail: {
    describe: {
      name: 'get_agent_detail',
      description: 'ดึงข้อมูลเต็มของ Agent/Skill หนึ่งตัวจากไลบรารีด้วยชื่อ (case-insensitive) — ใช้ตอบคำถามเจาะจงตัวใดตัวหนึ่ง',
      parameters: { agentName: 'string — ชื่อ Agent/Skill' },
    },
    run: ({ agentName }, ctx) => ctx.library.find((a) => norm(a.agentName) === norm(agentName)) || null,
  },

  // ── Chat Assistant skills (2026-07-02) ──────────────────────────
  query_library: {
    describe: {
      name: 'query_library',
      description: 'กรอง/นับ/จัดกลุ่ม Agent/Skill ในไลบรารีตามฟิลเตอร์ที่ระบุ — ใช้ตอบคำถามเชิงตัวเลข/รายการ เช่น "T2 มีกี่ตัว", "owner ไหนมี agent เยอะสุด", "Pilot มีอะไรบ้าง". ทำงานแบบ keyword/structured match ล้วน (ไม่ใช้ความหมาย) ตรงตามฟิลเตอร์ที่มีจริงในหน้าเว็บ',
      parameters: {
        type: '"Agent" | "Skill" | "all" (optional)',
        tier: 'array of "T1".."T4" (optional)',
        owner: 'array of owner strings (optional)',
        relatedRole: 'array of role strings (optional)',
        coreAbility: 'array of ability strings (optional)',
        reusable: 'array of "Reusable" | "Reusable with Conditions" | "Non-reusable" (optional)',
        status: 'array of "To Do" | "In Progress" | "Pilot" | "Ready to Use" (optional)',
        scope: '"Internal" | "External" (optional)',
        sdlcStage: 'array of SDLC stage names (optional, requires ctx.processes)',
        sdlcProcessMapping: 'array of process ids e.g. "2.2" (optional)',
        useCase: 'string, exact use case name (optional)',
        keyword: 'string — free-text search across name/owner/description/ability/role (optional)',
        groupBy: '"owner" | "tier" | "status" | "relatedRole" | "coreAbility" (optional) — if set, returns counts per group instead of a flat list',
      },
    },
    run: (args, ctx) => {
      const {
        type = 'all', tier, owner, relatedRole, coreAbility, reusable, status,
        scope, sdlcStage, sdlcProcessMapping, useCase, keyword, groupBy,
      } = args || {};

      // Resolve stage→processId set once (sdlcUseCases/sdlcProcesses don't
      // store stage directly on the agent — must join via sdlcProcessMapping).
      let stageProcessIds = null;
      if (sdlcStage?.length && ctx.processes?.length) {
        const stages = new Set(sdlcStage);
        stageProcessIds = new Set(
          ctx.processes.filter((p) => stages.has(p.stage)).map((p) => p.id)
        );
      }

      const filtered = ctx.library.filter((a) => {
        if (type !== 'all' && type && getType(a) !== type.toLowerCase()) return false;
        if (tier?.length && !tier.includes(getTier(a))) return false;
        if (owner?.length && !owner.includes(a.owner || '')) return false;
        if (relatedRole?.length) {
          const roles = splitRoles(a.relatedRole);
          if (!roles.some((r) => relatedRole.includes(r))) return false;
        }
        if (coreAbility?.length) {
          const abilities = Array.isArray(a.coreAbility) ? a.coreAbility : [a.coreAbility];
          if (!abilities.some((ab) => coreAbility.includes(ab))) return false;
        }
        if (reusable?.length && !reusable.includes(a.reusable || '')) return false;
        if (status?.length) {
          const lbl = ST_DEF[agentStatus({ devProgress: progressNum(a) })].lb;
          if (!status.includes(lbl)) return false;
        }
        if (scope && isInternalOrExternal(a) !== scope) return false;
        if (sdlcProcessMapping?.length) {
          const ids = agentProcessIds(a);
          if (!ids.some((id) => sdlcProcessMapping.includes(id))) return false;
        }
        if (stageProcessIds) {
          const ids = agentProcessIds(a);
          if (!ids.some((id) => stageProcessIds.has(id))) return false;
        }
        if (useCase && norm(a.useCase) !== norm(useCase)) return false;
        if (!matchesKeyword(a, keyword)) return false;
        return true;
      });

      if (groupBy) {
        const keyFn = {
          owner: (a) => a.owner || '(ไม่ระบุ)',
          tier: (a) => getTier(a),
          status: (a) => ST_DEF[agentStatus({ devProgress: progressNum(a) })].lb,
        }[groupBy] || null;
        if (groupBy === 'relatedRole' || groupBy === 'coreAbility') {
          const field = groupBy === 'relatedRole' ? 'relatedRole' : 'coreAbility';
          const counts = {};
          filtered.forEach((a) => {
            const vals = field === 'relatedRole' ? splitRoles(a[field]) : (Array.isArray(a[field]) ? a[field] : [a[field]]);
            vals.filter(Boolean).forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
          });
          return { mode: 'group', groupBy, counts, total: filtered.length };
        }
        if (keyFn) {
          const counts = {};
          filtered.forEach((a) => { const k = keyFn(a); counts[k] = (counts[k] || 0) + 1; });
          return { mode: 'group', groupBy, counts, total: filtered.length };
        }
      }

      return {
        mode: 'list',
        total: filtered.length,
        agents: filtered.map((a) => ({
          agentName: a.agentName, type: getType(a), tier: getTier(a), owner: a.owner,
          status: ST_DEF[agentStatus({ devProgress: progressNum(a) })].lb,
          reusable: a.reusable || '', scope: isInternalOrExternal(a),
        })),
      };
    },
  },

  query_sdlc: {
    describe: {
      name: 'query_sdlc',
      description: 'ค้นหาข้อมูล SDLC process/use case จาก catalog ขององค์กร — ใช้ตอบคำถามเช่น "process 2.2 คืออะไร", "stage Design มี process อะไรบ้าง", "process 2.2 มี use case อะไรบ้าง" และ "coverage": ตั้ง withAgentCounts=true เพื่อนับจำนวน Agent/Skill ที่ map กับแต่ละ process จริง (join กับไลบรารี) ใช้ตอบ "กระบวนการไหนยังไม่มี AI ใช้งาน", "องค์กรยังขาด AI ช่วยตรงจุดไหนของ SDLC" — ตั้ง onlyGaps=true เพิ่มเพื่อกรองเหลือเฉพาะ process ที่ agentCount=0 (ยังไม่มี agent เลย)',
      parameters: {
        processId: 'string — process id เช่น "2.2" (optional)',
        stage: 'string — ชื่อ stage เช่น "Design" (optional)',
        keyword: 'string — free-text ค้นหาใน process/use case name (optional)',
        withAgentCounts: 'boolean — ถ้า true จะ join กับไลบรารีจริงและใส่ agentCount ต่อ process (default false)',
        onlyGaps: 'boolean — ถ้า true (ต้องคู่กับ withAgentCounts=true) กรองเหลือเฉพาะ process ที่ agentCount=0',
      },
    },
    run: ({ processId, stage, keyword, withAgentCounts, onlyGaps }, ctx) => {
      let processes = ctx.processes || [];
      let useCases = ctx.useCases || [];
      if (processId) {
        processes = processes.filter((p) => p.id === processId);
        useCases = useCases.filter((u) => u.processId === processId);
      }
      if (stage) {
        const ids = new Set(processes.filter((p) => p.stage === stage).map((p) => p.id));
        processes = processes.filter((p) => p.stage === stage);
        useCases = useCases.filter((u) => ids.has(u.processId));
      }
      if (keyword) {
        const q = keyword.toLowerCase();
        processes = processes.filter((p) => norm(p.name).includes(q) || norm(p.id).includes(q));
        useCases = useCases.filter((u) => norm(u.name).includes(q));
      }

      let processesOut = processes.map((p) => ({ id: p.id, name: p.name, stage: p.stage, owner: p.owner || '' }));

      if (withAgentCounts) {
        // Join against the real library — count how many approved agents/skills
        // map their sdlcProcessMapping to each process id. This is the piece
        // that was missing before: the assistant could read the catalog and
        // the library separately, but had no cross-referenced coverage view.
        const countByProcess = {};
        (ctx.library || []).forEach((a) => {
          agentProcessIds(a).forEach((id) => { countByProcess[id] = (countByProcess[id] || 0) + 1; });
        });
        processesOut = processesOut.map((p) => ({ ...p, agentCount: countByProcess[p.id] || 0 }));
        if (onlyGaps) processesOut = processesOut.filter((p) => p.agentCount === 0);
      }

      return {
        processes: processesOut,
        useCases: useCases.map((u) => ({ processId: u.processId, name: u.name, owner: u.owner || '' })),
      };
    },
  },

  capability_search: {
    describe: {
      name: 'capability_search',
      description: 'หา Agent/Skill ที่ "ความสามารถ" ตรงกับที่ถามเชิงความหมาย (เช่น "มีตัวไหนทำ documentation generation ได้บ้าง") — คืนเฉพาะ candidate ที่กว้างพอ (keyword prefilter) ให้ผู้เรียกใช้ (LLM) คัดเลือกอีกชั้นจากความหมายจริง ไม่ใช่ผลลัพธ์สุดท้าย',
      parameters: {
        query: 'string — คำอธิบายความสามารถที่ต้องการค้นหา (ภาษาธรรมชาติ)',
        limit: 'number — จำนวนสูงสุด (default 20)',
      },
    },
    // Broad, forgiving prefilter using scoreText (chunk + trigram matching —
    // see its comment for why plain word-splitting fails on Thai). Deliberately
    // wider than matchesKeyword's single-substring check so a synonym-heavy
    // natural-language query still surfaces enough candidates for the LLM to
    // judge; the LLM (not this function) makes the final semantic call.
    run: ({ query, limit = 20 }, ctx) => {
      const scored = ctx.library.map((a) => {
        const hay = norm([a.agentName, a.description, a.input, a.output, a.businessValue, a.coreAbility].join(' '));
        return { a, score: scoreText(hay, query) };
      }).filter((x) => x.score > 0)
        .sort((x, y) => y.score - x.score)
        .slice(0, limit);
      return scored.map(({ a }) => ({
        agentName: a.agentName,
        description: (a.description || '').slice(0, 300),
        input: a.input || '', output: a.output || '', businessValue: (a.businessValue || '').slice(0, 200),
        coreAbility: a.coreAbility,
      }));
    },
  },
};

// Invoke a skill by name. Throws on unknown skill so a mis-issued tool call
// (from the future chat agent) fails loudly instead of silently no-op'ing.
export function runSkill(name, args, ctx) {
  const skill = SKILLS[name];
  if (!skill) throw new Error(`Unknown skill: ${name}`);
  return skill.run(args, ctx);
}

// Tool descriptors for LLM function-calling (phase-next chat entry point).
export const SKILL_TOOLS = Object.values(SKILLS).map((s) => s.describe);
