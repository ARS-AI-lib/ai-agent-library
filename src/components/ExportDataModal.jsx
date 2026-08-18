import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getType, getTier } from '../lib/tier';
import { agentApproveAreas } from '../lib/approveAreas';
import { isMyAgent, normalizeProgress } from '../lib/agentUtils';
import { readStats, STAR_LEVELS } from '../lib/agentStats';
import { useAgentStats } from '../hooks/useAgentStats';
import useEscapeKey from '../hooks/useEscapeKey';

// ratingScore is a CSV-only exception to agentStats.js's "never render a
// computed average" rule. That rule protects a casual card/modal viewer from
// a misleading `★5.0 (1)`. A CSV opened in a spreadsheet for analysis is a
// different audience with a different need — a single sortable number — so
// this average lives here, not in agentStats.js, to keep it from being
// reachable from any display surface. Blank (not 0) when nobody has rated.
function ratingScore(stats) {
  const s = readStats(stats);
  if (s.ratingCount === 0) return '';
  const sum = STAR_LEVELS.reduce((t, i) => t + i * s[`r${i}`], 0);
  return Math.round((sum / s.ratingCount) * 10) / 10;
}

// 'category' and 'approveArea' added 2026-08-10 so an exported CSV carries
// enough to analyze/pivot by discipline and domain without cross-referencing
// the live app — the whole point of a "take it and analyze" export.
// 'tier' added 2026-08-12 — it is computed client-side (never stored), so
// without it the CSV cannot be pivoted by tier at all: the raw customerFacing/
// internalUse/aiAgent/skillMd flags are in All Data but a reader would have to
// re-implement getTier() by hand to get from them to T1..T4. Sits next to
// 'type' because the two are the same classification at different grain.
// 'ratingScore' added 2026-08-18 — see the ratingScore() helper above for why
// it's an average here specifically (CSV/analysis) despite the no-average
// rule everywhere else in the app.
const COLUMNS = ['agentName', 'type', 'tier', 'owner', 'creator', 'creatorEmails', 'approvalStatus', 'devProgress', 'reusable', 'category', 'approveArea', 'ratingScore', 'description'];

// Full field set for "All Data" — mirrors export-agents-csv.cjs's column
// list minus the two Firebase Auth UID fields (createdBy, approvedBy),
// deliberately excluded from any exported CSV (2026-07-04, security).
const ALL_COLUMNS = [
  'id', 'agentName', 'description', 'aiAgent', 'skillMd', 'tier', 'owner',
  'coreAbility', 'relatedRole', 'category', 'approveArea', 'customerFacing', 'internalUse',
  'reusable', 'reuseCondition', 'hml', 'humanJob', 'tool', 'llm',
  'dataPrivacy', 'sdlcStage', 'sdlcProcessMapping', 'useCase',
  'input', 'output', 'businessValue', 'developmentPhase', 'devProgress',
  'deploymentStatus', 'launchDate', 'approvalStatus',
  'creator', 'creatorEmails', 'matchingAgent',
  // 2026-07-22: archived entries are still exported (this file IS the audit
  // trail), so the export must say which ones they are and why.
  'endpoint', 'archived', 'archiveReason',
  'ratingScore',
];

function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// resolveAreas is passed in rather than imported+called directly because it
// needs the live /config/schema.categoryAreaMap override (see the component
// below) — a plain agentApproveAreas(agent) call here would silently ignore
// any category an admin has approved since the last code deploy.
function toRow(agent, resolveAreas, statsById) {
  return {
    agentName: agent.agentName || '',
    type: getType(agent) === 'skill' ? 'Skill' : 'Agent',
    tier: getTier(agent),
    owner: agent.owner || '',
    creator: agent.creator || '',
    creatorEmails: Array.isArray(agent.creatorEmails) ? agent.creatorEmails.join('; ') : '',
    approvalStatus: agent.approvalStatus || '',
    devProgress: normalizeProgress(agent?.devProgress),
    reusable: agent.reusable || '',
    category: (Array.isArray(agent.category) ? agent.category : []).join('; '),
    approveArea: resolveAreas(agent).join('; '),
    ratingScore: ratingScore(statsById?.get(agent.id)),
    description: agent.description || '',
  };
}

