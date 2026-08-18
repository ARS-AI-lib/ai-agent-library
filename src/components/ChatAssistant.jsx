import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../lib/firebase';
import { runSkill, resolveAgentByName, readinessOf } from '../lib/skills';
import { recordAgentEvent, recordSearchHits } from '../lib/agentEvents';
import { handleEndpointClick } from '../lib/endpointFiles';
import { isBlockedInput, BLOCKED_REPLY } from '../lib/chatGuardrails';
import { getType, getTier } from '../lib/tier';
import { ST_DEF } from '../lib/status';
import { safeEndpointUrl } from '../lib/agentUtils';
import '../styles/ChatAssistant.css';

// Tools whose result is composed into a Thai answer LOCALLY (no further
// Vertex call) — the "2a" deterministic path. capability_search is the lone
// "2b" tool: its result is sent back to the model for semantic ranking +
// conversational composition (see chatLibrary's system prompt).
const TEMPLATE_TOOLS = new Set(['query_library', 'query_sdlc', 'get_agent_detail', 'connection_suggest']);

const MAX_LOOP = 3;
const HISTORY_WINDOW = 6;
// Max characters of a PREVIOUS assistant answer replayed as history — see the
// comment where historyForCall is built.
const HISTORY_ANSWER_MAX = 700;
const CHAT_W_KEY = 'chatWidth';
const CHAT_W_MIN = 340;
const CHAT_W_MAX = 640;

// Shares the fuzzy resolver used by get_agent_detail — an exact match here
// used to fail on nothing more than different spacing around a hyphen
// ("Nok-Suggest" vs the real "Nok - Suggest"), which surfaced to the user as
// "not found" for an entry that exists.
function findAgentByName(library, name) {
  return resolveAgentByName(library, name).match;
}

// Runs a tool call against the client-side skill registry. Handles the one
// shape mismatch between the chat-facing tool declarations (functions/index.js)
// and the raw skills.js signatures: connection_suggest here takes just an
// existing agentName, so we resolve the real agent record and feed it in as
// the "draft" (findConnectionSuggestions already excludes a draft's own name
// from its own results, so this is safe).
async function runTool(name, args, ctx) {
  if (name === 'connection_suggest') {
    const agent = findAgentByName(ctx.library, args.agentName);
    if (!agent) return { notFound: true, agentName: args.agentName };
    return { suggestions: runSkill('connection_suggest', { draft: agent, limit: 6 }, ctx) };
  }
  // capability_search is the one tool that needs a network round-trip before
  // it can run: the browser holds the library vectors but has no Vertex
  // credentials, so the QUERY has to be embedded server-side. Doing it here
  // (rather than inside the skill) keeps every skill in skills.js a pure,
  // synchronous function over its context.
  //
  // A failure here is non-fatal on purpose — the skill still has its lexical
  // arm, so a flaky embed call degrades search quality instead of breaking chat.
  // query_library only needs it when a free-text keyword is in play; its
  // structured filters are exact values and never go near the vector index.
  const needsVector = name === 'capability_search'
    ? (args.query || '')
    : (name === 'query_library' ? (args.keyword || '') : '');

  if (needsVector && ctx.vectors?.size) {
    try {
      const embed = httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'embedQuery');
      const { data } = await embed({ text: needsVector });
      return noteSearchHits(name, runSkill(name, args, { ...ctx, queryVector: data?.v || null }), ctx);
    } catch (e) {
      console.warn('embedQuery failed, falling back to keyword-only search:', e?.message || e);
    }
  }
  return noteSearchHits(name, runSkill(name, args, ctx), ctx);
}

// Usage telemetry for "the catalogue offered this up" (2026-08-18). Only
// capability_search counts: it is the recommender, its result set is already
// capped, and the model asking for it means a human asked a capability
// question. query_library is a structured filter ("how many T2 are there") —
// counting its rows would inflate every agent that matches a broad filter.
//
// The payload sent to the model deliberately carries agentName but no id, and
// this resolves names locally rather than adding an id the LLM has no use for
// (extra tokens, zero value to it). Pass-through return so call sites are
// unchanged; never allowed to throw.
function noteSearchHits(name, result, ctx) {
  if (name !== 'capability_search') return result;
  try {
    const rows = Array.isArray(result) ? result : (result?.agents || []);
    const byName = new Map((ctx.library || []).map((a) => [a.agentName, a.id]));
    recordSearchHits(rows.map((r) => byName.get(r.agentName)).filter(Boolean));
  } catch (e) {
    console.warn('recordSearchHits skipped:', e?.message || e);
  }
  return result;
}

