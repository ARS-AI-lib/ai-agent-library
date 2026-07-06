import { useState } from 'react';

// Firestore Timestamp | Date | string → 'YYYY-MM-DD' for <input type=date>.
function toDateInput(v) {
  if (!v) return '';
  try {
    const d = v.toDate ? v.toDate() : new Date(v);
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

let seq = 0;
const uid = () => `ms-${Date.now().toString(36)}-${seq++}`;

// Add / edit / delete milestones. Milestones are stored on /config/timeline
// as an array of { id, name, start, end, color } (dates persisted as ISO
// strings; the timeline's toDate() reads them back). Save writes the whole
// array at once (small N).
export default function MilestoneEditor({ milestones, defaultColors, onSave, onClose }) {
  const [rows, setRows] = useState(() =>
    (milestones || []).map((m) => ({
      id: m.id || uid(),
      name: m.name || '',
      start: toDateInput(m.start),
      end: toDateInput(m.end),
      color: m.color || defaultColors[0],
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function setRow(id, patch) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, { id: uid(), name: `M${rs.length + 1}`, start: '', end: '', color: defaultColors[rs.length % defaultColors.length] }]);
  }
  function removeRow(id) {
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  async function handleSave() {
    for (const r of rows) {
      if (!r.name.trim()) { setError('ทุก milestone ต้องมีชื่อ'); return; }
      if (!r.start || !r.end) { setError(`"${r.name}" ต้องมีวันเริ่มและวันสิ้นสุด`); return; }
      if (new Date(r.start) > new Date(r.end)) { setError(`"${r.name}" วันเริ่มต้องไม่เกินวันสิ้นสุด`); return; }
    }
    setSaving(true);
    setError('');
    try {
      const next = rows.map((r) => ({
        id: r.id, name: r.name.trim(),
        start: new Date(r.start).toISOString(),
        end: new Date(r.end).toISOString(),
        color: r.color,
      }));
      await onSave(next);
      onClose();
    } catch (e) {
      setError(e.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox wide">
        <button className="mclose" onClick={onClose}>✕</button>
        <div className="mtitle">Manage Milestones</div>
        <div className="msub">เพิ่ม / แก้ไข / ลบ ช่วง milestone ในไทม์ไลน์</div>

        {error && <div className="msg error"><span className="dot" style={{ background: '#ea4335' }} />{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {rows.length === 0 && <div className="empty-state" style={{ padding: 24 }}>ยังไม่มี milestone — กด "+ เพิ่ม" เพื่อสร้าง</div>}
          {rows.map((r) => (
            <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px 40px 32px', gap: 8, alignItems: 'end', padding: '10px 12px', border: '1px solid var(--bd-soft)', borderRadius: 'var(--r-md)', background: 'var(--sf2)' }}>
              <div>
                <div style={LB}>ชื่อ</div>
                <input value={r.name} onChange={(e) => setRow(r.id, { name: e.target.value })} style={CTRL} placeholder="เช่น M1 / Sprint 1" />
              </div>
              <div>
                <div style={LB}>เริ่ม</div>
                <input type="date" value={r.start} onChange={(e) => setRow(r.id, { start: e.target.value })} style={CTRL} />
              </div>
              <div>
                <div style={LB}>สิ้นสุด</div>
                <input type="date" value={r.end} onChange={(e) => setRow(r.id, { end: e.target.value })} style={CTRL} />
              </div>
              <div>
                <div style={LB}>สี</div>
                <input type="color" value={r.color} onChange={(e) => setRow(r.id, { color: e.target.value })} style={{ ...CTRL, padding: 0, height: 30, cursor: 'pointer' }} />
              </div>
              <button onClick={() => removeRow(r.id)} title="ลบ" style={{ height: 30, border: 'none', background: 'none', color: '#dc2626', fontSize: 16, cursor: 'pointer' }}>✕</button>
            </div>
          ))}
        </div>

        <div className="btn-group" style={{ marginTop: 14, justifyContent: 'space-between' }}>
          <button className="btn btn-secondary" onClick={addRow}>+ เพิ่ม Milestone</button>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-secondary" disabled={saving} onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? 'กำลังบันทึก…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const LB = { fontSize: 10, fontWeight: 700, color: 'var(--mu)', marginBottom: 3, letterSpacing: '.03em' };
const CTRL = { width: '100%', height: 30, padding: '0 8px', border: '1.5px solid var(--bd2)', borderRadius: 8, fontSize: 12, background: 'var(--sf)', color: 'var(--tx)', fontFamily: 'inherit', outline: 'none' };
