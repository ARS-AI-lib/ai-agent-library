import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../lib/firebase';
import { runSkill } from '../lib/skills';
import { isBlockedInput, BLOCKED_REPLY } from '../lib/chatGuardrails';
import { getType, getTier } from '../lib/tier';
import '../styles/ChatAssistant.css';

// Tools whose result is composed into a Thai answer LOCALLY (no further
// Vertex call) — the "2a" deterministic path. capability_search is the lone
// "2b" tool: its result is sent back to the model for semantic ranking +
// conversational composition (see chatLibrary's system prompt).
const TEMPLATE_TOOLS = new Set(['query_library', 'query_sdlc', 'get_agent_detail', 'connection_suggest']);

const MAX_LOOP = 3;
const HISTORY_WINDOW = 6;
const CHAT_W_KEY = 'chatWidth';
const CHAT_W_MIN = 340;
const CHAT_W_MAX = 640;

function findAgentByName(library, name) {
  const q = (name || '').toLowerCase().trim();
  return library.find((a) => (a.agentName || '').toLowerCase().trim() === q) || null;
}

// Runs a tool call against the client-side skill registry. Handles the one
// shape mismatch between the chat-facing tool declarations (functions/index.js)
// and the raw skills.js signatures: connection_suggest here takes just an
// existing agentName, so we resolve the real agent record and feed it in as
// the "draft" (findConnectionSuggestions already excludes a draft's own name
// from its own results, so this is safe).
function runTool(name, args, ctx) {
  if (name === 'connection_suggest') {
    const agent = findAgentByName(ctx.library, args.agentName);
    if (!agent) return { notFound: true, agentName: args.agentName };
    return { suggestions: runSkill('connection_suggest', { draft: agent, limit: 6 }, ctx) };
  }
  return runSkill(name, args, ctx);
}

