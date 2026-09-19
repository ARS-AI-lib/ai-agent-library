import { useEffect, useMemo, useState } from 'react';
import {
  collection, getDocs, addDoc, onSnapshot, query, orderBy, serverTimestamp,
  doc, updateDoc, deleteDoc, writeBatch, runTransaction,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../hooks/useAuth';
import { useApprovedAgents } from '../hooks/useAgents';
import { useConfigSchema } from '../hooks/useConfigSchema';
import { getType } from '../lib/tier';
import { agentProcessIds, agentUseCaseNames, buildAgentFilter, relationshipLabel } from '../lib/agentUtils';
import { agentStatus, ST_DEF, progressBucket } from '../lib/status';
import ComboInput from './ComboInput';
import AgentDetailModal from './AgentDetailModal';
import PreRegModal from './PreRegModal';
import LoginScreen from './LoginScreen';
import { ALLOWED_DOMAINS_LABEL } from '../lib/firebase';
import ChatAssistant from './ChatAssistant';
import '../styles/SDLCTab.css';
import '../styles/WorkshopPage.css';

// Fork of the board-layout constants in SDLCTab.jsx (not imported — that file
// doesn't export them, and this page is deliberately a standalone read-mostly
// port, not a shared component, so the production board can't regress from
// this work). Keep in sync by hand if the live board's stage grouping changes.
const STAGE_COLOR = { Initiation: '#a9754a', Discovery: '#4d6b96', Design: '#7d6a9e', Build: '#4d8c7c', Test: '#8c6b45', Deployment: '#a85f5f', 'Post Development': '#9c6478' };
const GROUPS = [
  { label: 'Discovery', merged: false, sub: [
    { label: 'INITIATION', stage: 'Initiation' },
    { label: 'DISCOVERY', stage: 'Discovery' },
  ]},
  { label: 'Development', merged: false, sub: [
    { label: 'DESIGN', stage: 'Design' },
    { label: 'BUILD', stage: 'Build' },
    { label: 'TEST', stage: 'Test' },
    { label: 'DEPLOYMENT', stage: 'Deployment' },
  ]},
  { label: 'After Development', merged: true, sub: [
    { label: 'POST DEVELOPMENT', stage: 'Post Development' },
  ]},
];
const ALL_STAGES = GROUPS.flatMap((g) => g.sub.map((s) => s.stage));
const STATUS_ICON = { td: '◦', ip: '●', pilot: '◆', ru: '✓' };
const PRIORITY = ['ru', 'pilot', 'ip', 'td'];
const WEIGHT_STATUS = { 1: 'td', 2: 'ip', 3: 'pilot', 4: 'ru' };

function dominantStatus(counts) {
  const total = counts.td + counts.ip + counts.pilot + counts.ru;
  if (total === 0) return 'td';
  const max = Math.max(counts.td, counts.ip, counts.pilot, counts.ru);
  const top = ['td', 'ip', 'pilot', 'ru'].filter((s) => counts[s] === max);
  if (top.length === 1) return top[0];
  const avg = ((counts.td * 1) + (counts.ip * 2) + (counts.pilot * 3) + (counts.ru * 4)) / total;
  const idx = Math.max(1, Math.min(4, Math.ceil(avg - 0.5)));
  return WEIGHT_STATUS[idx];
}

function sortProcs(procs) {
  return [...procs].sort((a, b) => {
    const aNum = /^\d/.test(a.id), bNum = /^\d/.test(b.id);
    if (aNum && bNum) return parseFloat(a.id) - parseFloat(b.id) || a.id.localeCompare(b.id);
    if (aNum) return -1;
    if (bNum) return 1;
    return a.id.localeCompare(b.id);
  });
}

function withProgress(agent) {
  const prog = agent?.devProgress;
  const num = typeof prog === 'number' ? prog : parseInt(String(prog || '').replace('%', ''), 10);
  return { ...agent, devProgress: isNaN(num) ? 0 : num };
}

// Fork of tagRow in SDLCTab.jsx (same deliberate-fork rationale as the board
// constants above): owner / relationship-label / role tags, deduped by text.
function tagRow(a, t, rel) {
  const roleText = a.relatedRole ? (Array.isArray(a.relatedRole) ? a.relatedRole.join(', ') : a.relatedRole) : '';
  const seen = new Set();
  const tags = [];
  if (a.owner && !seen.has(a.owner)) { seen.add(a.owner); tags.push({ key: 'owner', text: a.owner }); }
  if (rel && !seen.has(rel.label)) { seen.add(rel.label); tags.push({ key: 'rel', text: rel.label, color: t === 'skill' ? 'var(--ag)' : 'var(--sk)' }); }
  if (roleText && !seen.has(roleText)) { seen.add(roleText); tags.push({ key: 'role', text: roleText }); }
  return tags.map((tag) => (
    <span key={tag.key} className="ttag" style={tag.color ? { color: tag.color } : undefined}>{tag.text}</span>
  ));
}

// 'workshop' role (2026-09-16 revamp) can participate exactly like staff+ can
// on this page — view + add stickers — but team/sticker rename-or-delete-any
// stays staff+ only (isStaffPlus below).
const WORKSHOP_VIEW_ROLES = ['admin', 'committee', 'staff', 'workshop'];
const WORKSHOP_TAG_ROLES = ['admin', 'committee', 'staff', 'workshop'];

// Status pipeline (2026-09-17) — replaces the old flat pain/improvement
// `kind` tag for Workshop-tab stickers only. Sequential, one step at a time,
// enforced both here (UI) and in firestore.rules (the real boundary).
const STATUS_ORDER = ['idea', 'dev', 'qa', 'done'];
// Display label only — the underlying status VALUE stays 'qa' (Firestore
// field + rules transition checks unaffected by this rename).
const STATUS_LABEL = { idea: 'Idea', dev: 'Dev', qa: 'Review', done: 'Done' };
const STATUS_COLOR = { idea: '#f03a16', dev: '#fad42d', qa: '#a1e312', done: '#1aacf0' };

function nextStatus(status) {
  const idx = STATUS_ORDER.indexOf(status);
  return idx >= 0 && idx < STATUS_ORDER.length - 1 ? STATUS_ORDER[idx + 1] : null;
}

// Rich Workshop-tab sticker: filled circle showing the team's 2-digit
// number, colored by the idea's current status. Click opens the detail popup.
function WorkshopStickers({ ideas, teams, canAdd, onAdd, onOpen }) {
  return (
    <div className="ws-stickers-row" onClick={(e) => e.stopPropagation()}>
      {ideas.map((idea) => {
        const team = teams.find((t) => t.id === idea.teamId);
        return (
          <button
            key={idea.id}
            type="button"
            className="ws-sticker"
            style={{ background: STATUS_COLOR[idea.status] || STATUS_COLOR.idea }}
            title={`${idea.team} — ${idea.ideaName}`}
            onClick={() => onOpen(idea)}
          >
            {team?.number || '??'}
          </button>
        );
      })}
      {canAdd && (
        <button type="button" className="ws-sticker-add" title="Add sticker" onClick={onAdd}>+</button>
      )}
    </div>
  );
}

// Anonymous Ideation-tab sticker: plain colored dot, no border/letter/popup.
// Hover reveals a faint × (only for permitted viewers) that deletes instantly.
// NOTE: this tab is hidden from the nav this round (kept fully working in
// code, just unreachable) — do not delete.
function IdeationStickers({ stickers, canAdd, canDelete, pickerOpen, onTogglePicker, onPick, onDelete }) {
  return (
    <div className="ws-stickers-row" onClick={(e) => e.stopPropagation()}>
      {stickers.map((s) => (
        <span key={s.id} className={`ws-ideation-dot ${s.kind}`}>
          {canDelete(s) && (
            <button type="button" className="ws-ideation-x" title="Remove" onClick={() => onDelete(s)}>×</button>
          )}
        </span>
      ))}
      {canAdd && (
        <div className="ws-ideation-picker-wrap">
          <button type="button" className="ws-sticker-add" title="Add sticker" onClick={onTogglePicker}>+</button>
          {pickerOpen && (
            <div className="ws-ideation-picker" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="ws-ideation-dot pain pick" title="Pain point" onClick={() => onPick('pain')} />
              <button type="button" className="ws-ideation-dot improvement pick" title="Improvement" onClick={() => onPick('improvement')} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 4-step connected status bar. Only the single next step is ever clickable
// (canAdvance gates whether the viewer may click at all; sequencing/skip
// prevention itself is enforced by firestore.rules, this is UI convenience).
function StatusProgressBar({ idea, canAdvance, onAdvance }) {
  const [showDoneForm, setShowDoneForm] = useState(false);
  const [skillNameInput, setSkillNameInput] = useState('');
  const curIdx = STATUS_ORDER.indexOf(idea.status);
  const target = nextStatus(idea.status);

  function handleStepClick(step, idx) {
    if (!canAdvance || idx !== curIdx + 1) return;
    if (step === 'done') { setShowDoneForm(true); return; }
    onAdvance(step);
  }

  return (
    <div className="ws-statusbar-wrap">
      <div className="ws-statusbar">
        {STATUS_ORDER.map((step, idx) => {
          const reached = idx <= curIdx;
          const clickable = canAdvance && idx === curIdx + 1;
          return (
            <div key={step} className="ws-status-step">
              {idx > 0 && <div className={`ws-status-line ${idx <= curIdx ? 'on' : ''}`} style={reached ? { background: STATUS_COLOR[step] } : undefined} />}
              <button
                type="button"
                className={`ws-status-dot ${reached ? 'on' : ''} ${clickable ? 'clickable' : ''}`}
                style={reached ? { background: STATUS_COLOR[step], borderColor: STATUS_COLOR[step] } : undefined}
                disabled={!clickable}
                title={STATUS_LABEL[step]}
                onClick={() => handleStepClick(step, idx)}
              />
              <span className="ws-status-lbl">{STATUS_LABEL[step]}</span>
            </div>
          );
        })}
      </div>
      {showDoneForm && target === 'done' && (
        <div className="ws-done-form">
          <label className="ws-flabel">Skill name</label>
          <input
            type="text"
            className="ws-input"
            value={skillNameInput}
            onChange={(e) => setSkillNameInput(e.target.value)}
            placeholder="Name this skill before marking it Done"
            autoFocus
          />
          <div className="ws-mactions">
            <button type="button" className="btn btn-secondary" onClick={() => { setShowDoneForm(false); setSkillNameInput(''); }}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!skillNameInput.trim()}
              onClick={() => { onAdvance('done', skillNameInput.trim()); setShowDoneForm(false); }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StickerDetailPopup({ idea, canEdit, canDelete, canAdvance, onClose, onEdit, onDelete, onAdvance, onRegister }) {
  return (
    <div className="ws-ovl" onClick={onClose}>
      <div className="ws-popup" onClick={(e) => e.stopPropagation()}>
        <div className="ws-sticker ws-popup-sticker" style={{ background: STATUS_COLOR[idea.status] || STATUS_COLOR.idea }} />
        <button className="ws-mclose" onClick={onClose}>✕</button>
        <div className="ws-popup-body">
          <div className="ws-popup-row"><span className="ws-popup-label">Team</span><span>{idea.team}</span></div>
          <div className="ws-popup-row"><span className="ws-popup-label">Description</span><span>{idea.ideaName}</span></div>
        </div>
        <StatusProgressBar idea={idea} canAdvance={canAdvance} onAdvance={onAdvance} />
        {idea.status === 'done' && (
          <button type="button" className="ws-register-link" onClick={onRegister}>Register for AI Library →</button>
        )}
        {(canEdit || canDelete) && (
          <div className="ws-popup-actions">
            {canEdit && <button type="button" className="ws-icon-btn" title="Edit" onClick={onEdit}>✎</button>}
            {canDelete && <button type="button" className="ws-icon-btn" title="Delete" onClick={onDelete}>🗑</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function AddIdeaModal({ proc, teamOptions, initial, onClose, onSubmit }) {
  const [team, setTeam] = useState(initial?.team || '');
  const [ideaName, setIdeaName] = useState(initial?.ideaName || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const isEdit = !!initial;

  async function handleSubmit() {
    if (!team.trim() || !ideaName.trim()) { setErr('Team and Skill short description are required.'); return; }
    // Autocomplete lets the user type-to-filter, but team creation is
    // admin-only now (Team & User Management panel) — so the typed value
    // must resolve to an existing team, not just be non-empty.
    const matchedTeam = teamOptions.find((t) => t.toLowerCase() === team.trim().toLowerCase());
    if (!matchedTeam) { setErr('Please select an existing team from the list.'); return; }
    setSaving(true);
    setErr('');
    try {
      await onSubmit({ team: matchedTeam, ideaName: ideaName.trim().slice(0, 100) });
      onClose();
    } catch (e) {
      setErr(e?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ws-ovl" onClick={onClose}>
      <div className="ws-mbox" onClick={(e) => e.stopPropagation()}>
        <button className="ws-mclose" onClick={onClose}>✕</button>
        <div className="ws-mtitle">{proc.id} — {proc.name}</div>

        <label className="ws-flabel">Team</label>
        {/* Type-to-filter autocomplete, but NOT free-add — team creation is
            admin-only now (Team & User Management panel's "+ Add team"), so
            handleSubmit() rejects any value that doesn't exactly match an
            existing team name. */}
        <ComboInput value={team} onChange={setTeam} options={teamOptions} placeholder="Type to search for your team" hideAddHint />

        <label className="ws-flabel">Skill short description</label>
        <span className="ws-hint ws-hint-block">e.g. "Auto-generates test data from a schema so QA doesn't have to hand-write fixtures"</span>
        <input
          type="text"
          className="ws-input"
          value={ideaName}
          maxLength={100}
          onChange={(e) => setIdeaName(e.target.value.slice(0, 100))}
          placeholder="e.g. Auto Test Data Generator"
        />
        <span className="ws-hint">{ideaName.length}/100</span>

        {err && <div className="ws-err">{err}</div>}
        <div className="ws-mactions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSubmit}>
            {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function TeamUserManagerModal({ teams, workshopUsers, onClose, onRename, onDelete, onAddTeam, onAddMember, onRemoveMember }) {
  const [editing, setEditing] = useState(null); // { id, name }
  const [expanded, setExpanded] = useState(null); // team id
  const [memberPickText, setMemberPickText] = useState('');
  const [newTeamName, setNewTeamName] = useState('');
  const [addingTeam, setAddingTeam] = useState(false);
  const [addTeamErr, setAddTeamErr] = useState('');

  async function handleAddTeamClick() {
    setAddingTeam(true);
    setAddTeamErr('');
    try {
      await onAddTeam(newTeamName);
      setNewTeamName('');
    } catch (e) {
      setAddTeamErr(e?.message || 'Could not add team.');
    } finally {
      setAddingTeam(false);
    }
  }

  return (
    <div className="ws-ovl" onClick={onClose}>
      <div className="ws-mbox" onClick={(e) => e.stopPropagation()}>
        <button className="ws-mclose" onClick={onClose}>✕</button>
        <div className="ws-mtitle">Team &amp; User Management</div>

        <div className="ws-team-add-row">
          <input
            className="ws-input"
            style={{ height: 32 }}
            placeholder="New team name…"
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
          />
          <button type="button" className="btn-sm appr" disabled={!newTeamName.trim() || addingTeam} onClick={handleAddTeamClick}>
            {addingTeam ? 'Adding…' : '+ Add team'}
          </button>
        </div>
        {addTeamErr && <div className="ws-err">{addTeamErr}</div>}

        {teams.length === 0 && <div className="ws-hint">No teams yet.</div>}
        {teams.map((t) => {
          const memberIds = t.members || [];
          const memberNames = t.memberNames || {};
          const eligible = workshopUsers.filter((u) => !memberIds.includes(u.uid));
          const eligibleLabel = (u) => `${u.displayName || u.email} (${u.email})`;
          return (
            <div key={t.id} className="ws-team-block">
              <div className="ws-team-row">
                {editing?.id === t.id ? (
                  <input
                    className="ws-input"
                    style={{ height: 32 }}
                    value={editing.name}
                    onChange={(e) => setEditing({ id: t.id, name: e.target.value })}
                    autoFocus
                  />
                ) : (
                  <span className="ws-team-name">#{t.number || '??'} — {t.name}</span>
                )}
                <div className="ws-team-actions">
                  {editing?.id === t.id ? (
                    <>
                      <button type="button" className="btn-sm rej" onClick={() => setEditing(null)}>Cancel</button>
                      <button
                        type="button"
                        className="btn-sm appr"
                        onClick={() => { onRename(t, editing.name); setEditing(null); }}
                      >
                        Save
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn-sm rej" onClick={() => setExpanded((cur) => (cur === t.id ? null : t.id))}>
                        {expanded === t.id ? 'Hide members' : `Members (${memberIds.length})`}
                      </button>
                      <button type="button" className="btn-sm rej" onClick={() => setEditing({ id: t.id, name: t.name })}>Rename</button>
                      <button type="button" className="btn-sm rej" onClick={() => onDelete(t)}>Delete</button>
                    </>
                  )}
                </div>
              </div>
              {expanded === t.id && (
                <div className="ws-member-panel">
                  <div className="ws-member-chips">
                    {memberIds.length === 0 && <span className="ws-hint">No members yet.</span>}
                    {memberIds.map((uid) => (
                      <span key={uid} className="ws-member-chip">
                        {memberNames[uid] || uid}
                        <button type="button" onClick={() => onRemoveMember(t, uid)} title="Remove">×</button>
                      </span>
                    ))}
                  </div>
                  <div className="ws-member-add">
                    <ComboInput
                      value={memberPickText}
                      onChange={setMemberPickText}
                      options={eligible.map(eligibleLabel)}
                      placeholder="Type name or email…"
                    />
                    <button
                      type="button"
                      className="btn-sm appr"
                      disabled={!memberPickText.trim()}
                      onClick={() => {
                        const match = eligible.find((u) => eligibleLabel(u) === memberPickText);
                        if (match) onAddMember(t, match);
                        setMemberPickText('');
                      }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function WorkshopPage() {
  const { user, role, loading, roleReady, domainError, signIn } = useAuth();
  const canView = !!user && WORKSHOP_VIEW_ROLES.includes(role);
  const canParticipate = !!user && WORKSHOP_TAG_ROLES.includes(role);
  const isStaffPlus = !!user && ['admin', 'committee', 'staff'].includes(role);
  const isAdmin = role === 'admin';
  const [signInError, setSignInError] = useState('');

  async function handleSignIn() {
    setSignInError('');
    try {
      await signIn();
    } catch (e) {
      setSignInError(e.message);
    }
  }

  // Direct visits to /workshop: signing in happens in place (popup) on this
  // same URL, so a signed-in workshop-capable user just re-renders into the
  // board. Anyone without Workshop access (plain user/approver/no role) is
  // sent to the main Library instead of a dead-end.
  useEffect(() => {
    if (roleReady && user && !domainError && !canView) window.location.replace('/');
  }, [roleReady, user, domainError, canView]);

  // Workshop page is always light-mode only, independent of the site-wide
  // theme preference (which lives in localStorage `agentlib-theme` and is
  // left untouched here — this only patches the DOM attribute for as long as
  // this page is mounted).
  useEffect(() => {
    const prev = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = 'light';
    return () => {
      if (prev === undefined) delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = prev;
    };
  }, []);

  const { agents } = useApprovedAgents(canView);
  const { schema, addRelatedRoles, addTeams } = useConfigSchema(canView);
  const [processes, setProcesses] = useState([]);
  const [useCases, setUseCases] = useState([]);
  const [ideas, setIdeas] = useState([]);
  const [ideationStickers, setIdeationStickers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  // Ideation tab is hidden from the nav this round but its state/logic stays
  // fully intact and reachable in code — default stays 'workshop'.
  const [activeTab, setActiveTab] = useState('workshop'); // 'ideation' | 'workshop' | 'ucs'
  const [expandedDesc, setExpandedDesc] = useState(new Set());
  const [addModalProc, setAddModalProc] = useState(null);
  const [editIdea, setEditIdea] = useState(null);
  const [detailIdea, setDetailIdea] = useState(null);
  const [ideationPicker, setIdeationPicker] = useState(null); // processId or null
  const [showTeamMgr, setShowTeamMgr] = useState(false);
  const [workshopUsers, setWorkshopUsers] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [ucSearch, setUcSearch] = useState('');
  const [showPreReg, setShowPreReg] = useState(false);
  const [preRegPrefill, setPreRegPrefill] = useState(null);

  useEffect(() => {
    if (!canView) return;
    let active = true;
    (async () => {
      try {
        const [procSnap, ucSnap] = await Promise.all([
          getDocs(collection(db, 'sdlcProcesses')),
          getDocs(collection(db, 'sdlcUseCases')),
        ]);
        if (!active) return;
        setProcesses(procSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setUseCases(ucSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } finally {
        if (active) setDataLoading(false);
      }
    })();
    return () => { active = false; };
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    const unsub = onSnapshot(query(collection(db, 'workshopIdeas'), orderBy('createdAt', 'asc')), (snap) => {
      setIdeas(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    const unsub = onSnapshot(query(collection(db, 'ideationStickers'), orderBy('createdAt', 'asc')), (snap) => {
      setIdeationStickers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    const unsub = onSnapshot(query(collection(db, 'workshopTeams'), orderBy('createdAt', 'asc')), (snap) => {
      setTeams(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [canView]);

  // /users listener scoped to only run while the admin-only Team & User
  // Management panel is open (mirrors UserManagementModal.jsx's own pattern),
  // filtered to workshop-eligible roles for the member picker.
  useEffect(() => {
    if (!showTeamMgr || !isAdmin) { setWorkshopUsers([]); return; }
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const all = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      setWorkshopUsers(all.filter((u) => ['workshop', 'staff', 'committee', 'admin'].includes(u.role)));
    });
    return unsub;
  }, [showTeamMgr, isAdmin]);

  const agentCount = useMemo(() => agents.filter((a) => getType(a) === 'agent').length, [agents]);
  const skillCount = useMemo(() => agents.filter((a) => getType(a) === 'skill').length, [agents]);

  const agentsForProcess = (procId) => agents.filter((a) => agentProcessIds(a).includes(procId));
  const agentsForUC = (uc) => agents.filter((a) => {
    const names = agentUseCaseNames(a);
    if (!names.some((n) => n.toLowerCase() === uc.name.toLowerCase())) return false;
    const pids = agentProcessIds(a);
    if (pids.length === 0) return true;
    return pids.includes(uc.processId);
  });
  const ideasForProcess = (procId) => ideas.filter((i) => i.processId === procId);
  const ideationForProcess = (procId) => ideationStickers.filter((s) => s.processId === procId);

  function toggleDesc(procId) {
    setExpandedDesc((prev) => {
      const next = new Set(prev);
      if (next.has(procId)) next.delete(procId); else next.add(procId);
      return next;
    });
  }

  // Creates a brand-new workshopTeams doc + claims its number. The one place
  // both ensureTeam() (implicit creation via idea submission) and the
  // explicit "+ Add team" control in TeamUserManagerModal call, so
  // claimNextTeamNumber() is only ever invoked from here.
  async function createTeamDoc(name) {
    const created = await addDoc(collection(db, 'workshopTeams'), {
      name,
      createdBy: user.uid,
      createdByName: user.displayName || user.email || '',
      createdAt: serverTimestamp(),
    });
    const number = await claimNextTeamNumber();
    await updateDoc(created, { number });
    return created.id;
  }

  // Returns the team's doc id (existing match or newly created doc), so the
  // caller can attach `teamId` to the idea payload.
  async function ensureTeam(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const existing = teams.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) return existing.id;
    return createTeamDoc(trimmed);
  }

  // Explicit "+ Add team" action from the admin panel — unlike ensureTeam()'s
  // tolerant dedupe (meant for the implicit sticker-submission path), a
  // deliberate "create" click on a name that already exists should surface
  // an error rather than silently no-op onto the existing team.
  async function handleAddTeam(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    if (teams.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('A team with this name already exists.');
    }
    await createTeamDoc(trimmed);
  }

  // Single source of truth for team-number assignment — used by both the
  // auto-create-on-submit path (ensureTeam above) and any future explicit
  // "create team" admin UI, so the counter logic is never duplicated.
  async function claimNextTeamNumber() {
    const counterRef = doc(db, 'config', 'workshopTeamCounter');
    const n = await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      const cur = snap.exists() ? (snap.data().next || 1) : 1;
      tx.set(counterRef, { next: cur + 1 }, { merge: true });
      return cur;
    });
    return String(n).padStart(2, '0');
  }

  async function handleSubmitIdea(proc, payload) {
    const teamId = await ensureTeam(payload.team);
    await addDoc(collection(db, 'workshopIdeas'), {
      processId: proc.id,
      ...payload,
      teamId,
      status: 'idea',
      createdBy: user.uid,
      createdByName: user.displayName || user.email || '',
      createdAt: serverTimestamp(),
    });
  }

  async function handleUpdateIdea(idea, payload) {
    const teamId = await ensureTeam(payload.team);
    await updateDoc(doc(db, 'workshopIdeas', idea.id), { ...payload, teamId, updatedAt: serverTimestamp() });
  }

  function canEditIdea(idea) {
    return isStaffPlus || (!!user && canParticipate && idea.createdBy === user.uid);
  }
  const canDeleteIdea = canEditIdea;

  // Who may advance an idea's status: staff+, its creator, or a member of
  // the idea's team (admin-managed roster — see TeamUserManagerModal).
  function canAdvanceStatus(idea) {
    if (!user) return false;
    if (isStaffPlus) return true;
    if (idea.createdBy === user.uid) return true;
    const t = teams.find((t2) => t2.id === idea.teamId);
    return !!t && (t.members || []).includes(user.uid);
  }

  // updateDoc payload here must match the rules' status-transition branch
  // exactly (`affectedKeys().hasOnly(['status','skillName','updatedAt'])`) —
  // never spread extra fields into this call.
  async function handleAdvanceStatus(idea, status, skillName) {
    const payload = { status, updatedAt: serverTimestamp() };
    if (status === 'done') payload.skillName = skillName;
    await updateDoc(doc(db, 'workshopIdeas', idea.id), payload);
    setDetailIdea((cur) => (cur && cur.id === idea.id ? { ...cur, ...payload } : cur));
  }

  function openPreRegForIdea(idea) {
    setPreRegPrefill({ agentName: idea.skillName || '', description: idea.ideaName || '', owner: idea.team || '' });
    setShowPreReg(true);
    setDetailIdea(null);
  }

  async function handleDeleteIdea(idea) {
    if (!window.confirm(`Delete sticker "${idea.ideaName}" (team ${idea.team})?`)) return;
    await deleteDoc(doc(db, 'workshopIdeas', idea.id));
    setDetailIdea(null);
  }

  function canDeleteIdeation(s) {
    return isStaffPlus || (!!user && s.createdBy === user.uid);
  }

  async function addIdeationSticker(procId, kind) {
    await addDoc(collection(db, 'ideationStickers'), {
      processId: procId,
      kind,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
    });
  }

  // No confirm dialog here by design — Ideation stickers carry no data, so
  // an accidental delete costs nothing and the spec calls for instant delete.
  async function deleteIdeationSticker(s) {
    await deleteDoc(doc(db, 'ideationStickers', s.id));
  }

  async function renameTeam(team, newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed || trimmed === team.name) return;
    await updateDoc(doc(db, 'workshopTeams', team.id), { name: trimmed });
    const affected = ideas.filter((i) => i.team === team.name);
    if (affected.length) {
      const batch = writeBatch(db);
      affected.forEach((i) => batch.update(doc(db, 'workshopIdeas', i.id), { team: trimmed }));
      await batch.commit();
    }
  }

  async function deleteTeam(team) {
    if (!window.confirm(`Delete team "${team.name}"? Existing stickers keep their current team name.`)) return;
    await deleteDoc(doc(db, 'workshopTeams', team.id));
  }

  async function addTeamMember(team, memberUser) {
    const members = [...new Set([...(team.members || []), memberUser.uid])];
    const memberNames = { ...(team.memberNames || {}), [memberUser.uid]: memberUser.displayName || memberUser.email || memberUser.uid };
    await updateDoc(doc(db, 'workshopTeams', team.id), { members, memberNames });
  }

  async function removeTeamMember(team, uid) {
    const members = (team.members || []).filter((m) => m !== uid);
    const memberNames = { ...(team.memberNames || {}) };
    delete memberNames[uid];
    await updateDoc(doc(db, 'workshopTeams', team.id), { members, memberNames });
  }

  function ProcessCard({ proc }) {
    const ags = agentsForProcess(proc.id);
    const counts = { td: 0, ip: 0, pilot: 0, ru: 0 };
    ags.forEach((a) => { counts[agentStatus(withProgress(a))]++; });
    const dominant = dominantStatus(counts);
    const empty = ags.length === 0;
    const breakdown = PRIORITY.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${ST_DEF[s].lb}`).join(', ');
    const descOpen = expandedDesc.has(proc.id);

    return (
      <div className={`aproc ${dominant}${empty ? ' empty' : ''} ws-card`}>
        <div className="aproc-num">{proc.id}</div>
        <div className="aproc-name">
          {proc.name}
          {proc.description && (
            <button
              type="button"
              className="ws-caret"
              title="Show description"
              onClick={(e) => { e.stopPropagation(); toggleDesc(proc.id); }}
            >
              {descOpen ? '▲' : '▼'}
            </button>
          )}
        </div>
        {descOpen && proc.description && <p className="ws-desc">{proc.description}</p>}
        <div className="aproc-count">
          {empty ? <span style={{ color: '#9ca3af' }}>No agents</span> : `${STATUS_ICON[dominant]} ${breakdown}`}
        </div>

        {activeTab === 'workshop' ? (
          <WorkshopStickers
            ideas={ideasForProcess(proc.id)}
            teams={teams}
            canAdd={canParticipate}
            onAdd={() => setAddModalProc(proc)}
            onOpen={(idea) => setDetailIdea(idea)}
          />
        ) : (
          <IdeationStickers
            stickers={ideationForProcess(proc.id)}
            canAdd={canParticipate}
            canDelete={canDeleteIdeation}
            pickerOpen={ideationPicker === proc.id}
            onTogglePicker={() => setIdeationPicker((cur) => (cur === proc.id ? null : proc.id))}
            onPick={(kind) => { addIdeationSticker(proc.id, kind); setIdeationPicker(null); }}
            onDelete={deleteIdeationSticker}
          />
        )}
      </div>
    );
  }

  function UCCard({ uc }) {
    const ags = agentsForUC(uc);
    const proc = processes.find((p) => p.id === uc.processId);
    const procColor = STAGE_COLOR[proc?.stage] || '#7a85a3';
    const cov = ags.length > 0;
    const ucIdeas = ideasForProcess(uc.processId).filter((i) => i.useCaseId === uc.id);
    return (
      <div className={`uc-card ${cov ? 'cov' : 'emp'}`}>
        <div className="uc-meta">
          <span className="uc-id">{uc.processId}</span>
          <span className="uc-proc" style={{ background: `${procColor}15`, color: procColor, border: `1px solid ${procColor}30` }}>
            {uc.processName}
          </span>
        </div>
        {proc?.owner && <div className="uc-powner">Process Owner: {proc.owner}</div>}
        <div className="uc-name">{uc.name}</div>
        {ucIdeas.length > 0 && (
          <WorkshopStickers ideas={ucIdeas} teams={teams} canAdd={false} onAdd={() => {}} onOpen={(idea) => setDetailIdea(idea)} />
        )}
        <div className="uc-alist">
          {ags.length > 0 ? ags.map((a) => {
            const t = getType(a);
            const progress = typeof a.devProgress === 'number' ? a.devProgress : 0;
            return (
              <div key={a.id} className={`uc-arow ${t}`} onClick={() => setSelectedAgent(a)} style={{ cursor: 'pointer' }}>
                <span className={`uc-tb ${t === 'agent' ? 'tbag' : 'tbsk'}`}>{t.toUpperCase()}</span>
                <div className="uc-abody">
                  <div className="uc-aname">{a.agentName}</div>
                  <div className="ac-progress-row" style={{ margin: '6px 0 0' }}>
                    <div className="ac-progress-track"><div className={`ac-progress-fill ${progressBucket(progress)}`} style={{ width: `${progress}%` }} /></div>
                    <span className="ac-progress-pct">{progress}%</span>
                  </div>
                </div>
              </div>
            );
          }) : <span className="uc-ecap"><span className="uc-edot" />No agent / skill yet</span>}
        </div>
      </div>
    );
  }

  function NoUseCaseCard({ agent: a }) {
    const t = getType(a);
    const rel = relationshipLabel(a, agents);
    const progress = typeof a.devProgress === 'number' ? a.devProgress : 0;
    return (
      <div className="uc-card" onClick={() => setSelectedAgent(a)} style={{ cursor: 'pointer' }}>
        <div className={`uc-arow ${t}`} style={{ background: 'transparent', border: 'none', padding: 0 }}>
          <span className={`uc-tb ${t === 'agent' ? 'tbag' : 'tbsk'}`}>{t.toUpperCase()}</span>
          <div className="uc-abody">
            <div className="uc-aname">{a.agentName}</div>
            <div className="uc-afoot">{tagRow(a, t, rel)}</div>
            <div className="ac-progress-row" style={{ margin: '6px 0 0' }}>
              <div className="ac-progress-track"><div className={`ac-progress-fill ${progressBucket(progress)}`} style={{ width: `${progress}%` }} /></div>
              <span className="ac-progress-pct">{progress}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderBoard() {
    return (
      <div className="adopt-board">
        {GROUPS.map((grp) => (
          <div key={grp.label} className="adopt-grp" style={{ flex: grp.sub.length }}>
            {!grp.merged && <div className="adopt-grp-hdr">{grp.label}</div>}
            <div className="adopt-sub-row">
              {grp.sub.map((sub) => {
                const procs = sortProcs(processes.filter((p) => p.stage === sub.stage));
                const subColor = STAGE_COLOR[sub.stage] || '#7a85a3';
                return (
                  <div key={sub.stage} className="adopt-subcol" style={{ flex: 1 }}>
                    {grp.merged ? (
                      <div className="adopt-grp-hdr adopt-grp-hdr--merged">{sub.label}</div>
                    ) : (
                      <div className="adopt-sub-hdr" style={{ background: `${subColor}18`, color: subColor, borderBottom: `2px solid ${subColor}40` }}>
                        {sub.label}
                      </div>
                    )}
                    <div className="adopt-cards">
                      {procs.map((proc) => <ProcessCard key={proc.id} proc={proc} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderUseCaseView() {
    const procToStage = {};
    processes.forEach((p) => { procToStage[p.id] = p.stage; });
    const groups = ALL_STAGES
      .filter((s) => useCases.some((u) => procToStage[u.processId] === s))
      .map((s) => ({ key: s, label: s, color: STAGE_COLOR[s] || '#7a85a3' }));

    const trimmedSearch = ucSearch.trim();
    // buildAgentFilter's type-check is `type !== 'all' && ...` — omitting
    // `type` entirely (undefined !== 'all') would fail every agent, so it
    // must be passed explicitly even though this page never filters by type.
    const searchPred = trimmedSearch ? buildAgentFilter({ type: 'all', search: trimmedSearch }) : null;

    // Same definition as the main Library's "Missing Use Case" section
    // (SDLCTab.jsx noUseCaseOnly): has an SDLC process mapping that exists in
    // sdlcProcesses, but no use-case name matching any sdlcUseCases doc.
    const ucNameSet = new Set(useCases.map((u) => (u.name || '').toLowerCase()));
    const procIdSet = new Set(processes.map((p) => p.id));
    const missingUC = agents.filter((a) =>
      !agentUseCaseNames(a).some((n) => ucNameSet.has(n.toLowerCase()))
      && agentProcessIds(a).some((id) => procIdSet.has(id))
      && (!searchPred || searchPred(a))
    );

    const stageGroups = groups.map((g) => {
      const ucs = useCases
        .filter((u) => procToStage[u.processId] === g.key)
        .filter((u) => !searchPred || agentsForUC(u).some(searchPred));
      if (!ucs.length) return null;
      return (
        <div key={g.key} className="sb">
          <div className="sh">
            <div className="sbar" style={{ background: g.color }} />
            <span className="sname" style={{ color: g.color }}>{g.label}</span>
            <span className="sbadge">{ucs.length} UC</span>
          </div>
          <div className="uc-grid">
            {ucs.map((u) => <UCCard key={u.id} uc={u} />)}
          </div>
        </div>
      );
    }).filter(Boolean);

    if (missingUC.length > 0) {
      stageGroups.push(
        <div key="__no_use_case__" className="sb">
          <div className="sh">
            <div className="sbar" style={{ background: '#8c6b45' }} />
            <span className="sname" style={{ color: '#8c6b45' }}>Missing Use Case</span>
            <span className="sbadge">{missingUC.length} items</span>
            <span className="scov">มี Stage/Process แล้ว แต่ยังไม่ระบุ Use Case</span>
          </div>
          <div className="uc-grid">
            {missingUC.map((a) => <NoUseCaseCard key={a.id} agent={a} />)}
          </div>
        </div>
      );
    }
    return stageGroups;
  }

  if (loading) return <div className="tl-center"><div className="spin" /><span>กำลังโหลด…</span></div>;
  if (!user) return <LoginScreen onSignIn={handleSignIn} error={signInError} />;
  if (domainError) {
    return (
      <LoginScreen
        onSignIn={handleSignIn}
        error={`อีเมลนี้ไม่อยู่ใน domain ที่อนุญาต (${ALLOWED_DOMAINS_LABEL})`}
      />
    );
  }
  if (!roleReady) return <div className="tl-center"><div className="spin" /><span>กำลังตรวจสิทธิ์…</span></div>;
  if (!canView) {
    return (
      <div className="tl-center">
        <h2>ไม่มีสิทธิ์เข้าถึง</h2>
        <p style={{ color: 'var(--mu)', fontSize: 13 }}>บัญชี {user.email} ไม่มีสิทธิ์เข้าหน้า Workshop</p>
      </div>
    );
  }

  const teamOptions = teams.map((t) => t.name);

  return (
    <div>
      <nav className="nav">
        <div className="nav-brand" role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => { window.location.href = '/'; }}>
          <div>
            <h1>AI Agent Library</h1>
            <p>Powered by Wolfy</p>
          </div>
        </div>
        <div className="nav-tabs">
          <button className={`nav-tab ${activeTab === 'workshop' ? 'active' : ''}`} onClick={() => setActiveTab('workshop')}>Workshop</button>
          <button className={`nav-tab ${activeTab === 'ucs' ? 'active' : ''}`} onClick={() => setActiveTab('ucs')}>Use Cases</button>
        </div>
        {activeTab === 'ucs' && (
          <div className="ws-search">
            <div className="ws-search-wrap">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="ws-search-inp"
                placeholder="Search by agent or skill name…"
                value={ucSearch}
                onChange={(e) => setUcSearch(e.target.value)}
              />
            </div>
          </div>
        )}
        <div className="nav-r" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {isAdmin && (
            <button type="button" className="ws-icon-btn ws-nav-icon-btn" title="Team & User Management" onClick={() => setShowTeamMgr(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </button>
          )}
          <div className="chips">
            <div className="chip c-ag"><div className="n">{agentCount}</div><div className="l">Agents</div></div>
            <div className="chip c-sk"><div className="n">{skillCount}</div><div className="l">Skills</div></div>
          </div>
        </div>
      </nav>

      <div className="sdlc-tab">
        {dataLoading ? (
          <div className="sdlc-empty">Loading…</div>
        ) : (
          <div className="adopt-scroll">
            {activeTab === 'ucs' ? renderUseCaseView() : renderBoard()}
          </div>
        )}
      </div>

      {activeTab === 'ucs' && (
        <ChatAssistant
          approvedAgents={agents}
          allAgents={agents}
          onOpenPreReg={() => { setPreRegPrefill(null); setShowPreReg(true); }}
          onOpenAgent={setSelectedAgent}
        />
      )}

      {addModalProc && (
        <AddIdeaModal
          proc={addModalProc}
          teamOptions={teamOptions}
          onClose={() => setAddModalProc(null)}
          onSubmit={(payload) => handleSubmitIdea(addModalProc, payload)}
        />
      )}

      {editIdea && (
        <AddIdeaModal
          proc={{ id: editIdea.processId, name: processes.find((p) => p.id === editIdea.processId)?.name || '' }}
          teamOptions={teamOptions}
          initial={editIdea}
          onClose={() => setEditIdea(null)}
          onSubmit={(payload) => handleUpdateIdea(editIdea, payload)}
        />
      )}

      {detailIdea && (
        <StickerDetailPopup
          idea={detailIdea}
          canEdit={canEditIdea(detailIdea)}
          canDelete={canDeleteIdea(detailIdea)}
          canAdvance={canAdvanceStatus(detailIdea)}
          onClose={() => setDetailIdea(null)}
          onEdit={() => { setEditIdea(detailIdea); setDetailIdea(null); }}
          onDelete={() => handleDeleteIdea(detailIdea)}
          onAdvance={(status, skillName) => handleAdvanceStatus(detailIdea, status, skillName)}
          onRegister={() => openPreRegForIdea(detailIdea)}
        />
      )}

      {showTeamMgr && isAdmin && (
        <TeamUserManagerModal
          teams={teams}
          workshopUsers={workshopUsers}
          onClose={() => setShowTeamMgr(false)}
          onRename={renameTeam}
          onDelete={deleteTeam}
          onAddTeam={handleAddTeam}
          onAddMember={addTeamMember}
          onRemoveMember={removeTeamMember}
        />
      )}

      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          allAgents={agents}
          onClose={() => setSelectedAgent(null)}
          user={user}
          userRole={role}
          isAdmin={false}
          onEditAgent={undefined}
          approveAreas={[]}
          schema={{}}
        />
      )}

      {showPreReg && (
        <PreRegModal
          onClose={() => setShowPreReg(false)}
          approvedAgents={agents}
          allAgents={agents}
          schema={schema}
          user={user}
          onSubmitted={() => setShowPreReg(false)}
          onAddRelatedRole={addRelatedRoles}
          onAddTeam={addTeams}
          prefill={preRegPrefill}
        />
      )}
    </div>
  );
}
