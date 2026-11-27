import { useMemo, useState } from 'react';
import { getFunctions, httpsCallable } from '../lib/callable';
import { useScreeningConfig } from '../hooks/useScreeningConfig';
import { countChanges, nextSelected } from '../lib/screeningConfigEdit';
import '../styles/Screening.css';

// Assessment Settings (2026-11-26) — committee/admin edit questions, options, scores, fix level and
// the per-option blocking flags. Layout: question list on the left, editor for the selected question
// on the right, a save bar that counts unsaved changes. Saves through the manageScreeningConfig
// callable (clients cannot write /config). New ids are generated here and never reused; saving
// recomputes every non-archived result because results are always evaluated from the live config.
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clone = (v) => JSON.parse(JSON.stringify(v));
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return arr; const a = [...arr]; [a[i], a[j]] = [a[j], a[i]]; return a; };
const FIXES = [['none', 'None'], ['should', 'Recommended'], ['must', 'Required']];
const newOption = () => ({ id: uid('o'), th: '', en: '', score: 0, fix: 'none', blocksPre: false, blocksDeploy: false });

export default function AssessmentSettingsModal({ onClose }) {
  const live = useScreeningConfig();
  const [baseline, setBaseline] = useState(() => clone(live));
  const [draft, setDraft] = useState(() => clone(live));
  const [selId, setSelId] = useState(() => live.questions[0]?.id ?? null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const changes = useMemo(() => countChanges(baseline, draft), [baseline, draft]);
  const qi = draft.questions.findIndex((q) => q.id === selId);
  const q = qi >= 0 ? draft.questions[qi] : null;
  const groups = [...new Set(draft.questions.map((x) => x.group).filter(Boolean))];
  const { md, hi } = draft.thresholds;

  const patchQ = (patch) => setDraft((d) => { const n = clone(d); Object.assign(n.questions[qi], patch); return n; });
  const patchO = (oi, patch) => setDraft((d) => { const n = clone(d); Object.assign(n.questions[qi].options[oi], patch); return n; });
  const setTh = (k, v) => setDraft((d) => ({ ...d, thresholds: { ...d.thresholds, [k]: Number(v) } }));

  function addQ() {
    const id = uid('q');
    setDraft((d) => ({ ...d, questions: [...d.questions, { id, code: `Q${d.questions.length + 1}`, stage: 'pre', group: groups[0] || '', th: '', en: '', advice: '', options: [newOption()] }] }));
    setSelId(id);
  }
  function delQ() {
    if (!q || !window.confirm('ลบคำถามนี้? คำตอบเดิมของคำถามนี้จะไม่ถูกนับอีก')) return;
    setSelId(nextSelected(draft.questions.map((x) => x.id), q.id));
    setDraft((d) => ({ ...d, questions: d.questions.filter((x) => x.id !== q.id) }));
  }
  function delO(oi) {
    if (!window.confirm('ลบตัวเลือกนี้? คำตอบเดิมที่เลือกตัวนี้จะขึ้นเป็น "(removed option)" และได้ 0 คะแนน')) return;
    setDraft((d) => { const n = clone(d); n.questions[qi].options.splice(oi, 1); return n; });
  }
  function discard() {
    if (!window.confirm('ทิ้งการแก้ไขที่ยังไม่บันทึกทั้งหมด?')) return;
    setDraft(clone(baseline));
    setSelId((id) => (baseline.questions.some((x) => x.id === id) ? id : baseline.questions[0]?.id ?? null));
    setMsg(null);
  }
  async function save() {
    if (!window.confirm('บันทึกการตั้งค่า? ผล Assessment ที่ยังไม่ archive จะถูกคำนวณใหม่ตามค่าที่แก้')) return;
    setSaving(true); setMsg(null);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'manageScreeningConfig');
      const { data } = await fn({ action: 'save', config: draft });
      setBaseline(clone(draft));
      setMsg({ ok: true, text: `บันทึกแล้ว (version ${data.version})` });
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'บันทึกไม่สำเร็จ' });
    } finally { setSaving(false); }
  }

  const needle = search.trim().toLowerCase();
  const matches = (x) => !needle || `${x.code} ${x.th} ${x.en}`.toLowerCase().includes(needle);
  const navGroup = (stage, title) => {
    const list = draft.questions.filter((x) => x.stage === stage && matches(x));
    return (
      <>
        <div className="ast-ng">{title} · {draft.questions.filter((x) => x.stage === stage).length}</div>
        {list.map((x) => {
          const blocks = x.options.some((o) => o.blocksPre || o.blocksDeploy);
          return (
            <button key={x.id} type="button" className={`ast-nav-row${x.id === selId ? ' on' : ''}`} onClick={() => setSelId(x.id)}>
              <span className="as-code">{x.code}</span>
              <span className="ast-nav-t">{x.th || '(ยังไม่มีข้อความ)'}</span>
              <span className={`ast-nav-tail${blocks ? ' bad' : ''}`}>{blocks ? 'blocks' : `${x.options.length} opts`}</span>
            </button>
          );
        })}
      </>
    );
  };

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox ast" role="dialog" aria-label="Assessment Settings">
        <button className="mclose" onClick={onClose} style={{ zIndex: 3 }}>✕</button>
        <div className="ast-head">
          <div className="mtitle" style={{ marginTop: 0 }}>Assessment Settings</div>
          <div className="msub" style={{ marginBottom: 0 }}>แก้คำถาม ตัวเลือก คะแนน และเงื่อนไขการบล็อก · มีผลกับ assessment ที่ยังไม่ archive ทั้งหมด</div>
        </div>

        <div className="ast-grid">
          <nav className="ast-nav" aria-label="Questions">
            <input className="ast-search" placeholder="Search questions" value={search} onChange={(e) => setSearch(e.target.value)} />
            {navGroup('pre', 'Pre-assessment')}
            {navGroup('deploy', 'Deploy assessment')}
            <button type="button" className="btn btn-secondary btn-sm" style={{ width: '100%', marginTop: 12 }} onClick={addQ}>+ Add question</button>
          </nav>

          <div className="ast-main">
            <div className="ast-levels">
              <div className="ast-levels-h"><b>Level thresholds</b><span>คะแนนรวมของคำตอบ</span></div>
              <div className="ast-bands" style={{ gridTemplateColumns: `${Math.max(md, 1)}fr ${Math.max(hi - md, 1)}fr ${Math.max(Math.round(hi * 0.7), 4)}fr` }}>
                <div className="lo">Low</div><div className="mid">Medium</div><div className="hi">High</div>
              </div>
              <div className="ast-band-in">
                <span>0</span>
                <label>Medium from <input type="number" min="1" value={md} onChange={(e) => setTh('md', e.target.value)} /></label>
                <label>High from <input type="number" min="1" value={hi} onChange={(e) => setTh('hi', e.target.value)} /></label>
              </div>
            </div>

            {!q ? (
              <div className="empty-state">เลือกคำถามทางซ้าย หรือกด + Add question</div>
            ) : (
              <>
                <div className="ast-qbar">
                  <span className="as-code">{q.code}</span>
                  <div className="ast-qbar-btns">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft((d) => ({ ...d, questions: move(d.questions, qi, -1) }))} aria-label="Move question up">↑</button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDraft((d) => ({ ...d, questions: move(d.questions, qi, 1) }))} aria-label="Move question down">↓</button>
                    <button type="button" className="btn btn-danger btn-sm" onClick={delQ}>Delete question</button>
                  </div>
                </div>
                <div className="fgrid">
                  <div className="fg"><label>Code</label><input value={q.code} onChange={(e) => patchQ({ code: e.target.value })} /></div>
                  <div className="fg"><label>Stage</label>
                    <div className="toggle2" role="radiogroup" aria-label="Stage">
                      {[['pre', 'Pre-assessment'], ['deploy', 'Deploy']].map(([v, l]) => (
                        <button key={v} type="button" role="radio" aria-checked={q.stage === v} className={q.stage === v ? 'sel' : ''} onClick={() => patchQ({ stage: v })}>{l}</button>
                      ))}
                    </div>
                  </div>
                  <div className="fg full"><label>Question (TH)</label><textarea rows={2} value={q.th} onChange={(e) => patchQ({ th: e.target.value })} /></div>
                  <div className="fg"><label>Question (EN)</label><input value={q.en} onChange={(e) => patchQ({ en: e.target.value })} /></div>
                  <div className="fg"><label>Group</label><input list="ast-groups" value={q.group} onChange={(e) => patchQ({ group: e.target.value })} /></div>
                  <div className="fg full"><label>Advice when it needs fixing</label><input value={q.advice} onChange={(e) => patchQ({ advice: e.target.value })} /><div className="fhelp">แสดงเมื่อตัวเลือกที่เลือกบล็อก หรือต้องแก้</div></div>
                </div>
                <datalist id="ast-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>

                <div className="fsec"><div className="fsec-h"><h4>Options</h4><span>คะแนน · ต้องแก้ · บล็อก</span></div></div>
                {q.options.map((o, oi) => (
                  <div key={o.id} className="ast-opt">
                    <div className="ast-opt-top">
                      <input className="ast-in" value={o.th} onChange={(e) => patchO(oi, { th: e.target.value })} placeholder="ตัวเลือก (TH)" aria-label="Option TH" />
                      <input className="ast-in" value={o.en} onChange={(e) => patchO(oi, { en: e.target.value })} placeholder="Option (EN)" aria-label="Option EN" />
                      <span className="ast-opt-btns">
                        <button type="button" onClick={() => patchQ({ options: move(q.options, oi, -1) })} aria-label="Move option up">↑</button>
                        <button type="button" onClick={() => patchQ({ options: move(q.options, oi, 1) })} aria-label="Move option down">↓</button>
                        <button type="button" onClick={() => delO(oi)} aria-label="Delete option">✕</button>
                      </span>
                    </div>
                    <div className="ast-opt-ctl">
                      <label>Score
                        <span className="ast-step">
                          <button type="button" onClick={() => patchO(oi, { score: Math.max(0, o.score - 1) })} aria-label="Decrease score">−</button>
                          <input type="number" min="0" max="100" value={o.score} onChange={(e) => patchO(oi, { score: Math.round(Number(e.target.value)) })} aria-label="Score" />
                          <button type="button" onClick={() => patchO(oi, { score: Math.min(100, o.score + 1) })} aria-label="Increase score">+</button>
                        </span>
                      </label>
                      <label>Fix level
                        <span className="ast-fix" role="radiogroup" aria-label="Fix level">
                          {FIXES.map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={o.fix === v} className={o.fix === v ? 'on' : ''} onClick={() => patchO(oi, { fix: v })}>{l}</button>)}
                        </span>
                      </label>
                      <label className="ast-sw-l"><button type="button" role="switch" aria-checked={o.blocksPre} className={`ast-sw${o.blocksPre ? ' on' : ''}`} onClick={() => patchO(oi, { blocksPre: !o.blocksPre })} />Blocks registration</label>
                      <label className="ast-sw-l"><button type="button" role="switch" aria-checked={o.blocksDeploy} className={`ast-sw${o.blocksDeploy ? ' on' : ''}`} onClick={() => patchO(oi, { blocksDeploy: !o.blocksDeploy })} />Blocks deploy</label>
                    </div>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => patchQ({ options: [...q.options, newOption()] })}>+ Add option</button>
              </>
            )}
          </div>
        </div>

        <div className={`ast-save${changes ? ' dirty' : ''}`}>
          <span>{msg ? msg.text : changes ? `● มีการแก้ไขที่ยังไม่บันทึก ${changes} รายการ` : 'ไม่มีการเปลี่ยนแปลง'}</span>
          <div className="fbtns">
            <button className="btn btn-secondary btn-sm" disabled={!changes || saving} onClick={discard}>Discard</button>
            <button className="btn btn-primary btn-sm" disabled={!changes || saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
