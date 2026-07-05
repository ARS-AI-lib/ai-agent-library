import { useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, doc, setDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../lib/firebase';
import { riskLevel, RISK_DEF, scoreDraftAgainst } from '../lib/similarity';
import { runSkill } from '../lib/skills';
import { warmDirectory } from '../lib/directory';
import { uniq, splitRoles } from '../lib/agentUtils';
import ComboInput from './ComboInput';
import MultiSelect from './MultiSelect';
import CreatorPicker from './CreatorPicker';
import AgentDetailModal from './AgentDetailModal';

// Submit is hard-blocked based on verdict FIRST, confidence as a secondary
// filter within that verdict — not a single flat confidence ceiling. Decided
// 2026-07-02 after discussion: verdict already encodes the AI's judgement of
// HOW similar something is; using it as the primary axis (with confidence
// tightening/loosening within each band) avoids a flat threshold either being
// too strict on legitimately-related-but-distinct work, or too loose on a
// high-confidence "likely_overlap" that's really a near-duplicate.
// 2026-07-02 (7th grill-me): switched to a WARN-not-block model for everything
// except a genuine near-duplicate. The LLM misclassifies verdicts often enough
// (it just rated a clear sub-function overlap as "distinct_but_related") that
// hard-blocking on its softer verdicts is too fragile — a wrongly-blocked
// legitimate specialised agent frustrates users more than a warned-but-passed
// one. So only clear_duplicate hard-blocks (that verdict is unambiguous enough
// to auto-gate); likely_overlap/distinct now WARN and route to the approver via
// an overlap flag on the stored analysisResult — a human is the real gate.
const HARD_BLOCK = { clear_duplicate: 70 };   // only verdict that can disable Submit
// A draft that partially overlaps this many existing agents is a "kitchen-sink"
// pattern (rebuilding work spread across the specialised library) — surfaced as
// a warning + approver flag even when each pairwise overlap is individually low.
const BREADTH_OVERLAP_COUNT = 3;

// Human-readable Thai labels for the AI's verdict enum — the raw
// snake_case values (clear_duplicate, likely_overlap, ...) are fine as an
// API contract but look unpolished shown directly in the UI.
const VERDICT_LABEL = {
  clear_duplicate: 'ซ้ำชัดเจน',
  likely_overlap: 'ทับซ้อนบางส่วน',
  distinct_but_related: 'ต่างกันแต่เกี่ยวข้อง',
  unrelated: 'ไม่เกี่ยวข้อง',
};

// A new submission whose draft is at least this rule-based-similar to an
// existing knowledge-base entry is treated as a near-duplicate and NOT stored
// again (avoids piling up redundant analysis records).
const KB_DEDUP_THRESHOLD = 80;

const EMPTY_FORM = {
  agentName: '',
  type: 'Agent',          // Agent | Skill | Agent+Skill
  description: '',
  coreAbility: new Set(),
  relatedRole: new Set(),
  scope: 'Internal',      // Internal | External
  input: '',
  output: '',
  businessValue: '',
  owner: '',
  creatorPicks: [],       // [{ name, email }] — other creator/team members picked from directory, alongside the submitter
  reusable: '',           // '' | 'Reusable' | 'Reusable with Conditions' | 'Non-reusable'
  reuseCondition: '',
  hml: false,
  humanJob: '',
  tool: '',
  llm: '',
  dataPrivacy: '',
  sdlcStage: new Set(),
  sdlcProcessMapping: new Set(),
  useCase: '',
  skills: [],             // paired sub-skills when type === 'Agent+Skill' (each → its own Skill doc)
};

let skillSeq = 0;
// A paired sub-skill carries only the fields that make it its OWN entity; the
// rest (owner, tool, llm, dataPrivacy, SDLC, businessValue) are inherited from
// the parent Agent at submit time.
function emptySkill() {
  skillSeq += 1;
  return {
    _id: `sk-${skillSeq}`,
    name: '', description: '', scope: 'Internal',
    ability: new Set(), relatedRole: new Set(),
    input: '', output: '', reusable: '', reuseCondition: '',
    hml: false, humanJob: '',
  };
}

function typeToFlags(t) {
  if (t === 'Skill') return { aiAgent: false, skillMd: true };
  // Agent+Skill: the MAIN doc is a pure Agent — each paired skill becomes its
  // own separate Skill doc (linked via matchingAgent), so the main is not both.
  return { aiAgent: true, skillMd: false };
}

const REUSABLE_OPTIONS = ['Reusable', 'Reusable with Conditions', 'Non-reusable'];

// Build a clean, de-duplicated option list from existing multi-value data:
// split on comma/slash, trim, unique, sort.
function splitOptions(values) {
  return uniq(values.flatMap((v) => splitRoles(v))).sort();
}

export default function PreRegModal({ onClose, approvedAgents, schema, user, onSubmitted }) {
  const [tab, setTab] = useState('form');
  const [form, setForm] = useState(EMPTY_FORM);
  const [validationMsg, setValidationMsg] = useState('');
  const [ranked, setRanked] = useState(null);   // rule-based top-N (for fallback display)
  const [connections, setConnections] = useState([]);  // rule-based directional connections
  const [aiResult, setAiResult] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [useCaseOptions, setUseCaseOptions] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [detailAgent, setDetailAgent] = useState(null);   // click-through preview from analysis results

  // In-memory, session-only analysis cache: keyed on the exact payload sent to
  // the AI. Re-running the check on an UNCHANGED draft returns the same result
  // (identical numbers while the user is testing) without another LLM call —
  // this is what smooths out the "3 runs, 3 different numbers" jitter. It never
  // touches Firestore, so nothing is stored for an un-submitted draft, and it's
  // cleared on submit (and naturally discarded when the modal unmounts).
  const analysisCacheRef = useRef(new Map());

  // Warm the directory cache the moment the form opens — a safety net for when
  // login happened long enough ago that the post-login warm didn't stick.
  useEffect(() => { warmDirectory(); }, []);

  // Use Case dropdown + connection-engine catalog both come from the
  // authoritative SDLC collections, not free-typed agent data.
  useEffect(() => {
    let alive = true;
    Promise.all([
      getDocs(collection(db, 'sdlcUseCases')),
      getDocs(collection(db, 'sdlcProcesses')),
    ])
      .then(([ucSnap, procSnap]) => {
        if (!alive) return;
        setUseCaseOptions(uniq(ucSnap.docs.map((d) => d.data().name).filter(Boolean)).sort());
        setProcesses(procSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      })
      .catch(() => { if (alive) { setUseCaseOptions([]); setProcesses([]); } });
    return () => { alive = false; };
  }, []);

  const ownerOptions = useMemo(() => uniq(approvedAgents.map((a) => a.owner)).sort(), [approvedAgents]);
  const abilityOptions = useMemo(
    () => (schema.coreAbility?.length ? schema.coreAbility : splitOptions(approvedAgents.map((a) => a.coreAbility))),
    [schema.coreAbility, approvedAgents]
  );
  const roleOptions = useMemo(() => splitOptions(approvedAgents.map((a) => a.relatedRole)), [approvedAgents]);
  const stageOptions = schema.sdlcStage?.length ? schema.sdlcStage : [];
  // Process Mapping is cascaded from the selected SDLC Stage(s), using the
  // real stage↔process link from the /sdlcProcesses catalog (source of truth:
  // the SDLC Google Sheet, gid=1166115430) — NOT the flat schema list, so a
  // process from an unrelated stage can never be picked.
  const processOptions = useMemo(() => {
    if (form.sdlcStage.size === 0) return [];
    return uniq(
      processes
        .filter((p) => form.sdlcStage.has(p.stage))
        .map((p) => `${p.id} ${p.name}`.trim())
    ).sort();
  }, [processes, form.sdlcStage]);

  // If the user changes Stage after already picking Process(es), drop any
  // selected process that no longer belongs to the (new) selected stages.
  useEffect(() => {
    setForm((f) => {
      if (f.sdlcProcessMapping.size === 0) return f;
      const valid = new Set(processOptions);
      const kept = new Set([...f.sdlcProcessMapping].filter((p) => valid.has(p)));
      if (kept.size === f.sdlcProcessMapping.size) return f;
      return { ...f, sdlcProcessMapping: kept };
    });
  }, [processOptions]);

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // ── Paired-skill list management (Agent+Skill only) ──
  function addSkill() {
    setForm((f) => ({ ...f, skills: [...f.skills, emptySkill()] }));
  }
  function removeSkill(id) {
    // The first skill row can never be removed (always at least one, default
    // visible) — guard here too, not just in the UI, in case of future callers.
    setForm((f) => (f.skills[0]?._id === id ? f : { ...f, skills: f.skills.filter((s) => s._id !== id) }));
  }
  function setSkillField(id, key, value) {
    setForm((f) => ({ ...f, skills: f.skills.map((s) => (s._id === id ? { ...s, [key]: value } : s)) }));
  }

  function validate() {
    if (!form.agentName.trim()) return 'กรุณากรอกชื่อ Agent/Skill';
    if (!form.description.trim()) return 'กรุณากรอก Description';
    if (form.coreAbility.size === 0) return 'กรุณาเลือก Core Ability อย่างน้อย 1 ค่า';
    if (form.relatedRole.size === 0) return 'กรุณาเลือก Related Role อย่างน้อย 1 ค่า';
    if (!form.input.trim()) return 'กรุณากรอก Input';
    if (!form.output.trim()) return 'กรุณากรอก Output';
    if (!form.businessValue.trim()) return 'กรุณากรอก Business Value';
    if (!form.owner.trim()) return 'กรุณาระบุ Owner';
    if (!form.reusable) return 'กรุณาเลือก Reusable';
    if (form.reusable === 'Reusable with Conditions' && !form.reuseCondition.trim()) {
      return 'กรุณากรอก Reuse Conditions';
    }
    if (form.hml && !form.humanJob.trim()) return 'กรุณากรอก Human Job (เมื่อเปิด HML)';
    if (form.type === 'Agent+Skill') {
      if (form.skills.length === 0) return 'Type = Agent+Skill ต้องเพิ่ม Skill อย่างน้อย 1 ตัว (หรือเปลี่ยน Type เป็น Agent)';
      for (let i = 0; i < form.skills.length; i++) {
        const s = form.skills[i];
        const n = `Skill #${i + 1}`;
        if (!s.name.trim()) return `${n}: กรุณากรอกชื่อ Skill`;
        if (!s.description.trim()) return `${n}: กรุณากรอก Description`;
        if (s.ability.size === 0) return `${n}: กรุณาเลือก Core Ability`;
        if (s.relatedRole.size === 0) return `${n}: กรุณาเลือก Related Role`;
        if (!s.input.trim()) return `${n}: กรุณากรอก Input`;
        if (!s.output.trim()) return `${n}: กรุณากรอก Output`;
        if (!s.reusable) return `${n}: กรุณาเลือก Reusable`;
        if (s.reusable === 'Reusable with Conditions' && !s.reuseCondition.trim()) return `${n}: กรุณากรอก Reuse Conditions`;
        if (s.hml && !s.humanJob.trim()) return `${n}: กรุณากรอก Human Job`;
      }
    }
    return '';
  }

  async function runCheck() {
    const err = validate();
    if (err) { setValidationMsg(err); return; }
    setValidationMsg('');

    const draft = {
      agentName: form.agentName.trim(),
      description: form.description.trim(),
      coreAbility: [...form.coreAbility],
      input: form.input.trim(),
      output: form.output.trim(),
      businessValue: form.businessValue.trim(),
    };
    // Skills run through the shared registry (same layer the chat agent will
    // call as tools). ctx carries the library + SDLC catalog.
    const ctx = { library: approvedAgents, processes };
    // Top-15 nearest by raw rule score, NO threshold — so the AI always has
    // material even when surface-token similarity is low.
    const top = runSkill('search_library', { draft, limit: 15 }, ctx);
    // Deterministic directional connection scoring ("ต่อกับตัวนี้ได้").
    const connDraft = {
      agentName: draft.agentName,
      input: draft.input,
      output: draft.output,
      tool: form.tool.trim(),
      owner: form.owner.trim(),
      sdlcProcessMapping: [...form.sdlcProcessMapping],
    };
    const conns = runSkill('connection_suggest', { draft: connDraft, limit: 6 }, ctx);
    setRanked(top);
    setConnections(conns);
    setAiResult(null);
    setTab('analysis');

    const candidates = top.map((m) => ({
      agentName: m.existing.agentName,
      description: m.existing.description || '',
      coreAbility: m.existing.coreAbility,
      useCase: m.existing.useCase || '',
      // Reusability of the EXISTING item is a first-class signal for the AI:
      // a freely "Reusable" match is a strong "just use it" duplicate; a
      // "Non-reusable"/"Reusable with Conditions" match may leave room for a
      // new build precisely because the existing one can't be adopted as-is.
      reusable: m.existing.reusable || '',
      reuseCondition: m.existing.reuseCondition || '',
      ruleConfidence: Math.round(m.confidence),
    }));
    const connectionCandidates = conns.map((c) => ({
      agentName: c.target,
      direction: c.direction,
      type: c.type,
      // So the AI won't suggest a "Non-reusable" item as a shared sub-skill.
      reusable: agentByName(c.target)?.reusable || '',
      ruleConfidence: Math.round(c.confidence),
      reason: c.reason,
    }));
    const payload = {
      draft: {
        name: draft.agentName,
        type: form.type,
        scope: form.scope,
        description: draft.description,
        ability: draft.coreAbility,
        input: draft.input,
        output: draft.output,
        businessValue: draft.businessValue,
        reusable: form.reusable,
        reuseCondition: form.reusable === 'Reusable with Conditions' ? form.reuseCondition.trim() : '',
      },
      candidates,
      connectionCandidates,
    };

    // Cache key = the exact payload. Same draft (→ same candidates/connections)
    // ⇒ same key ⇒ reuse the stored result instead of re-calling the LLM.
    const cacheKey = JSON.stringify(payload);
    const cached = analysisCacheRef.current.get(cacheKey);
    if (cached) {
      setAiResult(cached);
      return;
    }

    setAnalyzing(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'analyzeDuplicate');
      const { data } = await fn(payload);
      analysisCacheRef.current.set(cacheKey, data);
      setAiResult(data);
    } catch (e) {
      setAiResult({ error: e.message || 'AI analysis unavailable' });
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError('');
    try {
      const { aiAgent, skillMd } = typeToFlags(form.type);
      const isExternal = form.scope === 'External';
      const agentName = form.agentName.trim();
      const creator = user?.displayName || user?.email || '';
      const createdBy = user?.uid || '';
      // Submitter's own email is always included, deduped against whoever
      // else was picked in the Creator/Team member field (case-insensitive —
      // Google emails aren't case-sensitive in practice).
      const creatorEmails = [
        ...new Map(
          [...form.creatorPicks.map((p) => p.email), user?.email || '']
            .filter(Boolean)
            .map((e) => [e.toLowerCase(), e])
        ).values(),
      ];

      // Fields the paired sub-skills inherit verbatim from the parent Agent.
      const inheritedFromAgent = {
        owner: form.owner.trim(),
        tool: form.tool.trim(),
        llm: form.llm.trim(),
        dataPrivacy: form.dataPrivacy.trim(),
        businessValue: form.businessValue.trim(),
      };

      const agentRef = await addDoc(collection(db, 'agents'), {
        agentName,
        description: form.description.trim(),
        aiAgent,
        skillMd,
        owner: inheritedFromAgent.owner,
        coreAbility: [...form.coreAbility],
        relatedRole: [...form.relatedRole],
        customerFacing: isExternal,
        internalUse: !isExternal,
        reusable: form.reusable,
        reuseCondition: form.reusable === 'Reusable with Conditions' ? form.reuseCondition.trim() : '',
        hml: form.hml,
        humanJob: form.hml ? form.humanJob.trim() : '',
        tool: inheritedFromAgent.tool,
        llm: inheritedFromAgent.llm,
        dataPrivacy: inheritedFromAgent.dataPrivacy,
        sdlcStage: isExternal ? [] : [...form.sdlcStage],
        sdlcProcessMapping: isExternal ? [] : [...form.sdlcProcessMapping],
        useCase: isExternal ? '' : form.useCase.trim(),
        input: form.input.trim(),
        output: form.output.trim(),
        businessValue: inheritedFromAgent.businessValue,
        matchingAgent: aiResult?.suggested_matching_agent || '',
        // Snapshot of the duplicate-check result at submit time, so the
        // Pending Approval queue can show reviewers the same risk signal
        // without re-running the check.
        analysisResult: aiResult && !aiResult.error
          ? {
              overallRisk: aiResult.overall_risk || 'low',
              summary: aiResult.summary || '',
              maxConfidence: maxAiConfidence,
              // Approver-routing flags (7th grill-me): surface the overlap breadth
              // signal in the pending queue so a human can gate what the AI only warns on.
              overlapAgents: aiStats?.overlapAgents ?? 0,
              breadthFlag,
            }
          : null,
        developmentPhase: 'Not Start',
        devProgress: 0,
        deploymentStatus: 'none',
        launchDate: null,
        approvalStatus: 'pending',
        approvedBy: '',
        creator,
        creatorEmails,
        createdBy,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // ── Knowledge base: persist the FULL analysis, but only at submit time
      // (never for an un-submitted draft), and skip if a near-identical draft
      // was already recorded (rule-based similarity ≥ KB_DEDUP_THRESHOLD) so we
      // don't pile up redundant entries. Best-effort: a KB failure must not
      // block the submission itself. Doc id = the agent's id (1:1), so the
      // approve/reject step can attach the human outcome later.
      if (aiResult && !aiResult.error) {
        try {
          const kbDraft = {
            agentName, description: form.description.trim(), coreAbility: [...form.coreAbility],
            input: form.input.trim(), output: form.output.trim(), businessValue: inheritedFromAgent.businessValue,
          };
          const existing = await getDocs(collection(db, 'analysisRuns'));
          const isDup = existing.docs.some((d) => {
            const prev = d.data()?.draft;
            return prev && scoreDraftAgainst(kbDraft, prev).confidence >= KB_DEDUP_THRESHOLD;
          });
          if (!isDup) {
            await setDoc(doc(db, 'analysisRuns', agentRef.id), {
              agentId: agentRef.id,
              agentName,
              draft: kbDraft,
              result: {
                overall_risk: aiResult.overall_risk || 'low',
                summary: aiResult.summary || '',
                candidates: aiResult.candidates || [],
                integration_suggestions: aiResult.integration_suggestions || [],
                suggested_matching_agent: aiResult.suggested_matching_agent || null,
                suggested_ability: aiResult.suggested_ability || null,
              },
              outcome: 'pending',   // ← becomes approved/rejected when a reviewer acts
              createdBy,
              createdAt: serverTimestamp(),
            });
          }
        } catch { /* KB is groundwork, never fatal to the submission */ }
      }

      // Agent+Skill → each paired skill becomes its OWN pending Skill doc,
      // linked back to the parent Agent via matchingAgent. Skills carry their
      // own scope/ability/role/input/output/reusable/HML; everything else is
      // inherited from the Agent above. They are NOT individually dup-checked
      // (analysisResult null) — only the parent Agent was analyzed.
      if (form.type === 'Agent+Skill') {
        for (const s of form.skills) {
          const sExternal = s.scope === 'External';
          await addDoc(collection(db, 'agents'), {
            agentName: s.name.trim(),
            description: s.description.trim(),
            aiAgent: false,
            skillMd: true,
            owner: inheritedFromAgent.owner,
            coreAbility: [...s.ability],
            relatedRole: [...s.relatedRole],
            customerFacing: sExternal,
            internalUse: !sExternal,
            reusable: s.reusable,
            reuseCondition: s.reusable === 'Reusable with Conditions' ? s.reuseCondition.trim() : '',
            hml: s.hml,
            humanJob: s.hml ? s.humanJob.trim() : '',
            tool: inheritedFromAgent.tool,
            llm: inheritedFromAgent.llm,
            dataPrivacy: inheritedFromAgent.dataPrivacy,
            // SDLC context inherited from the Agent (blanked when the skill
            // itself is customer-facing, mirroring the Agent rule).
            sdlcStage: sExternal ? [] : [...form.sdlcStage],
            sdlcProcessMapping: sExternal ? [] : [...form.sdlcProcessMapping],
            useCase: sExternal ? '' : form.useCase.trim(),
            input: s.input.trim(),
            output: s.output.trim(),
            businessValue: inheritedFromAgent.businessValue,
            matchingAgent: agentName,   // ← link to parent Agent
            analysisResult: null,
            developmentPhase: 'Not Start',
            devProgress: 0,
            deploymentStatus: 'none',
            launchDate: null,
            approvalStatus: 'pending',
            approvedBy: '',
            creator,
            creatorEmails,
            createdBy,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }

      // Analysis is now committed to the KB — drop the transient session cache
      // so nothing lingers post-submit (per the "clear cache after submit" rule).
      analysisCacheRef.current.clear();

      onSubmitted?.();
      onClose();
    } catch (e) {
      setSubmitError(e.message || 'เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setSubmitting(false);
    }
  }

  const internalShown = form.scope === 'Internal';
  const aiCandidates = aiResult && !aiResult.error ? (aiResult.candidates || []) : null;
  // Fallback list when AI is unavailable: rule-based matches >= medium risk.
  const fallbackMatches = (ranked || []).filter((m) => m.confidence >= 40);
  const analysisCount = aiCandidates ? aiCandidates.length : fallbackMatches.length;
  const ruleScoreFor = (name) => {
    const hit = (ranked || []).find((m) => m.existing.agentName === name);
    return hit ? Math.round(hit.confidence) : null;
  };
  const agentByName = (name) => approvedAgents.find((a) => a.agentName === name) || null;
  const reusableFor = (name) => agentByName(name)?.reusable || '';
  const REUSE_COLOR = { Reusable: '#137333', 'Reusable with Conditions': '#b06000', 'Non-reusable': '#c5221f' };

  // Aggregate stats over the AI's own confidences — so the overall verdict is
  // legible ("where does the 85% come from?") instead of a lone scary number.
  const aiStats = (() => {
    if (!aiCandidates?.length) return null;
    const confs = aiCandidates.map((c) => c.confidence);
    const max = Math.max(...confs);
    const avg = Math.round(confs.reduce((s, v) => s + v, 0) / confs.length);
    const top = aiCandidates.find((c) => c.confidence === max) || null;
    const dupCount = aiCandidates.filter((c) => c.verdict === 'clear_duplicate').length;
    const overlapCount = aiCandidates.filter((c) => c.verdict === 'likely_overlap').length;
    // Breadth: how many existing agents this draft overlaps at all (partial or
    // full). Deterministic backstop to the prompt's own breadth rule (2c).
    const overlapAgents = aiCandidates.filter(
      (c) => c.verdict === 'clear_duplicate' || c.verdict === 'likely_overlap'
    ).length;
    return { count: aiCandidates.length, max, avg, top, dupCount, overlapCount, overlapAgents };
  })();

  // Only a genuine near-duplicate hard-blocks. Everything else warns + routes to
  // the approver (see HARD_BLOCK above).
  const blockingCandidate = (aiCandidates || []).find((c) => {
    const t = HARD_BLOCK[c.verdict];
    return t != null && c.confidence >= t;
  }) || null;
  const blockedByHardLimit = !!blockingCandidate;
  const maxAiConfidence = aiStats?.max ?? 0;
  // "Kitchen-sink" breadth flag — deterministic, doesn't depend on the AI
  // getting overall_risk right. Warns and is stamped on the stored analysis so
  // the approver sees it in the pending queue.
  const breadthFlag = (aiStats?.overlapAgents ?? 0) >= BREADTH_OVERLAP_COUNT;

  // Closing the modal abandons whatever draft/analysis was in progress —
  // drop the session cache here too, not just after a real submit.
  function handleClose() {
    analysisCacheRef.current.clear();
    onClose();
  }

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && handleClose()}>
      <div className="mbox wide" style={{ padding: 0 }}>
        <button className="mclose" onClick={handleClose} style={{ zIndex: 1 }}>✕</button>

        <div className="tabs">
          <button className={`tab-btn ${tab === 'form' ? 'active' : ''}`} onClick={() => setTab('form')}>
            New Entry
          </button>
          <button
            className={`tab-btn ${tab === 'analysis' ? 'active' : ''} ${ranked === null ? 'locked' : ''}`}
            onClick={() => ranked !== null && setTab('analysis')}
          >
            Analysis {ranked !== null ? `(${analysisCount})` : ''}
          </button>
        </div>

        {tab === 'form' && (
          <div className="tab-panel">
            <h2 style={{ fontSize: 16, marginBottom: 14 }}>New Agent / Skill</h2>

            {validationMsg && (
              <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{validationMsg}</div>
            )}

            <div className="fg">
              <label>Agent / Skill Name <span className="req">*</span></label>
              <input value={form.agentName} onChange={(e) => setField('agentName', e.target.value)} placeholder="เช่น Epic Writer v2" />
            </div>

            <div className="grid2">
              <div className="fg">
                <label>Type <span className="req">*</span></label>
                <div className="radio-row">
                  {['Agent', 'Skill', 'Agent+Skill'].map((t) => (
                    <label key={t}>
                      <input
                        type="radio"
                        name="type"
                        value={t}
                        checked={form.type === t}
                        onChange={() => setForm((f) => ({
                          ...f,
                          type: t,
                          // Default the first skill row in immediately — it's
                          // the only one that can't be deleted, so it should
                          // always exist the moment the type is selected.
                          skills: t === 'Agent+Skill' && f.skills.length === 0 ? [emptySkill()] : f.skills,
                        }))}
                      />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
              <div className="fg">
                <label>Scope <span className="req">*</span></label>
                <div className="radio-row">
                  {[['Internal', 'Internal Use'], ['External', 'Customer Facing']].map(([v, lbl]) => (
                    <label key={v}>
                      <input type="radio" name="scope" value={v} checked={form.scope === v} onChange={() => setField('scope', v)} />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="fg">
              <label>Description <span className="req">*</span></label>
              <textarea rows={3} value={form.description} onChange={(e) => setField('description', e.target.value)} placeholder="อธิบายว่า Agent/Skill นี้ทำอะไร" />
            </div>

            <div className="grid2">
              <div className="fg">
                <label>Core Ability <span className="req">*</span></label>
                <MultiSelect label="เลือก Core Ability…" options={abilityOptions} selected={form.coreAbility} onChange={(s) => setField('coreAbility', s)} />
              </div>
              <div className="fg">
                <label>Related Role <span className="req">*</span></label>
                <MultiSelect label="เลือก Related Role…" options={roleOptions} selected={form.relatedRole} onChange={(s) => setField('relatedRole', s)} />
              </div>
            </div>

            <div className="grid2">
              <div className="fg">
                <label>Input <span className="req">*</span></label>
                <textarea rows={2} value={form.input} onChange={(e) => setField('input', e.target.value)} placeholder="ข้อมูลที่ Agent/Skill รับ" />
              </div>
              <div className="fg">
                <label>Output <span className="req">*</span></label>
                <textarea rows={2} value={form.output} onChange={(e) => setField('output', e.target.value)} placeholder="ผลลัพธ์ที่สร้าง" />
              </div>
            </div>

            <div className="fg">
              <label>Business Value <span className="req">*</span></label>
              <textarea rows={2} value={form.businessValue} onChange={(e) => setField('businessValue', e.target.value)} placeholder="คุณค่าทางธุรกิจ" />
            </div>

            {/* Owner + Creator/Team member — half width each */}
            <div className="grid2">
              <div className="fg">
                <label>Owner <span className="req">*</span> <span className="hint">(ทีม/แผนก)</span></label>
                <ComboInput value={form.owner} onChange={(v) => setField('owner', v)} options={ownerOptions} placeholder="เช่น Wolfy" />
              </div>
              <div className="fg">
                <label>Creator / Team member <span className="hint">(รายชื่อสมาชิกในทีม / ชื่อ Key contact หลัก)</span></label>
                <CreatorPicker
                  selected={form.creatorPicks}
                  onChange={(v) => setField('creatorPicks', v)}
                  placeholder="พิมพ์ชื่อหรืออีเมล…"
                />
              </div>
            </div>

            {/* Reusable group */}
            <div className="grid2">
              <div className="fg">
                <label>Reusable <span className="req">*</span></label>
                <select value={form.reusable} onChange={(e) => setField('reusable', e.target.value)}>
                  <option value="">— เลือก —</option>
                  {REUSABLE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              {form.reusable === 'Reusable with Conditions' && (
                <div className="fg">
                  <label>Reuse Conditions <span className="req">*</span></label>
                  <input value={form.reuseCondition} onChange={(e) => setField('reuseCondition', e.target.value)} placeholder="เงื่อนไขในการนำกลับมาใช้" />
                </div>
              )}
            </div>

            {/* HML group — Human Job stacked directly under the toggle */}
            <div className="fg">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <input type="checkbox" checked={form.hml} onChange={(e) => setField('hml', e.target.checked)} />
                HML (Human-in-the-Loop)
              </label>
            </div>
            {form.hml && (
              <div className="fg">
                <label>Human Job <span className="req">*</span></label>
                <input value={form.humanJob} onChange={(e) => setField('humanJob', e.target.value)} placeholder="หน้าที่ของ Human ใน loop" />
              </div>
            )}

            {/* SDLC group (Internal only) */}
            {internalShown && (
              <>
                <div className="grid2">
                  <div className="fg">
                    <label>SDLC Stage</label>
                    <MultiSelect label="เลือก SDLC Stage…" options={stageOptions} selected={form.sdlcStage} onChange={(s) => setField('sdlcStage', s)} />
                  </div>
                  <div className="fg">
                    <label>SDLC Process Mapping</label>
                    {form.sdlcStage.size === 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--mu)', padding: '8px 0' }}>เลือก SDLC Stage ก่อน เพื่อดูรายการ Process ที่ผูกกับ Stage นั้น</div>
                    ) : (
                      <MultiSelect label="เลือก Process…" options={processOptions} selected={form.sdlcProcessMapping} onChange={(s) => setField('sdlcProcessMapping', s)} />
                    )}
                  </div>
                </div>
                <div className="fg">
                  <label>Use Case</label>
                  <select value={form.useCase} onChange={(e) => setField('useCase', e.target.value)}>
                    <option value="">— เลือก Use Case —</option>
                    {useCaseOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </>
            )}

            {/* Tech */}
            <div className="grid2">
              <div className="fg">
                <label>Tool</label>
                <input value={form.tool} onChange={(e) => setField('tool', e.target.value)} placeholder="เช่น JIRA API, n8n" />
              </div>
              <div className="fg">
                <label>LLM</label>
                <input value={form.llm} onChange={(e) => setField('llm', e.target.value)} placeholder="เช่น Gemini 3 Flash" />
              </div>
            </div>

            <div className="fg">
              <label>Data Privacy</label>
              <input value={form.dataPrivacy} onChange={(e) => setField('dataPrivacy', e.target.value)} placeholder="เช่น PDPA, PII Masking" />
            </div>

            {/* ── Paired sub-skills (Agent+Skill only) ── */}
            {form.type === 'Agent+Skill' && (
              <div style={{ marginTop: 6, padding: '12px 14px', border: '1px solid var(--bd-soft)', borderRadius: 'var(--r-md)', background: 'var(--sf2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>Type: Agent+Skill — กรุณาให้รายละเอียด skill ที่ใช้ร่วมกับ Agent ดังกล่าวเพิ่มเติม</div>
                  <button type="button" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap' }} onClick={addSkill}>+ เพิ่ม Skill</button>
                </div>

                {form.skills.map((s, idx) => (
                  <div key={s._id} style={{ marginTop: 12, padding: '12px', border: '1px solid var(--bd-soft)', borderRadius: 'var(--r-md)', background: 'var(--sf)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <strong style={{ fontSize: 12.5, color: 'var(--ag)' }}>Skill #{idx + 1}</strong>
                      {idx > 0 && (
                        <button type="button" onClick={() => removeSkill(s._id)} title="ลบ Skill นี้"
                          style={{ border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', borderRadius: 6, padding: '2px 9px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                          ✕ ลบ
                        </button>
                      )}
                    </div>

                    <div className="fg">
                      <label>Skill Name <span className="req">*</span></label>
                      <input value={s.name} onChange={(e) => setSkillField(s._id, 'name', e.target.value)} placeholder="ชื่อ Skill" />
                    </div>
                    <div className="fg">
                      <label>Description <span className="req">*</span></label>
                      <textarea rows={2} value={s.description} onChange={(e) => setSkillField(s._id, 'description', e.target.value)} placeholder="Skill นี้ทำอะไร" />
                    </div>
                    <div className="fg">
                      <label>Scope <span className="req">*</span></label>
                      <div className="radio-row">
                        {[['Internal', 'Internal Use'], ['External', 'Customer Facing']].map(([v, lbl]) => (
                          <label key={v}>
                            <input type="radio" name={`scope-${s._id}`} value={v} checked={s.scope === v} onChange={() => setSkillField(s._id, 'scope', v)} />
                            {lbl}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="grid2">
                      <div className="fg">
                        <label>Core Ability <span className="req">*</span></label>
                        <MultiSelect label="เลือก Core Ability…" options={abilityOptions} selected={s.ability} onChange={(v) => setSkillField(s._id, 'ability', v)} />
                      </div>
                      <div className="fg">
                        <label>Related Role <span className="req">*</span></label>
                        <MultiSelect label="เลือก Related Role…" options={roleOptions} selected={s.relatedRole} onChange={(v) => setSkillField(s._id, 'relatedRole', v)} />
                      </div>
                    </div>
                    <div className="grid2">
                      <div className="fg">
                        <label>Input <span className="req">*</span></label>
                        <textarea rows={2} value={s.input} onChange={(e) => setSkillField(s._id, 'input', e.target.value)} placeholder="ข้อมูลที่ Skill รับ" />
                      </div>
                      <div className="fg">
                        <label>Output <span className="req">*</span></label>
                        <textarea rows={2} value={s.output} onChange={(e) => setSkillField(s._id, 'output', e.target.value)} placeholder="ผลลัพธ์ที่สร้าง" />
                      </div>
                    </div>
                    <div className="grid2">
                      <div className="fg">
                        <label>Reusable <span className="req">*</span></label>
                        <select value={s.reusable} onChange={(e) => setSkillField(s._id, 'reusable', e.target.value)}>
                          <option value="">— เลือก —</option>
                          {REUSABLE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                      {s.reusable === 'Reusable with Conditions' && (
                        <div className="fg">
                          <label>Reuse Conditions <span className="req">*</span></label>
                          <input value={s.reuseCondition} onChange={(e) => setSkillField(s._id, 'reuseCondition', e.target.value)} placeholder="เงื่อนไขในการนำกลับมาใช้" />
                        </div>
                      )}
                    </div>
                    <div className="fg">
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                        <input type="checkbox" checked={s.hml} onChange={(e) => setSkillField(s._id, 'hml', e.target.checked)} />
                        HML (Human-in-the-Loop)
                      </label>
                    </div>
                    {s.hml && (
                      <div className="fg">
                        <label>Human Job <span className="req">*</span></label>
                        <input value={s.humanJob} onChange={(e) => setSkillField(s._id, 'humanJob', e.target.value)} placeholder="หน้าที่ของ Human ใน loop" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="btn-group">
              <button className="btn btn-primary" onClick={runCheck}>Submit</button>
              <button className="btn btn-secondary" onClick={() => { setForm(EMPTY_FORM); analysisCacheRef.current.clear(); }}>Clear</button>
            </div>
          </div>
        )}

        {tab === 'analysis' && ranked !== null && (
          <div className="tab-panel">
            {submitError && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{submitError}</div>}

            {analyzing && (
              <div className="msg info"><span className="spin" style={{ width: 14, height: 14, borderWidth: 2 }} />AI กำลังวิเคราะห์ความคล้ายเชิงความหมาย…</div>
            )}

            {aiResult && !aiResult.error && (
              <>
                <div className={`msg ${aiResult.overall_risk === 'high' ? 'error' : aiResult.overall_risk === 'medium' ? 'warn' : 'success'}`}
                     style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                  <div>ระดับความเสี่ยงโดยรวม: <strong style={{ textTransform: 'uppercase' }}>{aiResult.overall_risk}</strong></div>
                  {aiResult.summary && <div style={{ fontSize: 12 }}>{aiResult.summary}</div>}
                  {aiStats && (
                    <div style={{ fontSize: 11.5, color: 'var(--tx2)', display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 2 }}>
                      <span>วิเคราะห์ <strong>{aiStats.count}</strong> รายการ</span>
                      <span>สูงสุด <strong>{aiStats.max}%</strong>{aiStats.top ? ` (${aiStats.top.agentName})` : ''}</span>
                      <span>เฉลี่ย <strong>{aiStats.avg}%</strong></span>
                      {aiStats.dupCount > 0 && <span style={{ color: '#c5221f' }}>ซ้ำชัด {aiStats.dupCount}</span>}
                      {aiStats.overlapCount > 0 && <span style={{ color: '#c96a00' }}>ทับซ้อนบางส่วน {aiStats.overlapCount}</span>}
                    </div>
                  )}
                </div>

                {blockedByHardLimit && blockingCandidate && (
                  <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />
                    ไม่สามารถ Submit ได้ — <strong>{blockingCandidate.agentName}</strong> ซ้ำซ้อนถึง {blockingCandidate.confidence}%
                    {blockingCandidate.verdict === 'clear_duplicate' ? ' (AI ตัดสินว่าเป็นตัวเดียวกัน)' : ' (เกือบเหมือนกันทั้งหมด)'} — กรุณาปรับ idea ให้แตกต่าง หรือพิจารณาใช้ของเดิมแทน
                  </div>
                )}

                {/* Breadth warning (7th grill-me): submit is still allowed, but the
                    kitchen-sink pattern is flagged and routed to the approver. */}
                {!blockedByHardLimit && breadthFlag && (
                  <div className="msg warn"><span className="dot" style={{ background: '#fbbc04' }} />
                    ไอเดียนี้ทำงานทับกับ Agent เดิม <strong>{aiStats.overlapAgents} ตัว</strong> —
                    เข้าข่าย "ตัวเหมารวม" ที่ขัดกับหลัก Agent เฉพาะทาง แนะนำให้แยกเป็น skill เฉพาะทาง
                    หรือใช้/เชื่อมต่อของเดิมแทน — submit ได้ แต่จะถูกส่งให้ผู้อนุมัติพิจารณาเป็นพิเศษ
                  </div>
                )}

                {aiResult.integration_suggestions?.length > 0 && (
                  <div className="msg info" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 5 }}>
                    <strong>ข้อเสนอการเชื่อมต่อ/ทำงานร่วมกับของเดิม:</strong>
                    {aiResult.integration_suggestions.map((s, i) => (
                      <div key={i} style={{ fontSize: 12 }}>• <strong>{s.agentName}</strong> — {s.how}</div>
                    ))}
                  </div>
                )}

                {(() => {
                  // Only surface suggested_ability when it's actually DIFFERENT
                  // from what the user already picked in the form — if the AI
                  // just confirms the existing choice, showing it is noise.
                  const abilityDiffers = aiResult.suggested_ability && !form.coreAbility.has(aiResult.suggested_ability);
                  const showBlock = aiResult.suggested_matching_agent || abilityDiffers;
                  if (!showBlock) return null;
                  return (
                    <div className="msg info" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                      {aiResult.suggested_matching_agent && <div>ควรผูกเป็น Skill/Agent คู่กับ: <strong>{aiResult.suggested_matching_agent}</strong></div>}
                      {abilityDiffers && <div>แนะนำ Core Ability: <strong>{aiResult.suggested_ability}</strong></div>}
                    </div>
                  );
                })()}
              </>
            )}

            {aiResult?.error && (
              <div className="msg warn"><span className="dot" style={{ background: '#fbbc04' }} />AI ไม่พร้อมใช้งานชั่วคราว ({aiResult.error}) — แสดงผล rule-based ด้านล่างแทน</div>
            )}

            {/* ── Rule-based directional connections ("ต่อกับตัวนี้ได้") ── */}
            {connections.length > 0 && (
              <>
                <div className="sec-title" style={{ marginTop: 4 }}>ต่อกับตัวนี้ได้ (rule-based)</div>
                <div style={{ fontSize: 11, color: 'var(--mu)', marginBottom: 6 }}>Agent/Skill ที่อาจส่งข้อมูลต่อ, trigger กัน, หรือใช้ context ร่วมกับไอเดียนี้</div>
                {connections.map((c, i) => {
                  const tColor = { 'Data Handoff': '#2f6bff', Trigger: '#b45309', 'Shared Context/Tool': '#0b7a68' }[c.type] || '#7a85a3';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 11px', background: 'var(--sf2)', border: 'none', borderRadius: 'var(--r-sm)', marginBottom: 5 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: tColor, fontFamily: "'IBM Plex Mono',monospace", minWidth: 40 }}>{c.confidence.toFixed(0)}%</span>
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: tColor, background: `${tColor}15`, border: `1px solid ${tColor}40`, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>{c.type}</span>
                      <span style={{ fontWeight: 600, flex: 1, fontSize: 12 }}>
                        {c.direction === 'draft→existing' ? '(ไอเดียนี้) → ' : ''}
                        <span
                          role="button"
                          tabIndex={0}
                          style={{ cursor: agentByName(c.target) ? 'pointer' : 'default', textDecoration: agentByName(c.target) ? 'underline' : 'none', textDecorationStyle: 'dotted' }}
                          onClick={() => agentByName(c.target) && setDetailAgent(agentByName(c.target))}
                        >
                          {c.target}
                        </span>
                        {c.direction === 'existing→draft' ? ' → (ไอเดียนี้)' : ''}
                        {c.dataIncomplete && <span title="Input/Output ไม่ครบ" style={{ color: "var(--warn)" }}> (ข้อมูลไม่ครบ)</span>}
                      </span>
                      <span style={{ fontSize: 10.5, color: 'var(--mu)' }}>{c.reason}</span>
                    </div>
                  );
                })}
              </>
            )}

            {/* ── Candidate list ── */}
            {aiCandidates && <div className="sec-title" style={{ marginTop: 10 }}>ความซ้ำซ้อนที่ตรวจพบ</div>}
            {aiCandidates ? (
              aiCandidates.length === 0 ? (
                <div className="msg success"><span className="dot" style={{ background: '#34a853' }} />AI ไม่พบ Agent/Skill ที่ทับซ้อนอย่างมีนัยสำคัญ — ปลอดภัยที่จะลงทะเบียนใหม่</div>
              ) : (
                aiCandidates.map((c, i) => {
                  const rs = ruleScoreFor(c.agentName);
                  const vColor = c.verdict === 'clear_duplicate' ? '#c5221f'
                    : c.verdict === 'likely_overlap' ? '#c96a00'
                    : c.verdict === 'distinct_but_related' ? '#2f6bff' : '#137333';
                  return (
                    <div className="dup-row" key={i} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div className="dup-score" style={{ color: vColor }}>{c.confidence}%</div>
                        <div style={{ flex: 1 }}>
                          <div
                            className="dup-name"
                            role="button"
                            tabIndex={0}
                            style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', width: 'fit-content' }}
                            onClick={() => agentByName(c.agentName) && setDetailAgent(agentByName(c.agentName))}
                          >
                            {c.agentName}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--mu)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span>rule-based: {rs != null ? `${rs}%` : '—'}</span>
                            {reusableFor(c.agentName) && (
                              <span style={{ fontSize: 9.5, fontWeight: 700, color: REUSE_COLOR[reusableFor(c.agentName)] || 'var(--mu)', background: `${REUSE_COLOR[reusableFor(c.agentName)] || '#7a85a3'}15`, border: `1px solid ${REUSE_COLOR[reusableFor(c.agentName)] || '#7a85a3'}40`, padding: '1px 5px', borderRadius: 4 }}>
                                {reusableFor(c.agentName)}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="risk-badge" style={{ color: vColor, background: `${vColor}15` }}>{VERDICT_LABEL[c.verdict] || c.verdict}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--tx2)', lineHeight: 1.5 }}>{c.reason}</div>
                    </div>
                  );
                })
              )
            ) : (
              // AI unavailable → deterministic fallback
              fallbackMatches.length === 0 ? (
                <div className="msg success"><span className="dot" style={{ background: '#34a853' }} />rule-based ไม่พบรายการที่คล้ายเกินเกณฑ์</div>
              ) : (
                fallbackMatches.map((m, i) => {
                  const rd = RISK_DEF[riskLevel(m.confidence)];
                  return (
                    <div className="dup-row" key={i}>
                      <div className="dup-score" style={{ color: rd.color }}>{m.confidence.toFixed(0)}%</div>
                      <div style={{ flex: 1 }}>
                        <div
                          className="dup-name"
                          role="button"
                          tabIndex={0}
                          style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', width: 'fit-content' }}
                          onClick={() => setDetailAgent(m.existing)}
                        >
                          {m.existing.agentName}
                        </div>
                        <div className="dup-owner">{m.existing.owner || '—'}</div>
                      </div>
                      <span className="risk-badge" style={{ color: rd.color, background: rd.bg }}>{rd.label}</span>
                    </div>
                  );
                })
              )
            )}

            <div className="btn-group">
              <button className="btn btn-secondary" onClick={() => setTab('form')}>← Back to Form</button>
              <button
                className="btn btn-success"
                onClick={handleSubmit}
                disabled={submitting || analyzing || blockedByHardLimit}
                title={blockedByHardLimit && blockingCandidate ? `บล็อก: ซ้ำกับ ${blockingCandidate.agentName} ${blockingCandidate.confidence}%` : undefined}
              >
                {submitting ? 'กำลังบันทึก…' : blockedByHardLimit ? 'ถูกบล็อกเนื่องจากความซ้ำซ้อนสูง' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        )}
      </div>

      {detailAgent && (
        <AgentDetailModal
          agent={detailAgent}
          allAgents={approvedAgents}
          onClose={() => setDetailAgent(null)}
          user={user}
          isAdmin={false}
        />
      )}
    </div>
  );
}