// Renders every row of a previous query_library answer's full CSV set as
// cards — the "show all" expansion. Capped: a wall of 60+ cards stops being a
// readable answer and just becomes a worse CSV, so past EXPAND_CAP this hands
// back to the file instead of trying to out-scroll it.
const EXPAND_CAP = 30;
function expandCsvAnswer(rows) {
  if (rows.length > EXPAND_CAP) {
    return {
      text: `มีทั้งหมด ${rows.length} รายการ ซึ่งเยอะเกินกว่าจะแสดงในแชทได้อ่านง่าย ครับ — ดาวน์โหลด CSV ด้านล่างเพื่อดูทั้งหมดได้เลยครับ`,
      csv: rows,
    };
  }
  const lines = rows.map((a) => `@@ ${a.agentName} | ${[a.tier, a.owner || 'ไม่ระบุ owner'].join(' · ')}`).join('\n');
  return { text: `**ทั้งหมด ${rows.length} รายการ**\n${lines}`, csv: rows };
}

// ── Local (no-LLM) Thai templates for the deterministic tools ──────────
function templateAnswer(name, args, result) {
  if (name === 'query_library') {
    if (result.mode === 'group') {
      const entries = Object.entries(result.counts).sort((a, b) => b[1] - a[1]);
      if (entries.length === 0) return { text: 'ไม่พบข้อมูลตามเงื่อนไขที่ถามครับ', csv: null };
      const lines = entries.map(([k, v]) => `- ${k}: ${v} รายการ`).join('\n');
      return { text: `**พบทั้งหมด ${result.total} รายการ** แบ่งตาม ${result.groupBy}:\n${lines}`, csv: null };
    }
    if (result.total === 0) return { text: 'ไม่พบ Agent/Skill ที่ตรงกับเงื่อนไขนี้ครับ', csv: null };
    // Emits the same "@@ name | reason" protocol the model uses, so a filter
    // answer renders through the identical card path — status pill, endpoint
    // icon, readiness grouping and all. Before this, template-backed answers
    // looked visibly different from model-composed ones, which is exactly the
    // inconsistency this design was meant to eliminate.
    //
    // Capped at 8 cards regardless of `limit`: a filter can legitimately match
    // 200+ entries, and a 200-card wall is not an answer. The remainder is
    // stated as a number, with CSV still offered for the full set.
    const shown = result.agents.slice(0, 8);
    const lines = shown.map((a) => `@@ ${a.agentName} | ${[a.tier, a.owner || 'ไม่ระบุ owner'].join(' · ')}`).join('\n');
    const more = result.total > shown.length ? `\nยังมีอีก ${result.total - shown.length} รายการ ดาวน์โหลด CSV เพื่อดูทั้งหมดได้ครับ` : '';
    return {
      text: `**พบทั้งหมด ${result.total} รายการ**\n${lines}${more}`,
      csv: result.agents,
    };
  }
  if (name === 'query_sdlc') {
    const parts = [];
    // "## title | subtitle" — the SDLC counterpart to the "@@ name | reason"
    // agent-card protocol. A process/use case has no readiness or endpoint,
    // so it gets its own lightweight card (SdlcList) rather than being forced
    // through the agent-card component, but it uses the same visual language
    // (bordered card, not a flat bullet) so an SDLC answer doesn't look like a
    // different, older part of the app next to a capability-search answer.
    if (result.processes.length) {
      parts.push(result.processes.map((p) => `## Process ${p.id}: ${p.name} | ${p.stage}${p.owner ? ` · owner: ${p.owner}` : ''}`).join('\n'));
    }
    if (result.useCases.length) {
      parts.push(result.useCases.map((u) => `## Use Case: ${u.name} | process ${u.processId}${u.owner ? ` · owner: ${u.owner}` : ''}`).join('\n'));
    }
    if (!parts.length) return { text: 'ไม่พบข้อมูล SDLC ตามที่ถามครับ', csv: null };
    return { text: parts.join('\n'), csv: null };
  }
  if (name === 'get_agent_detail') {
    if (!result) return { text: `ไม่พบ Agent/Skill ชื่อ "${args.agentName}" ในไลบรารีครับ`, csv: null };
    const type = getType(result) === 'skill' ? 'Skill' : 'Agent';
    // The card comes FIRST (it carries the name, live status and endpoint),
    // then the fields below it — which is why parseBlocks preserves source
    // order instead of hoisting all prose above the cards.
    return {
      text: `@@ ${result.agentName} | ${type} · Tier ${getTier(result)}\n${result.description || '(ไม่มีคำอธิบาย)'}\n- Owner: ${result.owner || '—'}\n- Input: ${result.input || '—'}\n- Output: ${result.output || '—'}`,
      csv: null,
    };
  }
  if (name === 'connection_suggest') {
    if (result.notFound) return { text: `ไม่พบ Agent ชื่อ "${result.agentName}" ในไลบรารีครับ`, csv: null };
    if (!result.suggestions.length) return { text: 'ไม่พบ Agent/Skill ที่ต่อกันได้อย่างมีนัยสำคัญครับ', csv: null };
    const lines = result.suggestions.map((s) => `@@ ${s.target} | ${s.type} — ${s.reason}`).join('\n');
    return { text: `**ต่อกับตัวนี้ได้**\n${lines}`, csv: null };
  }
  return { text: 'ขอโทษครับ ประมวลผลไม่สำเร็จ', csv: null };
}