// ── Local (no-LLM) Thai templates for the deterministic tools ──────────
function templateAnswer(name, args, result) {
  if (name === 'query_library') {
    if (result.mode === 'group') {
      const entries = Object.entries(result.counts).sort((a, b) => b[1] - a[1]);
      if (entries.length === 0) return { text: 'ไม่พบข้อมูลตามเงื่อนไขที่ถามครับ', csv: null };
      const lines = entries.map(([k, v]) => `• ${k}: ${v} รายการ`).join('\n');
      return { text: `พบทั้งหมด ${result.total} รายการ แบ่งตาม ${result.groupBy}:\n${lines}`, csv: null };
    }
    if (result.total === 0) return { text: 'ไม่พบ Agent/Skill ที่ตรงกับเงื่อนไขนี้ครับ', csv: null };
    const shown = result.agents.slice(0, 15);
    const lines = shown.map((a) => `• ${a.agentName} (${a.tier}, ${a.status}, ${a.owner || 'ไม่ระบุ owner'})`).join('\n');
    const more = result.total > shown.length ? `\n...และอีก ${result.total - shown.length} รายการ` : '';
    return {
      text: `พบทั้งหมด ${result.total} รายการ:\n${lines}${more}`,
      csv: result.agents,
    };
  }
  if (name === 'query_sdlc') {
    const parts = [];
    if (result.processes.length) {
      parts.push(result.processes.map((p) => `• Process ${p.id}: ${p.name} (${p.stage}${p.owner ? `, owner: ${p.owner}` : ''})`).join('\n'));
    }
    if (result.useCases.length) {
      parts.push(result.useCases.map((u) => `• Use Case: ${u.name} (process ${u.processId}${u.owner ? `, owner: ${u.owner}` : ''})`).join('\n'));
    }
    if (!parts.length) return { text: 'ไม่พบข้อมูล SDLC ตามที่ถามครับ', csv: null };
    return { text: parts.join('\n'), csv: null };
  }
  if (name === 'get_agent_detail') {
    if (!result) return { text: `ไม่พบ Agent/Skill ชื่อ "${args.agentName}" ในไลบรารีครับ`, csv: null };
    const type = getType(result) === 'skill' ? 'Skill' : 'Agent';
    const tier = getTier(result);
    return {
      text: `**${result.agentName}** (${type}, Tier ${tier})\n${result.description || '(ไม่มีคำอธิบาย)'}\n\nOwner: ${result.owner || '—'}\nInput: ${result.input || '—'}\nOutput: ${result.output || '—'}`,
      csv: null,
    };
  }
  if (name === 'connection_suggest') {
    if (result.notFound) return { text: `ไม่พบ Agent ชื่อ "${result.agentName}" ในไลบรารีครับ`, csv: null };
    if (!result.suggestions.length) return { text: 'ไม่พบ Agent/Skill ที่ต่อกันได้อย่างมีนัยสำคัญครับ', csv: null };
    const lines = result.suggestions.map((s) => `• ${s.target} (${s.type}) — ${s.reason}`).join('\n');
    return { text: `ต่อกับตัวนี้ได้:\n${lines}`, csv: null };
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

function renderRich(text, matcher, onOpen) {
  return text.split('\n').map((line, li) => {
    const segs = line.split('**');
    return (
      <div key={li}>
        {segs.map((seg, si) => {
          const inner = linkifyAgents(seg, `${li}-${si}`, matcher, onOpen);
          // Odd segments sit between a pair of ** → bold. A dangling ** (odd
          // count) just leaves its tail as a normal segment — graceful.
          return si % 2 === 1
            ? <strong key={si}>{inner}</strong>
            : <span key={si}>{inner}</span>;
        })}
      </div>
    );
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

export default function ChatAssistant({ approvedAgents = [], onOpenPreReg, onOpenAgent }) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState(null); // { processes, useCases } — lazy-loaded on first open
  const [transcript, setTranscript] = useState([]); // [{role:'user'|'assistant', text, csv?}]
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [chatWidth, setChatWidth] = useState(() => {
    const saved = Number(localStorage.getItem(CHAT_W_KEY));
    return saved >= CHAT_W_MIN && saved <= CHAT_W_MAX ? saved : 360;
  });
  const [resizing, setResizing] = useState(false);
  const scrollRef = useRef(null);

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
          const [procSnap, ucSnap] = await Promise.all([
            getDocs(collection(db, 'sdlcProcesses')),
            getDocs(collection(db, 'sdlcUseCases')),
          ]);
          setCatalog({
            processes: procSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
            useCases: ucSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
          });
        } catch {
          setCatalog({ processes: [], useCases: [] }); // best-effort — query_sdlc just returns empty
        }
      })();
    }
  }, [open, catalog]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [transcript, thinking]);

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

    // On-demand registration link (2026-07-02): no persistent header button
    // anymore — only surface it inline, on the reply, when the user actually
    // asks about registering a new idea. Heuristic keyword match is fine here
    // since it's just a convenience link, not a security/permission boundary.
    const wantsRegister = /ลงทะเบียน|สมัคร|register|pre-?reg|เพิ่ม.*agent|สร้าง.*agent.*ใหม่/i.test(text);

    const userTurn = { role: 'user', text };
    const historyForCall = transcript
      .slice(-HISTORY_WINDOW)
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', text: m.text }));
    setTranscript((t) => [...t, userTurn]);
    setThinking(true);

    const ctx = { library: approvedAgents, processes: catalog?.processes || [], useCases: catalog?.useCases || [] };
    const fn = httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'chatLibrary');

    try {
      let toolResults = [];
      let message = text;
      let finalText = null;

      for (let i = 0; i < MAX_LOOP && finalText === null; i++) {
        const { data } = await fn({ history: historyForCall, message, toolResults });
        message = null; // only sent on the first iteration

        if (data.type === 'answer') {
          finalText = data.text;
          break;
        }
        if (data.type === 'tool_call') {
          const result = runTool(data.name, data.args || {}, ctx);
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
      <button className={`chat-fab ${open ? 'chat-fab-closed' : ''}`} onClick={() => setOpen((v) => !v)} title="AI Agent Library Chat Assistant">
        {open ? (
          <img src="/wolfy-chat.png" alt="" className="chat-fab-logo" />
        ) : (
          <>
            <img src="/wolfy-chat.png" alt="" className="chat-fab-logo" />
            <span className="chat-fab-label">Ask ALPHA</span>
          </>
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
                  {renderRich(m.text, m.role === 'assistant' ? agentMatcher : null, openAgentByName)}
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
              className="chat-input"
              placeholder="Ask ALPHA..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              disabled={thinking}
            />
            <button className="btn btn-success chat-send-btn" onClick={handleSend} disabled={thinking || !input.trim()}>
              ส่ง
            </button>
          </div>
        </div>
      )}
    </>
  );
}
