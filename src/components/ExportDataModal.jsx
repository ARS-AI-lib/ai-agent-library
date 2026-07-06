import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { getType, agentApproveAreas } from '../lib/tier';
import { isMyAgent } from '../lib/agentUtils';

// devProgress may still be a legacy string ("90%") on a handful of docs.
function progressNum(agent) {
  const raw = agent?.devProgress;
  const num = typeof raw === 'number' ? raw : parseInt(String(raw || '').replace('%', ''), 10);
  return isNaN(num) ? 0 : num;
}

const COLUMNS = ['agentName', 'type', 'owner', 'creator', 'creatorEmails', 'approvalStatus', 'devProgress', 'reusable', 'description'];

// Full field set for "All Data" — mirrors export-agents-csv.cjs's column
// list minus the two Firebase Auth UID fields (createdBy, approvedBy),
// deliberately excluded from any exported CSV (2026-07-04, security).
const ALL_COLUMNS = [
  'id', 'agentName', 'description', 'aiAgent', 'skillMd', 'owner',
  'coreAbility', 'relatedRole', 'customerFacing', 'internalUse',
  'reusable', 'reuseCondition', 'hml', 'humanJob', 'tool', 'llm',
  'dataPrivacy', 'sdlcStage', 'sdlcProcessMapping', 'useCase',
  'input', 'output', 'businessValue', 'developmentPhase', 'devProgress',
  'deploymentStatus', 'launchDate', 'approvalStatus',
  'creator', 'creatorEmails', 'matchingAgent',
];

function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toRow(agent) {
  return {
    agentName: agent.agentName || '',
    type: getType(agent) === 'skill' ? 'Skill' : 'Agent',
    owner: agent.owner || '',
    creator: agent.creator || '',
    creatorEmails: Array.isArray(agent.creatorEmails) ? agent.creatorEmails.join('; ') : '',
    approvalStatus: agent.approvalStatus || '',
    devProgress: progressNum(agent),
    reusable: agent.reusable || '',
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
function toFullRow(agent) {
  const row = { id: agent.id || '' };
  ALL_COLUMNS.slice(1).forEach((field) => {
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
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
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
 * Status/field scope per button (2026-07-04 decision):
 *   My AI       — every approvalStatus (approved/pending/rejected), trimmed columns
 *   My Area's AI — every approvalStatus, trimmed columns
 *   All Data    — every approvalStatus, EVERY field (ALL_COLUMNS/toFullRow)
 */
export default function ExportDataModal({ onClose, approvedAgents, user, role, isAdmin, isCommittee, approveAreas }) {
  const [pending, setPending] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  function exportMyAI() {
    const rows = allAgents.filter((a) => isMyAgent(a, user)).map(toRow);
    downloadCsv(rows, 'my-ai.csv');
  }
  function exportMyArea() {
    const areaSet = new Set(approveAreas || []);
    const rows = allAgents.filter((a) => agentApproveAreas(a).some((ar) => areaSet.has(ar))).map(toRow);
    downloadCsv(rows, 'my-area-ai.csv');
  }
  function exportAll() {
    downloadCsv(allAgents.map(toFullRow), 'all-ai.csv', ALL_COLUMNS);
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
        <div className="mtitle">Export Data</div>
        <div className="msub">ดาวน์โหลดเป็น CSV — My AI/My Area's AI รวมทุกสถานะ, All Data ทุกสถานะ+ทุก field</div>

        {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            <button className="btn btn-secondary" style={{ justifyContent: 'space-between', display: 'flex' }} onClick={exportMyAI}>
              <span>My AI</span><span style={{ color: 'var(--mu)', fontWeight: 400 }}>{allAgents.filter((a) => isMyAgent(a, user)).length} items</span>
            </button>
            {showArea && (
              <button className="btn btn-secondary" style={{ justifyContent: 'space-between', display: 'flex' }} onClick={exportMyArea}>
                <span>My Area's AI</span>
                <span style={{ color: 'var(--mu)', fontWeight: 400 }}>{allAgents.filter((a) => agentApproveAreas(a).some((ar) => (approveAreas || []).includes(ar))).length} items</span>
              </button>
            )}
            {showAll && (
              <button className="btn btn-primary" style={{ justifyContent: 'space-between', display: 'flex' }} onClick={exportAll}>
                <span>All Data</span><span style={{ fontWeight: 400 }}>{allAgents.length} items</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