// ── Rich-text rendering for chat bubbles ───────────────────────────────
// Handles two inline markups on the assistant's plain-text replies:
//   1. **bold** — the model (and our local templates) emit Markdown-style
//      double-asterisk emphasis; render it as <strong> instead of showing
//      the literal asterisks.
//   2. Agent/Skill names — any library name that appears verbatim in an
//      assistant reply becomes a clickable link that opens its detail modal.
// The linkify matcher is a single big alternation regex over all library
// names (longest-first so the longest match wins at any position); it's
// only applied to assistant messages, never the user's own text.
function linkifyAgents(text, keyBase, matcher, onOpen) {
  if (!matcher) return [text];
  matcher.lastIndex = 0;
  const parts = [];
  let last = 0;
  let idx = 0;
  let m;
  while ((m = matcher.exec(text)) !== null) {
    if (m[0].length === 0) { matcher.lastIndex++; continue; } // zero-width guard
    if (m.index > last) parts.push(text.slice(last, m.index));
    const name = m[0];
    parts.push(
      <span key={`${keyBase}-a${idx++}`} className="chat-agent-link" onClick={() => onOpen(name)}>{name}</span>
    );
    last = m.index + name.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Status pill + endpoint-link rendering (2026-08-01) — the chat prompt's
// readiness gate (see functions/index.js) makes ALPHA emit these two things
// in predictable, literal form: the exact ST_DEF label text ("Ready to Use",
// "Pilot", "In Progress", "To Do") and raw http(s) URLs. Rendering them as a
// colored pill / a link — using the SAME colors as the rest of the app
// (ST_DEF, not invented ones) — turns the plain-text reply into something
// that reads like the product it's describing, matching the presentation
// mockup the user approved.
const STATUS_LABEL_TO_KEY = { 'Ready to Use': 'ru', 'Pilot': 'pilot', 'In Progress': 'ip', 'To Do': 'td' };
const STATUS_MATCHER = /(Ready to Use|Pilot|In Progress|To Do)/g;
const URL_MATCHER = /(https?:\/\/[^\s)]+)/g;

// Generic "find all matches of `regex`, render each via `renderMatch`, leave
// the rest as plain strings" splitter — the same shape linkifyAgents already
// used inline; pulled out so status pills and endpoint links can reuse it
// without duplicating the sweep-and-splice logic three times.
function splitByRegex(text, regex, renderMatch, keyBase) {
  regex.lastIndex = 0;
  const parts = [];
  let last = 0;
  let idx = 0;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m[0].length === 0) { regex.lastIndex++; continue; }
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(renderMatch(m[0], `${keyBase}-${idx++}`));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderBoldAndLinks(seg, keyBase, matcher, onOpen) {
  const segs = seg.split('**');
  return segs.map((s, si) => {
    const inner = linkifyAgents(s, `${keyBase}-${si}`, matcher, onOpen);
    // Odd segments sit between a pair of ** → bold. A dangling ** (odd
    // count) just leaves its tail as a normal segment — graceful.
    return si % 2 === 1
      ? <strong key={si}>{inner}</strong>
      : <span key={si}>{inner}</span>;
  });
}

// URLs are split out first (their text must never be re-scanned by the later
// passes), then each remaining plain-text chunk is scanned for a status
// label, then whatever's left goes through the original bold+agent-link pass.
function processInline(text, keyBase, matcher, onOpen) {
  const afterUrls = splitByRegex(text, URL_MATCHER, (url, k) => (
    <a
      key={k}
      className="chat-endpoint-link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={`เปิดใช้งาน / ดาวน์โหลด: ${url}`}
      aria-label="เปิด endpoint ในแท็บใหม่"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
    </a>
  ), keyBase);

  return afterUrls.map((part, i) => {
    if (typeof part !== 'string') return part; // already a rendered link node
    const afterStatus = splitByRegex(part, STATUS_MATCHER, (label, k) => {
      const def = ST_DEF[STATUS_LABEL_TO_KEY[label]];
      return (
        <span key={k} className="chat-status-pill" style={{ color: def.color, background: def.bg }}>
          <span className="chat-status-dot" style={{ background: def.dot }} />{label}
        </span>
      );
    }, `${keyBase}-${i}`);

    return afterStatus.map((seg, j) => (
      typeof seg === 'string'
        ? <span key={`${keyBase}-${i}-${j}`}>{renderBoldAndLinks(seg, `${keyBase}-${i}-${j}`, matcher, onOpen)}</span>
        : seg
    ));
  });
}

// ── Recommendation lines ("@@ Name | reason") ─────────────────────────
// The model emits ONLY a name and a reason; everything else — status pill,
// tier, endpoint link, grouping — is drawn here from the library data the
// client already holds.
//
// This is deliberate. Formatting used to live in the system prompt, and a
// model cannot be relied on to format identically twice: the same question
// produced differently-shaped answers on consecutive turns, and one reply put
// four `*`-marked (pilot) entries under a "Ready to Use:" heading it invented
// on its own — the label and the marker contradicting each other. Rendering
// from data makes that class of bug structurally impossible, and means the
// status shown can never drift from the status in Firestore.
const REC_LINE = /^@@\s*(.+?)\s*\|\s*(.*)$/;
// SDLC counterpart to REC_LINE — a process/use case card. Kept as a separate
// marker (not reusing "@@") because it is resolved differently downstream:
// "@@" names are looked up against the agent library (and dropped if a name
// doesn't resolve, guarding against a hallucinated agent); "##" entries are
// plain data straight from query_sdlc's own template, never model-composed,
// so there is nothing to resolve or hallucinate-guard.
const SDLC_LINE = /^##\s*(.+?)\s*\|\s*(.*)$/;

// Blocks come back in SOURCE ORDER. An earlier version collected all prose
// into one string and rendered it before the cards, which silently reordered
// the answer: a trailing "และอีก 4 รายการ" note jumped above the list it was
// describing, and a detail answer showed its fields before the entry's own
// heading. Order is part of the meaning, so it is preserved.
function parseBlocks(text) {
  const blocks = [];
  const pushItem = (kind, item) => {
    const last = blocks[blocks.length - 1];
    if (last?.kind === kind) last.items.push(item);
    else blocks.push({ kind, items: [item] });
  };
  text.split('\n').forEach((line) => {
    const trimmed = line.trim();
    const rec = REC_LINE.exec(trimmed);
    const sdlc = !rec && SDLC_LINE.exec(trimmed);
    if (rec) {
      pushItem('recs', { name: rec[1].trim(), reason: rec[2].trim() });
    } else if (sdlc) {
      pushItem('sdlc', { title: sdlc[1].trim(), subtitle: sdlc[2].trim() });
    } else {
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'prose') last.lines.push(line);
      else blocks.push({ kind: 'prose', lines: [line] });
    }
  });
  return blocks
    .map((b) => (b.kind === 'prose' ? { ...b, text: b.lines.join('\n').trim() } : b))
    .filter((b) => (b.kind === 'prose' ? b.text : b.items.length));
}

