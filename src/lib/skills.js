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

import { rankCandidates, findDuplicates, scoreDraftAgainst } from './similarity';
import { findConnectionSuggestions } from './connections';
import { getType, getTier, isInternalOrExternal } from './tier';
import { agentStatus, ST_DEF } from './status';
import { agentApproveAreas, PROCESS_AREA } from './approveAreas';
import { splitRoles, agentProcessIds, agentUseCaseNames, agentCategories } from './agentUtils';

function norm(s) {
  return (Array.isArray(s) ? s.join(' ') : (s || '')).toString().toLowerCase().trim();
}

// ── Archive-awareness (2026-07-22) ───────────────────────────────────
// Archived entries must never be RECOMMENDED, but they are valuable as
// BACKGROUND: "someone built this and retired it because X" prevents a
// rebuild. So the split is by tool intent, not by one global filter:
//
//   recommendLib(ctx) — tools that answer "what should I use / what exists"
//                       (query_library, capability_search, get_agent_detail).
//                       Archived excluded outright.
//   analysisLib(ctx)  — tools that reason about overlap and history
//                       (search_library, duplicate_check, connection_suggest*).
//                       Archived included, and tagged so the caller can warn
//                       instead of suggest.
//
// * connection_suggest is called with an already-active-only library by
//   PreRegModal, since you cannot integrate with something that is gone.
function recommendLib(ctx) {
  return (ctx.library || []).filter((a) => a.archived !== true);
}
function analysisLib(ctx) {
  return ctx.libraryAll?.length ? ctx.libraryAll : (ctx.library || []);
}