function toDateStr(v) {
  if (!v) return '';
  try {
    const d = v?.toDate ? v.toDate() : new Date(v);
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

// Every raw field, verbatim — used only by "All Data" (id included, and
// devProgress left un-normalized so it round-trips with import-agents-csv.cjs).
// Two exceptions to "raw, verbatim", both because the value is DERIVED and has
// no stored field to read:
//   approveArea — goes through the resolver (like toRow above) so a doc whose
//     stored value is stale or empty still exports the area it resolves to today.
//   tier        — computed by getTier() from aiAgent/skillMd + customerFacing/
//     internalUse; `agent.tier` does not exist, so without this branch the
//     column would export as empty on every row (2026-08-12).
function toFullRow(agent, resolveAreas, statsById) {
  const row = { id: agent.id || '' };
  ALL_COLUMNS.slice(1).forEach((field) => {
    if (field === 'approveArea') { row[field] = resolveAreas(agent).join('; '); return; }
    if (field === 'tier') { row[field] = getTier(agent); return; }
    if (field === 'ratingScore') { row[field] = ratingScore(statsById?.get(agent.id)); return; }
    const raw = agent[field];
    if (field === 'launchDate') row[field] = toDateStr(raw);
    else if (typeof raw === 'boolean') row[field] = raw ? 'TRUE' : 'FALSE';
    else if (Array.isArray(raw)) row[field] = raw.join('; ');
    else row[field] = raw == null ? '' : String(raw);
  });
  return row;
}

function downloadCsv(rows, filename, columns = COLUMNS) {
  const lines = [columns.join(',')];
  rows
    .slice()
    .sort((a, b) => (a.owner || '').localeCompare(b.owner || '') || a.agentName.localeCompare(b.agentName))
    .forEach((r) => lines.push(columns.map((c) => csvCell(r[c])).join(',')));
  // Excel (Windows especially) doesn't auto-detect UTF-8 without a BOM — Thai
  // text renders as mojibake ("ต่างดาว") even though the bytes are correct
  // UTF-8. Numbers on Mac sniffs the encoding anyway, which is why the same
  // file looked fine there. The BOM is a no-op for every other CSV reader.
  const blob = new Blob(['\uFEFF', lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export Data modal (hamburger menu → "Export Data"). Combines Approved
 * (already loaded elsewhere) + Pending + Rejected (fetched here, on-demand —
 * not worth a permanent real-time listener for an occasional export action)
 * into one pool, then offers role-scoped CSV downloads:
 *   user      — My AI
 *   approver  — + My Area's AI
 *   committee/admin — + All Data
 * "My Team's AI" was removed (2026-07-05) — too redundant against "My AI"
 * (same creatorEmails-based ownership, just team-grouped) to justify a
 * separate button.
 *
 * Status/field scope per button:
 *   My AI        — trimmed columns, always Active only (approved, not archived)
 *   My Area's AI — trimmed columns, always Active only
 *   All Data     — EVERY field (ALL_COLUMNS/toFullRow); Active only by
 *                  default, with its own two checkboxes (2026-08-11) to opt
 *                  into pending/rejected and/or archived — scoped to this
 *                  button alone, not a global export policy. Previously
 *                  every button always included every approvalStatus
 *                  unconditionally, which silently mixed drafts/rejects into
 *                  what reads as "the library" in the exported CSV.
 */
export default function ExportDataModal({ onClose, approvedAgents, user, role, isAdmin, isCommittee, approveAreas, schema = {} }) {
  const [pending, setPending] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Active-only by default (2026-08-11) — every button used to export EVERY
  // approvalStatus unconditionally (see the removed header note below); that
  // silently mixed still-pending drafts and rejected ideas into what reads as
  // "the library" to whoever opens the CSV. Active = approved AND not
  // archived. These two checkboxes opt back into the wider set per pull,
  // rather than a permanent per-button policy — unchecked means active-only.
  const [includeInactive, setIncludeInactive] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  useEscapeKey(onClose);
  // See PendingApprovalModal for why this wrapper exists — live
  // category->area overrides from CategoryApprovalPanel must apply here too,
  // since Export's "My Area's AI" button uses the same area intersection.
  const resolveAreas = (a) => agentApproveAreas(a, schema.categoryAreaMap);
  const statsById = useAgentStats(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getDocs(query(collection(db, 'agents'), where('approvalStatus', '==', 'pending'))),
      getDocs(query(collection(db, 'agents'), where('approvalStatus', '==', 'rejected'))),
    ])
      .then(([pendingSnap, rejectedSnap]) => {
        if (!alive) return;
        setPending(pendingSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setRejected(rejectedSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      })
      .catch((e) => { if (alive) setError(e.message || 'โหลดข้อมูลไม่สำเร็จ'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const allAgents = useMemo(
    () => [...approvedAgents, ...pending, ...rejected],
    [approvedAgents, pending, rejected]
  );

  // Active = approved and not archived. My AI / My Area's AI always stay
  // active-only — the includeInactive/includeArchived checkboxes are scoped
  // to All Data ONLY (2026-08-11, explicit request), not a global export
  // policy, so each button reads from its own filtered set below.
  const activeAgents = useMemo(
    () => allAgents.filter((a) => a.approvalStatus === 'approved' && a.archived !== true),
    [allAgents]
  );
  const allDataAgents = useMemo(
    () => allAgents.filter((a) =>
      (includeInactive || a.approvalStatus === 'approved')
      && (includeArchived || a.archived !== true)
    ),
    [allAgents, includeInactive, includeArchived]
  );

  function exportMyAI() {
    const rows = activeAgents.filter((a) => isMyAgent(a, user)).map((a) => toRow(a, resolveAreas, statsById));
    downloadCsv(rows, 'my-ai.csv');
  }
  function exportMyArea() {
    const areaSet = new Set(approveAreas || []);
    const rows = activeAgents.filter((a) => resolveAreas(a).some((ar) => areaSet.has(ar))).map((a) => toRow(a, resolveAreas, statsById));
    downloadCsv(rows, 'my-area-ai.csv');
  }
  function exportAll() {
    downloadCsv(allDataAgents.map((a) => toFullRow(a, resolveAreas, statsById)), 'all-ai.csv', ALL_COLUMNS);
  }

  // "My Area's AI" is for admin/committee/approver tiers ONLY (base "user"
  // never gets this, even if an area were somehow assigned to one) — AND
  // only once an area is actually assigned. Role-string-only gating (just
  // role === 'approver') was wrong because admin/committee can now assign
  // areas to themselves too (2026-07-04 rule change) and still need the
  // button to show.
  const showArea = (isAdmin || isCommittee || role === 'approver') && (approveAreas || []).length > 0;
  // 'staff' gets All Data too (2026-07-06) — export-only, no approve/edit rights.
  const showAll = isAdmin || isCommittee || role === 'staff';

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox">
        <button className="mclose" onClick={onClose}>✕</button>
        <div className="m-head">
          <div className="m-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </div>
          <div>
            <h2 className="mtitle">Export Data</h2>
            <p>ดาวน์โหลดเป็น CSV</p>
          </div>
        </div>

        {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            {/* .mac reused as a clickable option row (2026-08-08) — was a plain
                one-line button; each download is now a small card with a count
                badge, matching the redesign's treatment of every other
                clickable option row (SDLC process cards, the SDLC modal's
                nested agent cards). Per-button description line removed
                (2026-08-11, explicit request) — the name + item count already
                say enough. */}
            <button className="mac" style={{ textAlign: 'left', width: '100%', fontFamily: 'inherit', border: '1px solid var(--bd-soft)', cursor: 'pointer' }} onClick={exportMyAI}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="macname">My AI</span>
                <span className="deploy-badge" style={{ marginLeft: 'auto', color: 'var(--mu)', background: 'var(--sf3)' }}>{activeAgents.filter((a) => isMyAgent(a, user)).length} items</span>
              </div>
            </button>
            {showArea && (
              <button className="mac" style={{ textAlign: 'left', width: '100%', fontFamily: 'inherit', border: '1px solid var(--bd-soft)', cursor: 'pointer' }} onClick={exportMyArea}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="macname">My Area's AI</span>
                  <span className="deploy-badge" style={{ marginLeft: 'auto', color: 'var(--mu)', background: 'var(--sf3)' }}>{activeAgents.filter((a) => resolveAreas(a).some((ar) => (approveAreas || []).includes(ar))).length} items</span>
                </div>
              </button>
            )}
            {showAll && (
              // Checkboxes live INSIDE this same card (not a separate block
              // below all three buttons) so it's visually unambiguous they
              // only scope All Data — My AI/My Area's AI above stay
              // active-only unconditionally (2026-08-11 explicit request).
              <div className="mac" style={{ border: '1px solid var(--bd-soft)' }}>
                <button
                  type="button"
                  onClick={exportAll}
                  style={{ textAlign: 'left', width: '100%', fontFamily: 'inherit', border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="macname">All Data</span>
                    <span className="deploy-badge" style={{ marginLeft: 'auto', color: 'var(--mu)', background: 'var(--sf3)' }}>{allDataAgents.length} items</span>
                  </div>
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--bd-soft)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
                    Include Inactive (pending / rejected)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
                    Include Archived
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
