import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useScreeningConfig } from '../hooks/useScreeningConfig';
import '../styles/Screening.css';

// Assessment Settings (2026-11-26) — committee/admin edit questions, options, scores, fix level and
// the per-option blocking flags. Saves through the manageScreeningConfig callable (clients cannot
// write /config). New ids are generated here and never reused; saving recomputes every
// non-archived result because results are always evaluated from the live config.
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clone = (v) => JSON.parse(JSON.stringify(v));
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const a = [...arr]; [a[i], a[j]] = [a[j], a[i]]; return a; };

export default function AssessmentSettingsModal({ onClose }) {
  const live = useScreeningConfig();
  const [draft, setDraft] = useState(() => clone(live));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const groups = [...new Set(draft.questions.map((q) => q.group).filter(Boolean))];

  const setQ = (qi, patch) => setDraft((d) => { const n = clone(d); Object.assign(n.questions[qi], patch); return n; });
  const setO = (qi, oi, patch) => setDraft((d) => { const n = clone(d); Object.assign(n.questions[qi].options[oi], patch); return n; });
  const addQ = () => setDraft((d) => ({ ...d, questions: [...d.questions, {
    id: uid('q'), code: `Q${d.questions.length + 1}`, stage: 'pre', group: groups[0] || '', th: '', en: '', advice: '',
    options: [{ id: uid('o'), th: '', en: '', score: 0, fix: 'none', blocksPre: false, blocksDeploy: false }],
  }] }));
  const addO = (qi) => setDraft((d) => { const n = clone(d); n.questions[qi].options.push({ id: uid('o'), th: '', en: '', score: 0, fix: 'none', blocksPre: false, blocksDeploy: false }); return n; });
  const delQ = (qi) => { if (window.confirm('ลบคำถามนี้? คำตอบเดิมของคำถามนี้จะไม่ถูกนับอีก')) setDraft((d) => ({ ...d, questions: d.questions.filter((_, i) => i !== qi) })); };
  const delO = (qi, oi) => { if (window.confirm('ลบตัวเลือกนี้? คำตอบเดิมที่เลือกตัวนี้จะขึ้นเป็น "(removed option)" และได้ 0 คะแนน')) setDraft((d) => { const n = clone(d); n.questions[qi].options.splice(oi, 1); return n; }); };

  async function save() {
    if (!window.confirm('บันทึกการตั้งค่า? ผล Assessment ที่ยังไม่ archive จะถูกคำนวณใหม่ตามค่าที่แก้')) return;
    setSaving(true); setMsg(null);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'manageScreeningConfig');
      const { data } = await fn({ action: 'save', config: draft });
      setMsg({ ok: true, text: `บันทึกแล้ว (version ${data.version})` });
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'บันทึกไม่สำเร็จ' });
    } finally { setSaving(false); }
  }

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox wide" style={{ padding: 18, maxHeight: '90vh', overflowY: 'auto' }}>
        <button className="mclose" onClick={onClose}>✕</button>
        <h2 className="mtitle">Assessment Settings</h2>
        <div className="msub">แก้คำถาม ตัวเลือก คะแนน และเงื่อนไขการบล็อก · มีผลกับ assessment ที่ยังไม่ archive ทั้งหมด</div>

        <div className="scr-grp">Level thresholds</div>
        <div className="grid2">
          <div className="fg"><label>Medium starts at</label>
            <input type="number" min="1" value={draft.thresholds.md} onChange={(e) => setDraft((d) => ({ ...d, thresholds: { ...d.thresholds, md: Number(e.target.value) } }))} /></div>
          <div className="fg"><label>High starts at</label>
            <input type="number" min="1" value={draft.thresholds.hi} onChange={(e) => setDraft((d) => ({ ...d, thresholds: { ...d.thresholds, hi: Number(e.target.value) } }))} /></div>
        </div>

        <div className="scr-grp">Questions</div>
        {draft.questions.map((q, qi) => (
          <div key={q.id} className="scr-q ans">
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <input style={{ width: 64 }} value={q.code} onChange={(e) => setQ(qi, { code: e.target.value })} aria-label="Code" />
              <select value={q.stage} onChange={(e) => setQ(qi, { stage: e.target.value })} aria-label="Stage">
                <option value="pre">Pre-assessment</option><option value="deploy">Deploy assessment</option>
              </select>
              <input list="scr-groups" style={{ flex: 1, minWidth: 140 }} value={q.group} onChange={(e) => setQ(qi, { group: e.target.value })} placeholder="Group" aria-label="Group" />
              <button type="button" className="btn btn-secondary v7-btn-compact" onClick={() => setDraft((d) => ({ ...d, questions: move(d.questions, qi, -1) }))}>↑</button>
              <button type="button" className="btn btn-secondary v7-btn-compact" onClick={() => setDraft((d) => ({ ...d, questions: move(d.questions, qi, 1) }))}>↓</button>
              <button type="button" className="btn btn-secondary v7-btn-compact" onClick={() => delQ(qi)}>Delete</button>
            </div>
            <textarea rows={2} style={{ marginTop: 8 }} value={q.th} onChange={(e) => setQ(qi, { th: e.target.value })} placeholder="คำถาม (TH)" />
            <input style={{ width: '100%', marginTop: 6 }} value={q.en} onChange={(e) => setQ(qi, { en: e.target.value })} placeholder="Question (EN)" />
            <input style={{ width: '100%', marginTop: 6 }} value={q.advice} onChange={(e) => setQ(qi, { advice: e.target.value })} placeholder="คำแนะนำเมื่อต้องแก้ (advice)" />
            <table style={{ width: '100%', marginTop: 8, fontSize: 12 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--mu)' }}><th>Option (TH)</th><th>(EN)</th><th>Score</th><th>Fix</th><th title="Blocks registration">Blk reg</th><th title="Blocks deploy request">Blk deploy</th><th /></tr></thead>
              <tbody>
                {q.options.map((o, oi) => (
                  <tr key={o.id}>
                    <td><input style={{ width: '100%' }} value={o.th} onChange={(e) => setO(qi, oi, { th: e.target.value })} /></td>
                    <td><input style={{ width: '100%' }} value={o.en} onChange={(e) => setO(qi, oi, { en: e.target.value })} /></td>
                    <td><input type="number" min="0" max="100" style={{ width: 56 }} value={o.score} onChange={(e) => setO(qi, oi, { score: Number(e.target.value) })} /></td>
                    <td><select value={o.fix} onChange={(e) => setO(qi, oi, { fix: e.target.value })}><option value="none">none</option><option value="should">should fix</option><option value="must">must fix</option></select></td>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" checked={o.blocksPre} onChange={(e) => setO(qi, oi, { blocksPre: e.target.checked })} /></td>
                    <td style={{ textAlign: 'center' }}><input type="checkbox" checked={o.blocksDeploy} onChange={(e) => setO(qi, oi, { blocksDeploy: e.target.checked })} /></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button type="button" className="btn btn-secondary v7-btn-compact" onClick={() => setQ(qi, { options: move(q.options, oi, -1) })}>↑</button>
                      <button type="button" className="btn btn-secondary v7-btn-compact" onClick={() => setQ(qi, { options: move(q.options, oi, 1) })}>↓</button>
                      <button type="button" className="btn btn-secondary v7-btn-compact" onClick={() => delO(qi, oi)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="btn btn-secondary v7-btn-compact" style={{ marginTop: 6 }} onClick={() => addO(qi)}>+ Add option</button>
          </div>
        ))}
        <datalist id="scr-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        <button type="button" className="btn btn-secondary" onClick={addQ}>+ Add question</button>

        {msg && <div className={`msg ${msg.ok ? 'success' : 'error'}`} style={{ marginTop: 12 }}>{msg.text}</div>}
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