// Process/use-case cards — same bordered-card visual language as
// RecommendationList, but deliberately simpler: no status pill (SDLC entries
// have no readiness), no endpoint link, no click-through (nothing to open).
function SdlcList({ items }) {
  return (
    <div className="chat-recs">
      <div className="chat-rec-group">
        {items.map((it, i) => (
          <div key={i} className="chat-rec">
            <div className="chat-rec-head">
              <span className="chat-sdlc-title">{it.title}</span>
            </div>
            {it.subtitle && <div className="chat-rec-reason">{it.subtitle}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

const READINESS_GROUP = [
  { key: 'ready', label: 'พร้อมใช้งาน' },
  { key: 'pilot', label: 'อยู่ในช่วงทดสอบใช้งานจริง' },
  { key: 'in_dev', label: 'ยังพัฒนาไม่เสร็จ' },
];

function RecommendationList({ recs, library, onOpen }) {
  // Resolve each name against the real library. A name that does not resolve
  // is dropped rather than shown — a hallucinated entry must never reach the
  // user wearing the same styling as a real one.
  const resolved = recs
    .map((r) => ({ ...r, agent: resolveAgentByName(library, r.name).match }))
    .filter((r) => r.agent);

  // …but "drop silently" must not become "the answer vanished". If NOTHING
  // resolved, the user would otherwise see a lone intro sentence pointing at
  // an empty space, which reads as a broken app. Show the reasons as plain
  // text instead: no pill, no link, no click target — visibly not a verified
  // library entry, while still not hiding that the model said something.
  if (!resolved.length) {
    if (!recs.length) return null;
    return (
      <div className="chat-recs">
        {recs.map((r, i) => (
          <div key={i} className="chat-rec-row">
            <span className="chat-bullet-dot" />
            <span>{r.name}{r.reason ? ` — ${r.reason}` : ''}</span>
          </div>
        ))}
        <div className="chat-rec-note">ไม่พบรายการเหล่านี้ในไลบรารี — โปรดตรวจสอบชื่ออีกครั้งครับ</div>
      </div>
    );
  }

  const groups = READINESS_GROUP
    .map((g) => ({ ...g, items: resolved.filter((r) => readinessOf(r.agent).readiness === g.key) }))
    .filter((g) => g.items.length);

  return (
    <div className="chat-recs">
      {groups.map((g) => (
        <div key={g.key} className="chat-rec-group">
          {/* Only label a group when the answer actually mixes readiness
              levels — a single-group answer needs no header. */}
          {groups.length > 1 && <div className="chat-rec-grouphdr">{g.label}</div>}
          {g.items.map((r, i) => {
            const { status, readiness, endpoint } = readinessOf(r.agent);
            const def = ST_DEF[STATUS_LABEL_TO_KEY[status]] || ST_DEF.td;
            const href = safeEndpointUrl(endpoint);
            return (
              <div key={`${g.key}-${i}`} className="chat-rec">
                <div className="chat-rec-head">
                  <span className="chat-agent-link" onClick={() => onOpen(r.agent.agentName)}>
                    {r.agent.agentName}
                  </span>
                  <span className="chat-status-pill" style={{ color: def.color, background: def.bg }}>
                    <span className="chat-status-dot" style={{ background: def.dot }} />{status}
                  </span>
                  {href && (
                    <a className="chat-endpoint-link" href={href} target="_blank" rel="noopener noreferrer"
                      title={`เปิดใช้งาน / ดาวน์โหลด: ${href}`} aria-label="เปิด endpoint ในแท็บใหม่"
                      onClick={(e) => {
                        recordAgentEvent(r.agent.id, 'endpoint');
                        handleEndpointClick(e, endpoint);
                      }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  )}
                </div>
                {r.reason && <div className="chat-rec-reason">{r.reason}</div>}
                {readiness === 'pilot' && (
                  <div className="chat-rec-note">อยู่ในช่วงทดสอบ · หากพบปัญหาติดต่อ {r.agent.creator || r.agent.owner || 'ผู้ดูแล'}</div>
                )}
                {readiness === 'in_dev' && <div className="chat-rec-note">ยังใช้งานไม่ได้</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function renderRich(text, matcher, onOpen) {
  return text.split('\n').map((line, li) => {
    const trimmed = line.trim();
    // Readiness-disclaimer footnotes always start "* " (see the chat prompt's
    // readiness gate) — render smaller/muted instead of a literal asterisk.
    if (/^\*\s+/.test(trimmed)) {
      return (
        <div key={li} className="chat-footnote">
          {processInline(trimmed.replace(/^\*\s+/, ''), `${li}`, matcher, onOpen)}
        </div>
      );
    }
    // "- " bullets (the prompt is told to use "-", never "*", for lists —
    // see functions/index.js — precisely so it never collides with the
    // footnote marker above).
    if (/^-\s+/.test(trimmed)) {
      return (
        <div key={li} className="chat-bullet-row">
          <span className="chat-bullet-dot" />
          <span>{processInline(trimmed.replace(/^-\s+/, ''), `${li}`, matcher, onOpen)}</span>
        </div>
      );
    }
    return <div key={li}>{processInline(line, `${li}`, matcher, onOpen)}</div>;
  });
}

function toCsv(rows) {
  if (!rows?.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))].join('\n');
}

function downloadCsv(rows, filename = 'agents.csv') {
  const csv = toCsv(rows);
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  // Revoking immediately races with the download in Safari/WebKit — the
  // click can still be processing async when the URL is invalidated, which
  // silently kills the download. A short delay avoids that.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ChatAssistant({ approvedAgents = [], allAgents = [], onOpenPreReg, onOpenAgent }) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState(null); // { processes, useCases } — lazy-loaded on first open
  const [vectors, setVectors] = useState(null); // Map<agentId, number[]> — semantic index, same lazy load
  const [transcript, setTranscript] = useState([]); // [{role:'user'|'assistant', text, csv?}]
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [chatWidth, setChatWidth] = useState(() => {
    const saved = Number(localStorage.getItem(CHAT_W_KEY));
    return saved >= CHAT_W_MIN && saved <= CHAT_W_MAX ? saved : 360;
  });
  const [resizing, setResizing] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Drag-to-resize — width only (panel is anchored bottom-right, so we grow
  // leftward: newWidth = start width + (mouse moved left from start)).
  useEffect(() => {
    if (!resizing) return;
    let startX = null, startW = chatWidth;
    function onMove(e) {
      if (startX === null) startX = e.clientX;
      const next = Math.min(CHAT_W_MAX, Math.max(CHAT_W_MIN, startW + (startX - e.clientX)));
      setChatWidth(next);
    }
    function onUp() {
      setResizing(false);
      setChatWidth((w) => { localStorage.setItem(CHAT_W_KEY, String(w)); return w; });
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [resizing]);

  // One alternation regex over every library name, longest-first, for
  // turning name mentions in assistant replies into clickable detail links.
  const agentMatcher = useMemo(() => {
    const names = approvedAgents
      .map((a) => a.agentName)
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    if (!names.length) return null;
    const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`(${esc.join('|')})`, 'g');
  }, [approvedAgents]);

  function openAgentByName(name) {
    const agent = findAgentByName(approvedAgents, name);
    if (agent) onOpenAgent?.(agent);
  }

  useEffect(() => {
    if (open && !catalog) {
      (async () => {
        try {
          // Vectors load HERE, on first chat open, rather than with the main
          // agent listener — a normal browsing session never pays for them.
          // ~244 × 256 floats is a few hundred KB, and keeping them client-side
          // is what lets cosine run inside skills.js so tier/readiness/archive
          // logic is never duplicated server-side.
          const [procSnap, ucSnap, vecSnap, schemaSnap] = await Promise.all([
            getDocs(collection(db, 'sdlcProcesses')),
            getDocs(collection(db, 'sdlcUseCases')),
            getDocs(collection(db, 'agentVectors')),
            getDoc(doc(db, 'config', 'schema')),
          ]);
          setCatalog({
            processes: procSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            useCases: ucSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            // Read straight from /config/schema.category rather than
            // deriving it from agents in the library — a category can be
            // admin-approved (CategoryApprovalPanel) before any agent uses
            // it, and that gap must still be visible to list_categories.
            categories: Array.isArray(schemaSnap.data()?.category) ? schemaSnap.data().category : [],
          });
          setVectors(new Map(vecSnap.docs.map((d) => [d.id, d.data()?.v]).filter(([, v]) => Array.isArray(v))));
        } catch {
          // Best-effort: query_sdlc just returns empty, and capability_search
          // falls back to its keyword arm rather than failing.
          setCatalog({ processes: [], useCases: [], categories: [] });
        }
      })();
    }
  }, [open, catalog]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [transcript, thinking]);

  // The input carries `disabled={thinking}` so a user can't send a second
  // question mid-answer — but a disabled input is forcibly blurred by the
  // browser the instant that attribute flips true, and nothing put focus back
  // once it flips false again. The user was left clicking into the box before
  // every follow-up question. Refocus whenever the box re-enables.
  useEffect(() => {
    if (!thinking && open) inputRef.current?.focus();
  }, [thinking, open]);

  function handleClose() {
    // Only hide the panel — KEEP the transcript in memory so reopening the
    // chat shows the ongoing conversation. It lives purely in React state on
    // this always-mounted component, so it survives open/close but is wiped
    // naturally on a page refresh or browser close (never persisted to
    // Firestore or storage). This is the "keep until refresh" behavior.
    setOpen(false);
    setInput('');
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');

    if (isBlockedInput(text)) {
      setTranscript((t) => [...t, { role: 'user', text }, { role: 'assistant', text: BLOCKED_REPLY }]);
      return;
    }

    // "Show all" follow-up (2026-08-04) — handled ENTIRELY locally, no model
    // call. Root cause of the bug this fixes: a capped query_library answer
    // only shows 8 cards with a CSV link for the rest; when the user typed
    // "แสดงทั้งหมด" the model had no structured record of the original filter
    // (only the templated text), so it improvised a fresh capability_search
    // with a vague query — which surfaced ALPHA's own tool skills
    // (get_agent_detail, query_library) as top hits, since their descriptions
    // are generic filter/search boilerplate that matches almost anything.
    //
    // The fix isn't a better prompt for reconstructing lost filters — it's to
    // never lose them. `templateAnswer`'s `csv` field already holds the FULL
    // matching set (query_library never truncates the data, only the display),
    // so "show all" can be answered by re-rendering that same array wider,
    // deterministically, for free. Gated on the immediately preceding
    // assistant turn actually having that data, so this can't misfire on an
    // unrelated sentence that happens to contain "ทั้งหมด".
    const SHOW_ALL_RE = /(แสดง|ดู|ขอ)?(ทั้งหมด|ครบทุกตัว|ครบทุกรายการ)|show all|list all|all of (them|it)/i;
    const lastMsg = transcript[transcript.length - 1];
    if (SHOW_ALL_RE.test(text) && lastMsg?.role === 'assistant' && lastMsg.csv?.length > 0) {
      setTranscript((t) => [...t, { role: 'user', text }, { role: 'assistant', ...expandCsvAnswer(lastMsg.csv) }]);
      return;
    }

    // On-demand registration link (2026-07-02): no persistent header button
    // anymore — only surface it inline, on the reply, when the user actually
    // asks about registering a new idea. Heuristic keyword match is fine here
    // since it's just a convenience link, not a security/permission boundary.
    const wantsRegister = /ลงทะเบียน|สมัคร|register|pre-?reg|เพิ่ม.*agent|สร้าง.*agent.*ใหม่/i.test(text);

    const userTurn = { role: 'user', text };
    // Past ANSWERS are trimmed before being replayed as history (2026-07-30).
    // A previous reply can be a long formatted list; sent back verbatim it
    // dominates the context and the model starts anchoring on it — a fresh,
    // unrelated question ("มีตัวไหนช่วยทำ automate test") got answered with
    // "ผมให้ข้อมูล User Story ไปแล้วครับ" instead of a new search. Enough is
    // kept for genuine follow-ups ("ตัวแรกมี endpoint ไหม") to still resolve;
    // user turns are left intact since they are short and carry the intent.
    const historyForCall = transcript
      .slice(-HISTORY_WINDOW)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        text: m.role === 'assistant' && m.text.length > HISTORY_ANSWER_MAX
          ? `${m.text.slice(0, HISTORY_ANSWER_MAX)}…[คำตอบก่อนหน้าถูกย่อ]`
          : m.text,
      }));
    setTranscript((t) => [...t, userTurn]);
    setThinking(true);

    // `library` is the recommendable set (archived excluded) — ALPHA must never
    // point a user at a retired entry. `libraryAll` keeps the archived ones for
    // the analysis-flavoured tools (duplicate/overlap warnings, idea
    // generation), which need to know what was already tried and dropped.
    // Per-tool choice lives in src/lib/skills.js, not here.
    const ctx = {
      library: approvedAgents,
      libraryAll: allAgents.length ? allAgents : approvedAgents,
      processes: catalog?.processes || [],
      useCases: catalog?.useCases || [],
      categories: catalog?.categories || [],
      vectors,
    };
    const fn = httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'chatLibrary');

    try {
      let toolResults = [];
      let message = text;
      let finalText = null;

      for (let i = 0; i < MAX_LOOP && finalText === null; i++) {
        // `message` is re-sent on EVERY iteration, not just the first.
        //
        // It used to be nulled after the first call, which meant the turn that
        // actually COMPOSES the answer (after a tool result comes back) never
        // saw the user's question at all — it received only the prior
        // conversation plus a function response. The most recent user text in
        // its context was therefore the PREVIOUS question, so it answered that
        // one instead: asking "อะไรช่วยเขียน code ได้" produced a reply that
        // opened "อยากรู้ว่ามี Agent ตัวไหนพร้อมใช้งานบ้าง" — verbatim the
        // question before it. Answers were consistently one turn behind.
        //
        // This also restores the documented function-calling shape
        // (user → model:functionCall → user:functionResponse); without the
        // user turn the sequence was malformed. The server is stateless and
        // rebuilds `contents` from scratch each call, and historyForCall is
        // snapshotted BEFORE this turn is appended, so re-sending cannot
        // duplicate the message.
        const { data } = await fn({ history: historyForCall, message, toolResults });

        if (data.type === 'answer') {
          finalText = data.text;
          break;
        }
        if (data.type === 'tool_call') {
          const result = await runTool(data.name, data.args || {}, ctx);
          // query_sdlc with withAgentCounts is an ANALYSIS request (coverage/
          // gap reasoning), not a plain lookup — it must go back to Gemini to
          // be interpreted, same as capability_search. Plain query_sdlc calls
          // (no withAgentCounts) stay on the fast, free template path.
          const isAnalysis = data.name === 'query_sdlc' && data.args?.withAgentCounts;
          const isTemplate = TEMPLATE_TOOLS.has(data.name) && !isAnalysis;
          if (isTemplate) {
            const { text: t, csv } = templateAnswer(data.name, data.args || {}, result);
            setTranscript((prev) => [...prev, { role: 'assistant', text: t, csv, registerCta: wantsRegister }]);
            finalText = ''; // handled directly — skip the generic append below
            break;
          }
          // capability_search / query_sdlc-analysis — loop back with the
          // result so the model can reason over it and compose the answer.
          toolResults = [...toolResults, { name: data.name, args: data.args || {}, result }];
        }
      }

      if (finalText === null) {
        setTranscript((prev) => [...prev, { role: 'assistant', text: 'ขอโทษครับ ลองถามใหม่อีกครั้งนะครับ' }]);
      } else if (finalText) {
        setTranscript((prev) => [...prev, { role: 'assistant', text: finalText, registerCta: wantsRegister }]);
      }
    } catch (e) {
      setTranscript((prev) => [...prev, { role: 'assistant', text: `ขอโทษครับ เกิดข้อผิดพลาด (${e.message || 'unknown'})` }]);
    } finally {
      setThinking(false);
    }
  }

  return (
    <>
      {/* Wolfy logo only appears once the panel is actually open (collapsed
          to a circle) — the closed pill is text-only now, per explicit
          request to keep the logo as a "chat is open" signal rather than
          branding on the always-visible entry point. */}
      <button className={`chat-fab ${open ? 'chat-fab-closed' : ''}`} onClick={() => setOpen((v) => !v)} title="AI Agent Library Chat Assistant">
        {open ? (
          <img src="/wolfy-chat.png" alt="" className="chat-fab-logo" />
        ) : (
          <span className="chat-fab-label">Ask ALPHA</span>
        )}
      </button>

      {open && (
        <div className="chat-panel" style={{ '--chat-w': `${chatWidth}px` }}>
          <div
            className={`chat-resize-handle ${resizing ? 'active' : ''}`}
            onMouseDown={(e) => { e.preventDefault(); setResizing(true); }}
          />
          <div className="chat-header">
            <span><img src="/wolfy-logo.png" alt="" className="chat-hdr-logo" /> AI Agent Library Assistant</span>
            <div className="chat-header-actions">
              <button className="chat-close" onClick={handleClose}>✕</button>
            </div>
          </div>

          <div className="chat-body" ref={scrollRef}>
            {transcript.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>
                <div className="chat-bubble">
                  {(() => {
                    // Assistant replies may carry "@@ Name | reason" (agent
                    // cards) or "## title | subtitle" (SDLC process/use-case
                    // cards) lines. Those become data-drawn cards; whatever
                    // else is in the message stays ordinary prose, so mode-B
                    // answers (Agile advice, gap analysis, "not found") render
                    // exactly as before.
                    if (m.role !== 'assistant') return renderRich(m.text, null, openAgentByName);
                    return parseBlocks(m.text).map((b, bi) => (
                      b.kind === 'recs'
                        ? <RecommendationList key={bi} recs={b.items} library={approvedAgents} onOpen={openAgentByName} />
                        : b.kind === 'sdlc'
                        ? <SdlcList key={bi} items={b.items} />
                        : <div key={bi}>{renderRich(b.text, agentMatcher, openAgentByName)}</div>
                    ));
                  })()}
                  {m.csv?.length > 0 && (
                    <button className="btn btn-secondary chat-csv-btn" onClick={() => downloadCsv(m.csv, 'agents.csv')}>
                      ⬇ ดาวน์โหลด CSV
                    </button>
                  )}
                  {m.registerCta && (
                    <button className="btn btn-secondary chat-csv-btn" onClick={() => onOpenPreReg?.()}>
                      + เปิดฟอร์มลงทะเบียน Agent/Skill ใหม่
                    </button>
                  )}
                </div>
              </div>
            ))}
            {thinking && (
              <div className="chat-msg assistant">
                <div className="chat-bubble chat-thinking">
                  <span className="chat-dot" /><span className="chat-dot" /><span className="chat-dot" />
                </div>
              </div>
            )}
          </div>

          <div className="chat-input-row">
            <input
              ref={inputRef}
              className="chat-input"
              placeholder="Ask ALPHA..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              disabled={thinking}
            />
            <button className="chat-send" onClick={handleSend} disabled={thinking || !input.trim()} title="ส่ง" aria-label="ส่ง">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