// ── Fuzzy name resolution (2026-07-30) ───────────────────────────────
// Users type agent names from memory, so exact matching fails constantly:
// "Nok-Suggest" never matched the real "Nok - Suggest" (identical except the
// spaces around the hyphen), and the assistant reported "not found" on an
// entry that plainly exists. Names in this library also mix Thai/English,
// hyphens, parentheses and inconsistent spacing, so punctuation and spacing
// must never decide a match.
//
// Resolution ladder, most-confident first — the first rung that hits wins:
//   exact    — identical once punctuation/spacing is normalised away
//   spacing  — identical with ALL whitespace removed ("NokSuggest")
//   tokens   — every word typed appears somewhere in the name (order-free,
//              so "suggest nok" and partial names work)
//   typo     — closest by edit distance, within a length-scaled tolerance
// Anything looser stays unmatched but returns `suggestions` so the assistant
// can ask "did you mean…" instead of dead-ending the user.
function looseNorm(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function squash(s) {
  return looseNorm(s).replace(/\s/g, '');
}
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

export function resolveAgentByName(library, name) {
  const lib = library || [];
  const q = looseNorm(name);
  const qs = squash(name);
  if (!q) return { match: null, matchedBy: 'none', suggestions: [] };

  let m = lib.find((a) => looseNorm(a.agentName) === q);
  if (m) return { match: m, matchedBy: 'exact', suggestions: [] };

  m = lib.find((a) => squash(a.agentName) === qs);
  if (m) return { match: m, matchedBy: 'spacing', suggestions: [] };

  const qTokens = q.split(' ').filter(Boolean);
  const tokenHits = lib.filter((a) => {
    const n = looseNorm(a.agentName);
    return qTokens.every((t) => n.includes(t));
  });
  if (tokenHits.length === 1) return { match: tokenHits[0], matchedBy: 'tokens', suggestions: [] };
  // Several plausible names — don't silently pick one, let the caller ask.
  if (tokenHits.length > 1) {
    return { match: null, matchedBy: 'ambiguous', suggestions: tokenHits.slice(0, 5).map((a) => a.agentName) };
  }

  const scored = lib
    .map((a) => ({ a, d: editDistance(qs, squash(a.agentName)) }))
    .sort((x, y) => x.d - y.d);
  const best = scored[0];
  // Scale tolerance with query length: ~30% of the typed characters may be
  // wrong, but always allow at least 2 so short names stay correctable.
  const tolerance = Math.max(2, Math.floor(qs.length * 0.3));
  if (best && best.d <= tolerance) return { match: best.a, matchedBy: 'typo', suggestions: [] };

  return {
    match: null,
    matchedBy: 'none',
    suggestions: scored.slice(0, 5).filter((s) => s.d < Math.max(qs.length, 4)).map((s) => s.a.agentName),
  };
}

// ── Readiness gate (2026-07-30) ──────────────────────────────────────
// Every tool result that names an Agent/Skill MUST carry its readiness, or
// the assistant cannot honour its disclaimer rules (it would be guessing).
// Three buckets drive three different behaviours in CHAT_SYSTEM_PROMPT:
//   'ready'  (Ready to Use, 100%) — recommend freely
//   'pilot'  (Pilot, 90-99%)      — recommend, but MUST carry the
//                                   "under real-world testing" disclaimer
//   'in_dev' (In Progress / To Do)— may appear as context, but MUST be
//                                   flagged as not usable yet
// `endpoint` rides along for the same reason: the assistant can only hand out
// a link if the tool actually told it one exists.
export function readinessOf(agent) {
  const status = ST_DEF[agentStatus({ devProgress: progressNum(agent) })].lb;
  const readiness = status === 'Ready to Use' ? 'ready' : status === 'Pilot' ? 'pilot' : 'in_dev';
  return { status, readiness, endpoint: agent?.endpoint || '' };
}

// Sort helper: Ready to Use first, then Pilot, then everything still in
// development — the order the user asked recommendations to appear in.
const READINESS_RANK = { ready: 0, pilot: 1, in_dev: 2 };

// ── Semantic similarity (2026-08-04) ─────────────────────────────────
// Vectors are produced by the reindexAgentVectors function and read from
// /agentVectors; the query vector comes from the embedQuery callable (the
// browser has no Vertex credentials and must not). Both arrive through ctx so
// every skill here stays a pure, synchronous function over its context.
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// How many candidates each retrieval arm contributes before the union.
// Calibrated against the real 244-entry index: correct answers cluster in the
// top ~5 for embeddings, so 12 leaves headroom without flooding the model.
// The lexical arm stays because it measurably wins when wording overlaps
// literally — an English draft "Test Case Generator" ranked #1 lexically but
// only #2 by embedding — so the union is strictly better than either alone.
const SEM_TOP_K = 12;
const LEX_TOP_K = 8;

// Entries flagged `internalTool` are implementation fragments of other agents
// (the "N.something.md" prompt files), not tools a person can pick up. They are
// deliberately DEMOTED rather than excluded — they remain findable if someone
// genuinely asks about one, and they stay fully visible in the web UI.
//
// Why demote at all: measured on the real library, "เขียน code" ranked
// 6.answer-writer.md #1 at 0.773, above every actual development agent. Short
// generic queries land near these files because their text is generic, so they
// crowd out real answers on exactly the questions users ask most.
//
// The penalty is applied to the RANKING score only; the `similarity` reported
// to the model stays the true cosine, so nothing downstream is misled.
const INTERNAL_RANK_PENALTY = 0.85;
const rankScore = (agent, sem) => (agent?.internalTool === true ? sem * INTERNAL_RANK_PENALTY : sem);

// Deliberately NO score floor. Measured on the real library: the nonsense
// query "ช่วยแปลภาษาญี่ปุ่นเป็นไทย" scores 0.687 while the genuine query
// "เทสเคส" scores only 0.621 — cosine cannot separate real from irrelevant, so
// any threshold would cut real questions and admit nonsense. Deciding "there
// is nothing for this" is the model's job, with the score passed along as a
// weak hint.

// devProgress may still be a legacy string ("90%") on a handful of un-migrated
// docs — same defensive coercion as useAgents.js's normalizeAgent.
function progressNum(agent) {
  const raw = agent?.devProgress;
  const num = typeof raw === 'number' ? raw : parseInt(String(raw || '').replace('%', ''), 10);
  return isNaN(num) ? 0 : num;
}

// capability_search cache — keyed by the library array's own identity (a new
// array is produced on every Firestore onSnapshot, so this auto-invalidates
// whenever the underlying data changes) then by query+limit. Same chat
// question asked twice within one session reuses the scored result instead
// of re-scanning the whole library.
const capabilitySearchCache = new WeakMap();

function matchesKeyword(agent, keyword) {
  if (!keyword) return true;
  const q = keyword.toLowerCase().trim();
  if (!q) return true;
  const hay = norm([
    agent.agentName, agent.owner, agent.description, agent.useCase,
    agent.coreAbility, agent.relatedRole,
    agent.creator, Array.isArray(agent.creatorEmails) ? agent.creatorEmails.join(' ') : '',
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

// Verbs that describe what almost EVERY agent does ("สร้าง/create", "ช่วย/help")
// carry no discriminating signal, but a single hit on one used to be enough to
// clear the gate below. Real failure (2026-07-30): the query "สร้าง user story"
// surfaced an investment-news skill whose description happened to contain
// "…แล้วคำนวณและสร้าง…", and the assistant presented it as the answer. Dropping
// these from the QUERY (never from the haystack) leaves "user story" — the part
// that actually identifies what the user wants.
const QUERY_STOPWORDS = new Set([
  'สร้าง', 'ช่วย', 'ทำ', 'ใช้', 'หา', 'ตัว', 'ไหน', 'เรื่อง', 'การ', 'ได้', 'บ้าง', 'มี', 'ที่',
  'create', 'creating', 'make', 'making', 'help', 'helps', 'generate', 'generating',
  'build', 'building', 'do', 'does', 'get', 'the', 'for', 'with', 'and', 'any',
]);

function scoreText(hay, query) {
  const q = norm(query);
  const rawChunks = q.split(/\s+/).filter((w) => w.length >= 2);
  // Keep the stopwords only if stripping them would leave nothing to match on
  // (e.g. the user genuinely typed just "สร้าง").
  const meaningful = rawChunks.filter((w) => !QUERY_STOPWORDS.has(w));
  const chunks = meaningful.length ? meaningful : rawChunks;
  // Trigrams follow the same filtered text, so a stopword can't sneak the
  // score back in through character overlap either.
  const flat = chunks.join('').replace(/\s+/g, '');
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
      description: 'ค้นหา Agent/Skill ที่มีอยู่แล้วในไลบรารีที่ใกล้เคียงกับ draft ที่ให้มา — hybrid: rule-based nearest-neighbour ∪ semantic (embeddings) คืน top-N พร้อมคะแนน (ไม่กรอง threshold)',
      parameters: {
        draft: '{ agentName, description, coreAbility, input, output, businessValue }',
        limit: 'number — จำนวนที่คืน (default 15)',
      },
    },
    // Form-only (not a chat tool): includes archived so a registrant is warned
    // about work that was already tried and retired.
    //
    // Hybrid for the same reason as capability_search, but the stakes are
    // higher here: a duplicate this stage misses becomes a redundant agent
    // someone actually builds. similarity.js already admitted the weakness in
    // its own comment ("a genuine semantic overlap written in different words
    // (or mixed Thai/English) can score well below the cutoff") and mitigated
    // it by removing the threshold — but that only helps if the true duplicate
    // is already inside the top-N, and ranking was still done by the same
    // surface-token score. Measured: a Thai-reworded duplicate of TC Writer sat
    // at #7 of 15 and would fall clean out of the window on the real 244-entry
    // library, so the AI would never have seen it.
    //
    // The union NEVER shrinks the candidate set — rule-based hits keep their
    // places (an English "Test Case Generator" ranks #1 lexically and only #2
    // semantically, so dropping the lexical arm would have made that case
    // worse) — semantic hits are added on top. Recall cannot regress.
    run: ({ draft, limit = 15 }, ctx) => {
      const lib = analysisLib(ctx);
      const ruleHits = rankCandidates(draft, lib, limit);
      if (!ctx.queryVector || !ctx.vectors?.size) return ruleHits;

      const seen = new Set(ruleHits.map((r) => r.existing?.id || r.existing?.agentName));
      const semHits = lib
        .map((a) => ({ a, sem: cosine(ctx.queryVector, ctx.vectors.get(a.id)) }))
        .filter((x) => x.sem > 0 && !seen.has(x.a.id) && !seen.has(x.a.agentName))
        .sort((x, y) => y.sem - x.sem)
        .slice(0, SEM_TOP_K)
        // Shape-match rankCandidates' output so downstream code (PreRegModal
        // and the analyzeDuplicate prompt) needs no special-casing. confidence
        // is the real rule score — recomputed, not faked — so the AI is never
        // handed an invented number; `viaSemantic` marks where it came from.
        .map(({ a, sem }) => ({
          existing: a,
          ...scoreDraftAgainst(draft, a),
          semantic: Math.round(sem * 1000) / 1000,
          viaSemantic: true,
        }));

      return [...ruleHits, ...semHits];
    },
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
    // Form-only (not a chat tool): archived included — see search_library.
    run: ({ draft, limit = 5 }, ctx) => findDuplicates(draft, analysisLib(ctx), limit),
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
    // Active only — you cannot integrate with an entry that has been retired.
    // Each suggestion is enriched with the TARGET's readiness/endpoint (the
    // scorer in connections.js only knows about names/scores): the assistant
    // has to disclose that a suggested integration target is itself still in
    // development, and can hand out its link when one exists.
    run: ({ draft, limit = 6 }, ctx) => {
      const lib = recommendLib(ctx);
      return findConnectionSuggestions(draft, lib, ctx.processes, limit).map((c) => {
        const target = lib.find((a) => norm(a.agentName) === norm(c.target));
        return target ? { ...c, ...readinessOf(target), owner: target.owner || '' } : c;
      });
    },
  },

  get_agent_detail: {
    describe: {
      name: 'get_agent_detail',
      description: 'ดึงข้อมูลเต็มของ Agent/Skill หนึ่งตัวจากไลบรารีด้วยชื่อ (case-insensitive) — ใช้ตอบคำถามเจาะจงตัวใดตัวหนึ่ง',
      parameters: { agentName: 'string — ชื่อ Agent/Skill' },
    },
    // Returns the raw doc PLUS the derived readiness fields — the doc itself
    // only stores devProgress, and the assistant should never have to derive
    // the status label (or re-implement the thresholds) on its own.
    //
    // Name lookup is fuzzy (resolveAgentByName): users type names from memory,
    // and an exact match previously failed on nothing more than a different
    // spacing around a hyphen. On a miss the result carries `suggestions` so
    // the assistant can offer "did you mean…" instead of a dead end.
    run: ({ agentName }, ctx) => {
      const { match, matchedBy, suggestions } = resolveAgentByName(recommendLib(ctx), agentName);
      if (!match) return { found: false, query: agentName, matchedBy, suggestions };
      return {
        found: true,
        // Surfaced so the assistant can confirm when it corrected the user's
        // spelling rather than silently answering about a different entry.
        matchedBy,
        matchedName: match.agentName,
        ...match,
        ...readinessOf(match),
      };
    },
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
        creator: 'array of creator name/email substrings (optional) — ใช้ตอบ "AI ตัวไหนที่ <ชื่อคน> เป็น creator"',
        relatedRole: 'array of role strings (optional)',
        coreAbility: 'array of ability strings (optional)',
        reusable: 'array of "Reusable" | "Reusable with Conditions" | "Non-reusable" (optional)',
        status: 'array of "To Do" | "In Progress" | "Pilot" | "Ready to Use" (optional)',
        scope: '"Internal" | "External" (optional)',
        sdlcStage: 'array of SDLC stage names (optional, requires ctx.processes)',
        sdlcProcessMapping: 'array of process ids e.g. "2.2" (optional)',
        sdlcMapped: '"mapped" | "unmapped" (optional) — unmapped = เอาเฉพาะตัวที่ยังไม่ได้ผูกกับ SDLC process ใดเลย, mapped = เฉพาะตัวที่ผูกแล้ว ใช้ตอบ "Agent/Skill ตัวไหนยังไม่ได้ผูก process" และใช้คู่กับ query_sdlc(onlyGaps) เพื่อหาว่าของที่มีอยู่แล้วเอาไปปิด gap ไหนได้',
        category: 'array of category names (optional) — หมวดโดเมนงาน เช่น "Investment", "Design & UI" — matches if the agent has ANY of these',
        useCase: 'array of use case name strings (optional) — matches if the agent has ANY of these',
        keyword: 'string — free-text search across name/owner/description/ability/role (optional)',
        groupBy: '"owner" | "creator" | "tier" | "status" | "relatedRole" | "coreAbility" | "category" (optional) — if set, returns counts per group instead of a flat list',
      },
    },
    run: (args, ctx) => {
      const {
        type = 'all', tier, owner, creator, relatedRole, coreAbility, reusable, status,
        scope, sdlcStage, sdlcProcessMapping, sdlcMapped, useCase, category, keyword, groupBy,
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

      // `keyword` used to be a pure substring test, which made it the last
      // place the old lexical-only behaviour could still bite: a Thai keyword
      // against an English field matches nothing, exactly like "เทสเคส" once
      // returned zero results. Structured filters (tier/owner/status/…) stay
      // literal — those ARE exact values — but the free-text keyword now also
      // admits semantic neighbours. Union, so a substring hit is never lost.
      let semanticKeywordIds = null;
      if (keyword && ctx.queryVector && ctx.vectors?.size) {
        semanticKeywordIds = new Set(
          recommendLib(ctx)
            .map((a) => ({ id: a.id, sem: cosine(ctx.queryVector, ctx.vectors.get(a.id)) }))
            .filter((x) => x.sem > 0)
            .sort((x, y) => y.sem - x.sem)
            .slice(0, SEM_TOP_K)
            .map((x) => x.id)
        );
      }

      const filtered = recommendLib(ctx).filter((a) => {
        if (type !== 'all' && type && getType(a) !== type.toLowerCase()) return false;
        if (tier?.length && !tier.includes(getTier(a))) return false;
        if (owner?.length && !owner.includes(a.owner || '')) return false;
        if (creator?.length) {
          // Substring match (not exact): `creator` is a comma-joined display
          // string of the whole team, and the user often types a partial name.
          // Also search creatorEmails so an email query works too.
          const hay = norm([a.creator, Array.isArray(a.creatorEmails) ? a.creatorEmails.join(' ') : ''].join(' '));
          if (!creator.some((c) => hay.includes(norm(c)))) return false;
        }
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
        // "Has it been placed in the SDLC at all?" — the axis that was missing
        // (2026-08-20). Without it the assistant could list gap processes and
        // list the library, but could not answer the obvious follow-up: which
        // of the things we ALREADY own are floating unattached and might cover
        // one of those gaps. Measured at the time: 116 of 243 live entries
        // carry no process mapping, against 29 of 58 processes with no agent.
        if (sdlcMapped === 'unmapped' && agentProcessIds(a).length > 0) return false;
        if (sdlcMapped === 'mapped' && agentProcessIds(a).length === 0) return false;
        if (stageProcessIds) {
          const ids = agentProcessIds(a);
          if (!ids.some((id) => stageProcessIds.has(id))) return false;
        }
        if (useCase?.length) {
          const names = agentUseCaseNames(a).map(norm);
          if (!useCase.some((u) => names.includes(norm(u)))) return false;
        }
        // Category is multi-value per agent (one entry can sit in several
        // domains), so ANY-of, matching how useCase/relatedRole behave.
        if (category?.length) {
          const cats = agentCategories(a).map(norm);
          if (!category.some((c) => cats.includes(norm(c)))) return false;
        }
        if (keyword && !matchesKeyword(a, keyword) && !semanticKeywordIds?.has(a.id)) return false;
        return true;
      });

      if (groupBy) {
        const keyFn = {
          owner: (a) => a.owner || '(ไม่ระบุ)',
          tier: (a) => getTier(a),
          status: (a) => ST_DEF[agentStatus({ devProgress: progressNum(a) })].lb,
        }[groupBy] || null;
        if (groupBy === 'relatedRole' || groupBy === 'coreAbility' || groupBy === 'creator' || groupBy === 'category') {
          // Multi-value group: one agent can contribute to several buckets.
          // creator is a comma-joined display string → split like roles.
          const valsOf = (a) => {
            if (groupBy === 'relatedRole') return splitRoles(a.relatedRole);
            if (groupBy === 'category') return agentCategories(a);
            if (groupBy === 'coreAbility') return Array.isArray(a.coreAbility) ? a.coreAbility : [a.coreAbility];
            return String(a.creator || '').split(',').map((s) => s.trim());
          };
          const counts = {};
          filtered.forEach((a) => {
            valsOf(a).filter(Boolean).forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
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
        // Sorted by readiness (Ready to Use → Pilot → still in development) so
        // the assistant presents usable things first without having to re-rank.
        agents: filtered
          .map((a) => ({
            agentName: a.agentName, type: getType(a), tier: getTier(a), owner: a.owner,
            creator: a.creator || '',
            ...readinessOf(a),
            reusable: a.reusable || '', scope: isInternalOrExternal(a),
            category: agentCategories(a),
          }))
          .sort((x, y) => READINESS_RANK[x.readiness] - READINESS_RANK[y.readiness]),
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
        // Coverage counts active agents only — an archived agent no longer
        // covers its process, which is the honest signal for a gap map (same
        // rule the Dashboard applies).
        recommendLib(ctx).forEach((a) => {
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

  // ── SDLC gap matching (2026-08-20) ────────────────────────────────────
  //
  // Why this is a TOOL and not a prompt instruction:
  //
  // The first attempt told the model to fetch the gap list, fetch the unmapped
  // agents, and "match them yourself". It fabricated every single name it
  // presented — Vendor Proposal Compliance Validator, Contract Validator
  // Assistant, Self-service test data creation: none of the six existed in a
  // 251-doc library. That was predictable in hindsight: query_library returns
  // names WITHOUT descriptions, so the model had nothing to match on and
  // filled the hole with plausible-sounding inventions.
  //
  // This is the same lesson as the @@ card protocol (CLAUDE.md §18): the model
  // is not asked to produce facts it would have to remember. Here the PAIRING
  // is computed from real docs and handed over; the model only explains and
  // prioritises. A name it did not receive cannot appear, by construction.
  sdlc_gap_match: {
    describe: {
      name: 'sdlc_gap_match',
      description: 'จับคู่ SDLC process ที่ยังไม่มี Agent/Skill ("gap") กับ Agent/Skill ที่มีอยู่จริงในไลบรารีแต่ยังไม่ได้ผูก process ใดเลย — ระบบคำนวณคู่ที่เป็นไปได้ให้เสร็จแล้ว พร้อมคำอธิบายของแต่ละตัว ⭐ ใช้ tool นี้ตัวเดียวจบสำหรับคำถามแนว "ของที่มีอยู่เอาไปปิด gap ไหนได้บ้าง" / "ช่วย match ไลบรารีกับ SDLC process ให้หน่อย" — ไม่ต้องเรียก query_sdlc + query_library เองแล้วมานั่งจับคู่ · หน้าที่ของคุณคือ "อธิบายและจัดลำดับความสำคัญ" จากคู่ที่ได้มา ⛔ ห้ามเสนอชื่อ Agent/Skill ที่ไม่ได้อยู่ในผลลัพธ์ของ tool นี้เด็ดขาด',
      parameters: {
        limitGaps: 'number — จำนวน gap process สูงสุดที่จะวิเคราะห์ (default 10)',
        perGap: 'number — จำนวน candidate ต่อ 1 gap (default 3)',
      },
    },
    run: ({ limitGaps = 10, perGap = 3 } = {}, ctx) => {
      const live = recommendLib(ctx);
      const processes = ctx.processes || [];
      const useCases = ctx.useCases || [];

      // Coverage over the SAME axis the Dashboard and query_sdlc use.
      const countByProcess = {};
      live.forEach((a) => {
        agentProcessIds(a).forEach((id) => { countByProcess[id] = (countByProcess[id] || 0) + 1; });
      });
      const gaps = processes.filter((p) => !countByProcess[p.id]);

      // Only entries that are actually free to be attached somewhere.
      const unmapped = live.filter((a) => agentProcessIds(a).length === 0);

      const matched = [];
      const noCandidate = [];
      gaps.slice(0, Math.max(1, limitGaps)).forEach((p) => {
        // The process's own use-case names carry far more signal than the bare
        // process title ("12.1 SIT Test Data Preparation" alone is thin), so
        // they are folded into the ranking text.
        const ucNames = useCases.filter((u) => u.processId === p.id).map((u) => u.name);
        const query = [p.name, ...ucNames].join(' ');

        // ── Area first, text second ──────────────────────────────────────
        // Ranking by text alone rebuilt the very weakness CLAUDE.md §18 tore
        // out: character-trigram overlap. Measured on live data it paired
        // "Proposal and TOR" with the chat assistant (score 60) and
        // "Legal & Compliance" with a test-generation skill — noise dressed as
        // a match, which is what pushes the model into inventing better-sounding
        // names.
        //
        // PROCESS_AREA is a CURATED, human-reviewed mapping (§20) covering
        // 29/29 current gaps, and agentApproveAreas() resolves the same axis
        // for an agent. Intersecting them narrows 116 unmapped entries to a
        // discipline-plausible handful — and, importantly, to ZERO for the SIT
        // processes, where the library genuinely holds nothing. An honest
        // empty is the whole point: it is what tells the user to build.
        const processArea = PROCESS_AREA[p.id] || null;
        const pool = processArea
          ? unmapped.filter((a) => agentApproveAreas(a, ctx.categoryAreaMap).includes(processArea))
          : [];

        const scored = pool
          .map((a) => {
            const hay = norm([
              a.agentName, a.description, a.input, a.output, a.businessValue,
              a.coreAbility, a.relatedRole,
            ].join(' '));
            // Text score orders WITHIN the area pool; it no longer decides
            // membership, so a 0 here is not a rejection.
            return { a, score: scoreText(hay, query) };
          })
          .sort((x, y) => y.score - x.score)
          .slice(0, Math.max(1, perGap));

        const row = {
          processId: p.id,
          processName: p.name,
          stage: p.stage || '',
          owner: p.owner || '',
          approveArea: processArea,
          useCases: ucNames,
          candidates: scored.map(({ a, score }) => ({
            agentName: a.agentName,
            type: getType(a),
            tier: getTier(a),
            owner: a.owner || '',
            // The field whose absence caused the fabrication — without it the
            // model cannot judge fit and starts inventing.
            description: a.description || '',
            coreAbility: Array.isArray(a.coreAbility) ? a.coreAbility : [a.coreAbility].filter(Boolean),
            ...readinessOf(a),
            score,
          })),
        };
        if (row.candidates.length) matched.push(row); else noCandidate.push(row);
      });

      return {
        totalGaps: gaps.length,
        totalUnmapped: unmapped.length,
        analysed: Math.min(gaps.length, Math.max(1, limitGaps)),
        // Gaps WITH a real candidate to consider.
        matched,
        // Gaps where nothing in the library scored at all — the honest answer
        // is "build something new", and saying so is the point.
        noCandidate: noCandidate.map((r) => ({ processId: r.processId, processName: r.processName, stage: r.stage })),
        // Stated so the model does not present a lexical shortlist as a verdict.
        method: 'candidates are unmapped entries whose Approve Area matches the process\'s Approve Area (a curated mapping), ordered within that pool by keyword overlap with the process name and its use cases. It is a SHORTLIST to reason over, not a verdict — judge each one against its description and drop the ones that do not fit.',
      };
    },
  },

  list_categories: {
    describe: {
      name: 'list_categories',
      description: 'คืนรายชื่อ Category ทั้งหมดที่ระบบอนุมัติแล้ว อ่านตรงจาก /config/schema.category (ไม่ใช่นับจาก agent ที่มีอยู่) — ใช้ตอบ "มีหมวดหมู่อะไรบ้าง", "Category มีกี่แบบ" เพราะ Category เป็น list ที่โตได้เรื่อยๆ (AI เสนอหมวดใหม่ตอน pre-registration แล้วรอ admin อนุมัติ) หมวดที่เพิ่งอนุมัติแต่ยังไม่มี agent ใช้จะยังไม่โผล่ใน query_library groupBy — ต้องใช้ tool นี้แทนถึงจะเห็นครบ',
      parameters: {},
    },
    run: (_args, ctx) => ({ categories: ctx.categories || [] }),
  },

  capability_search: {
    describe: {
      name: 'capability_search',
      description: 'หา Agent/Skill ที่ "ความสามารถ" ตรงกับที่ถามเชิงความหมาย (เช่น "มีตัวไหนทำ documentation generation ได้บ้าง") — hybrid: รวมผลค้นเชิงความหมาย (embeddings) กับการเทียบคำตรงตัว แล้วคืน candidate ให้ผู้เรียกใช้ (LLM) คัดเลือกอีกชั้นจากความหมายจริง ไม่ใช่ผลลัพธ์สุดท้าย',
      parameters: {
        query: 'string — คำอธิบายความสามารถที่ต้องการค้นหา (ภาษาธรรมชาติ)',
        intent: '"usable_now" | "all" — usable_now = เอาเฉพาะที่ใช้งานได้จริงตอนนี้ (Ready to Use + Pilot)',
        limit: 'number — จำนวนสูงสุด (default 15)',
      },
    },
    // Hybrid retrieval. Two arms, unioned:
    //
    //   semantic — cosine over /agentVectors. This is what makes a Thai query
    //              find an English field: "เทสเคส" used to return ZERO results
    //              because the library stores "Testcase", and "ตัวไหนช่วย debug
    //              bug" now finds RCA Fix Assistant whose description contains
    //              neither "debug" nor "bug".
    //   lexical  — the original scoreText pass, kept because it measurably wins
    //              when wording overlaps literally.
    //
    // Union, never replacement: the candidate set strictly contains what the
    // lexical arm alone would have produced, so recall cannot regress.
    //
    // If vectors are unavailable (still loading, or the index has not been
    // built) the semantic arm contributes nothing and this degrades to exactly
    // the old behaviour rather than failing.
    run: ({ query, intent = 'all', limit = 15 }, ctx) => {
      const cacheKey = `${(query || '').trim().toLowerCase()}::${intent}::${limit}::${ctx.queryVector ? 'v' : 'n'}`;
      // Cache stays keyed on ctx.library — the array straight from onSnapshot,
      // whose identity is stable between snapshots. Keying it on the filtered
      // list instead would allocate a fresh array per call and never hit.
      let byQuery = capabilitySearchCache.get(ctx.library);
      if (!byQuery) {
        byQuery = new Map();
        capabilitySearchCache.set(ctx.library, byQuery);
      }
      if (byQuery.has(cacheKey)) return byQuery.get(cacheKey);

      const pool = recommendLib(ctx);
      const picked = new Map(); // agentName -> { a, sem, lex }

      // ── semantic arm ──
      const vectors = ctx.vectors;
      if (ctx.queryVector && vectors) {
        pool
          .map((a) => {
            const sem = cosine(ctx.queryVector, vectors.get(a.id));
            return { a, sem, rank: rankScore(a, sem) };
          })
          .filter((x) => x.sem > 0)
          .sort((x, y) => y.rank - x.rank)
          .slice(0, SEM_TOP_K)
          .forEach(({ a, sem, rank }) => picked.set(a.agentName, { a, sem, rank, lex: 0 }));
      }

      // ── lexical arm ──
      pool
        .map((a) => {
          const hay = norm([a.agentName, a.description, a.input, a.output, a.businessValue, a.coreAbility].join(' '));
          return { a, lex: scoreText(hay, query) };
        })
        .filter((x) => x.lex > 0)
        .sort((x, y) => y.lex - x.lex)
        .slice(0, LEX_TOP_K)
        .forEach(({ a, lex }) => {
          const hit = picked.get(a.agentName);
          if (hit) hit.lex = lex;
          else picked.set(a.agentName, { a, sem: 0, rank: 0, lex });
        });

      let rows = [...picked.values()];

      // Readiness gate enforced HERE, in code — not as a prompt rule. The
      // prompt already forbade offering in-development entries as an answer to
      // "what can I use", and the model listed seven of them anyway. A filter
      // the model cannot forget is the only version that holds.
      if (intent === 'usable_now') {
        rows = rows.filter(({ a }) => readinessOf(a).readiness !== 'in_dev');
      }

      // Rank by the penalised semantic score first (it is the better signal),
      // falling back to the lexical score for entries the semantic arm never saw.
      rows.sort((x, y) => ((y.rank || 0) - (x.rank || 0)) || (y.lex - x.lex));

      const result = rows.slice(0, limit).map(({ a, sem, lex }) => ({
        agentName: a.agentName,
        type: getType(a),
        tier: getTier(a),
        description: (a.description || '').slice(0, 300),
        input: a.input || '', output: a.output || '', businessValue: (a.businessValue || '').slice(0, 200),
        coreAbility: a.coreAbility,
        category: agentCategories(a),
        owner: a.owner || '',
        creator: a.creator || '',
        // A weak hint only. Deliberately NOT thresholded — measured on the real
        // library, a nonsense query outscored a genuine one (0.687 vs 0.621),
        // so the model must judge relevance from meaning, not from this number.
        similarity: Math.round(sem * 1000) / 1000,
        matchedBy: sem > 0 && lex > 0 ? 'both' : sem > 0 ? 'semantic' : 'keyword',
        // Readiness + endpoint travel with EVERY candidate: this tool answers
        // "is there something that does X", and the assistant must be able to
        // say which of the hits are actually usable (and hand out the link)
        // without a second lookup.
        ...readinessOf(a),
      }));
      byQuery.set(cacheKey, result);
      return result;
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
