import { useEffect, useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useRoleGroups } from '../hooks/useRoleGroups';
import { getType } from '../lib/tier';
import TagMultiSelect from './TagMultiSelect';
import useEscapeKey from '../hooks/useEscapeKey';
import { classifyMissingRoleGroups } from '../lib/roleGroupClassify';
import '../styles/RoleGroupManager.css';

// Role Group Management (2026-09-24) — admin + committee only (App/Nav gate;
// the manageRoleGroups callable re-checks the role). Edits /config/roleGroups:
// add / rename / delete groups, which roles each group holds, the definition
// the AI classifier reads, card order, and single-item moves. Every write goes
// through the callable — this component never writes Firestore itself.
//
// What a change does and does NOT do (user decision):
// * Editing a group's roles/definition changes how NEW items get classified;
//   items already classified keep their group.
// * "Re-classify this group" is the explicit way to re-run AI on a group — it
//   only touches AI-set items; anything a person moved stays put.
// * Deleting a group requires a destination group for its items.

const call = (payload) => httpsCallable(getFunctions(), 'manageRoleGroups', { timeout: 300000 })(payload).then((r) => r.data);

export default function RoleGroupManagerModal({ onClose, agents = [], schema = {}, isAdmin = false }) {
  useEscapeKey(onClose);
  const rg = useRoleGroups();
  const [selKey, setSelKey] = useState(null); // null = nothing picked yet; '__new' = add form
  const [form, setForm] = useState({ label: '', roles: new Set(), definition: '' });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null); // { kind: 'ok'|'err', text }
  const [deleteTo, setDeleteTo] = useState(null); // destination key while the delete dialog is open

  const counts = useMemo(() => {
    const c = {};
    agents.forEach((a) => { if (a.roleGroup) c[a.roleGroup] = (c[a.roleGroup] || 0) + 1; });
    return c;
  }, [agents]);

  // Items with no (valid) stored group — normally 0: approvals classify on the
  // spot. Non-zero after a bulk import or a lost AI call; the banner below is
  // the safety net (admin only — the callable's missingOnly mode is admin-gated).
  const missing = agents.filter((a) => !rg.has(a.roleGroup)).length;

  const current = rg.groups.find((g) => g.key === selKey) || null;
  const isNew = selKey === '__new';

  useEffect(() => {
    if (!selKey && rg.groups.length) setSelKey(rg.groups[0].key);
  }, [selKey, rg.groups]);

  useEffect(() => {
    if (isNew) setForm({ label: '', roles: new Set(), definition: '' });
    else if (current) setForm({ label: current.label, roles: new Set(current.roles || []), definition: current.definition || '' });
    setDeleteTo(null);
  }, [selKey, current?.label, current?.definition, (current?.roles || []).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const roleOptions = useMemo(() => {
    const s = new Set(Array.isArray(schema.relatedRole) ? schema.relatedRole : []);
    rg.groups.forEach((g) => (g.roles || []).forEach((r) => s.add(r)));
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [schema.relatedRole, rg.groups]);

  const items = useMemo(
    () => (current ? agents.filter((a) => a.roleGroup === current.key).sort((a, b) => (a.agentName || '').localeCompare(b.agentName || '')) : []),
    [agents, current],
  );
  const aiSet = items.filter((a) => a.roleGroupSource !== 'admin').length;

  async function run(label, payload, after) {
    setBusy(label);
    setMsg(null);
    try {
      const r = await call(payload);
      setMsg({ kind: 'ok', text: after ? after(r) : 'Saved.' });
      return r;
    } catch (e) {
      setMsg({ kind: 'err', text: e?.message || String(e) });
      return null;
    } finally {
      setBusy('');
    }
  }

  const save = async () => {
    const group = { label: form.label.trim(), roles: [...form.roles], definition: form.definition.trim() };
    if (!isNew) group.key = current.key;
    const r = await run('save', { type: 'upsertGroup', group }, () => (isNew ? 'Group added.' : 'Group saved.'));
    if (r && isNew) setSelKey(r.groups.at(-1).key);
  };

  const move = (key, dir) => {
    const keys = [...rg.order];
    const i = keys.indexOf(key);
    const j = i + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    run('order', { type: 'reorder', keys }, () => 'Order saved.');
  };

  const doDelete = async () => {
    const r = await run('delete', { type: 'deleteGroup', key: current.key, moveTo: deleteTo }, () => `Group deleted · ${items.length} item(s) moved to ${rg.labelOf(deleteTo)}.`);
    if (r) setSelKey(deleteTo);
  };

  const reclassify = () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Re-classify "${current.label}"?\n\n${aiSet} AI-classified item(s) will be classified again with the current groups.\n${items.length - aiSet} item(s) moved by a person stay where they are.`)) return;
    run('reclassify', { type: 'reclassifyGroup', key: current.key }, (r) => `Re-classified ${r.reclassified} item(s) · ${r.keptAdminSet} kept.`);
  };

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox wide rgm">
        <button className="mclose" onClick={onClose}>✕</button>
        <div className="m-head">
          <div>
            <h2 className="mtitle">Role Group Management</h2>
            <p>กลุ่มบนการ์ด Role Coverage · แก้ role/คำอธิบายมีผลกับรายการใหม่ ส่วนรายการเดิมไม่ถูกย้ายเอง</p>
          </div>
        </div>

        {isAdmin && missing > 0 && (
          <div className="rgm-missing">
            <span><b>{missing}</b> รายการยังไม่ถูกจำแนกกลุ่ม (เช่น import ด้วยสคริปต์ หรือ AI เรียกไม่สำเร็จตอน approve) — ตอนนี้แสดงบนการ์ดด้วยการเดาจาก role ชั่วคราว</span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!!busy}
              onClick={async () => {
                setBusy('classify');
                setMsg(null);
                try {
                  const r = await classifyMissingRoleGroups();
                  setMsg({ kind: 'ok', text: `Classified ${r.classified} of ${r.requested} item(s).` });
                } catch (e) {
                  setMsg({ kind: 'err', text: e?.message || String(e) });
                } finally {
                  setBusy('');
                }
              }}
            >
              {busy === 'classify' ? 'Classifying…' : 'Classify Missing Items'}
            </button>
          </div>
        )}

        {msg && <div className={`rgm-msg ${msg.kind}`}>{msg.text}</div>}

        <div className="rgm-grid">
          <div className="rgm-list">
            {rg.groups.map((g, i) => (
              <div key={g.key} className={`rgm-row${g.key === selKey ? ' on' : ''}`}>
                <button type="button" className="rgm-pick" onClick={() => setSelKey(g.key)}>
                  <span>{g.label}</span><em>{counts[g.key] || 0}</em>
                </button>
                <button type="button" className="rgm-arrow" disabled={!!busy || i === 0} onClick={() => move(g.key, -1)} title="Move up">↑</button>
                <button type="button" className="rgm-arrow" disabled={!!busy || i === rg.groups.length - 1} onClick={() => move(g.key, 1)} title="Move down">↓</button>
              </div>
            ))}
            <button type="button" className={`rgm-add${isNew ? ' on' : ''}`} onClick={() => setSelKey('__new')}>+ Add Group</button>
          </div>

          <div className="rgm-edit">
            {(isNew || current) && (
              <>
                <div className="fg">
                  <label>Group Name</label>
                  <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Legal" />
                </div>
                <div className="fg">
                  <label>Roles in this Group</label>
                  <TagMultiSelect
                    options={roleOptions}
                    selected={form.roles}
                    onChange={(roles) => setForm((f) => ({ ...f, roles }))}
                  />
                  <p className="rgm-hint">ไม่สนตัวพิมพ์เล็ก/ใหญ่ เว้นวรรค หรือขีด · 1 role อยู่ได้กลุ่มเดียว</p>
                </div>
                <div className="fg">
                  <label>Definition for AI</label>
                  <textarea rows={3} value={form.definition} onChange={(e) => setForm((f) => ({ ...f, definition: e.target.value }))} placeholder="Who this group is — AI uses this to classify new items" />
                </div>
                <div className="rgm-actions">
                  <button type="button" className="btn btn-primary" disabled={!!busy} onClick={save}>{busy === 'save' ? 'Saving…' : isNew ? 'Add Group' : 'Save'}</button>
                  {!isNew && (
                    <>
                      <button type="button" className="btn btn-secondary" disabled={!!busy || !aiSet} onClick={reclassify}>{busy === 'reclassify' ? 'Re-classifying…' : 'Re-classify this Group'}</button>
                      <button type="button" className="btn btn-danger" disabled={!!busy || rg.groups.length < 2} onClick={() => setDeleteTo(rg.order.find((k) => k !== current.key))}>Delete Group</button>
                    </>
                  )}
                </div>

                {deleteTo && current && (
                  <div className="rgm-delete">
                    <p>ลบ <b>{current.label}</b> — ย้าย {items.length} รายการในกลุ่มนี้ไปที่:</p>
                    <select value={deleteTo} onChange={(e) => setDeleteTo(e.target.value)}>
                      {rg.groups.filter((g) => g.key !== current.key).map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                    </select>
                    <div className="rgm-actions">
                      <button type="button" className="btn btn-danger" disabled={!!busy} onClick={doDelete}>{busy === 'delete' ? 'Deleting…' : 'Move Items & Delete'}</button>
                      <button type="button" className="btn btn-secondary" onClick={() => setDeleteTo(null)}>Cancel</button>
                    </div>
                  </div>
                )}

                {!isNew && (
                  <div className="rgm-items">
                    <div className="rgm-items-h">Agents &amp; Skills in this Group ({items.length})</div>
                    {items.length === 0 && <div className="rgm-empty">ยังไม่มีรายการ</div>}
                    {items.map((a) => (
                      <div key={a.id} className="rgm-item">
                        <span className={`tb ${getType(a) === 'agent' ? 'tbag' : 'tbsk'}`}>{getType(a)}</span>
                        <span className="rgm-item-n" title={a.roleGroupReason || ''}>{a.agentName}</span>
                        {a.roleGroupSource === 'admin' && <span className="rgm-tag">moved</span>}
                        <select
                          value=""
                          disabled={!!busy}
                          onChange={(e) => e.target.value && run('move', { type: 'moveItem', agentId: a.id, to: e.target.value }, () => `Moved "${a.agentName}" to ${rg.labelOf(e.target.value)}.`)}
                        >
                          <option value="">Move to…</option>
                          {rg.groups.filter((g) => g.key !== current.key).map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
