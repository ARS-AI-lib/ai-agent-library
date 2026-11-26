import { QUESTIONS, RECO, evaluate, questionByCode } from '../lib/screening';
import { CHECKLIST } from '../lib/deployChecklist';
import '../styles/Screening.css';

// Renders any subset of the screening questions (decl = free text, others = radio).
// answers: { D1..D6: string, C1..C11: option index }.
export function ScreeningQuestions({ codes, answers, onChange }) {
  let lastGroup = null;
  return (
    <div>
      {QUESTIONS.filter((q) => codes.includes(q.code)).map((q) => {
        const v = answers[q.code];
        const done = q.opts ? typeof v === 'number' : String(v ?? '').trim() !== '';
        const head = q.g !== lastGroup ? <div className="scr-grp">{q.g}</div> : null;
        lastGroup = q.g;
        return (
          <div key={q.code}>
            {head}
            <div className={`scr-q ${done ? 'ans' : 'unans'}`}>
              <div className="scr-qh">
                <span className="scr-code">{q.code}</span>
                <div>
                  <div className="scr-qt">{q.th}</div>
                  {q.en && <div className="scr-qe">{q.en}</div>}
                </div>
              </div>
              {q.opts ? (
                <div className="scr-opts" role="radiogroup">
                  {q.opts.map((o, i) => (
                    <label key={o.l} className="scr-opt">
                      <input type="radio" name={`scr-${q.code}`} checked={v === i} onChange={() => onChange(q.code, i)} />
                      <span>{o.th} <em>({o.en})</em></span>
                    </label>
                  ))}
                </div>
              ) : (
                <textarea value={v ?? ''} onChange={(e) => onChange(q.code, e.target.value)} placeholder="พิมพ์คำตอบ" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Result panel: level, must fix, main factors, should fix (same content as the bank's tool).
export function ScreeningResult({ answers }) {
  const r = evaluate(answers);
  return (
    <div className="scr-res">
      <div><span className={`scr-lvl ${r.level || ''}`}>{r.level || 'Not enough answers'}</span></div>
      {r.must.length > 0 && (
        <div className="scr-must">
          <h4>Must fix</h4>
          {r.must.map((m) => (
            <div key={m.item} className="scr-fix"><b>{m.item}</b> {questionByCode(m.item).th.split(' ').slice(0, 9).join(' ')}…
              <div className="scr-now">{m.why.join(' · ')}</div></div>
          ))}
        </div>
      )}
      <h4>Main factors</h4>
      {r.hits.length ? <ul>{r.hits.map((h) => <li key={h}>{h}</li>)}</ul> : <div className="scr-now">ไม่มีปัจจัยเสี่ยงเด่น</div>}
      {r.should.length > 0 && (
        <>
          <h4>Should fix</h4>
          {r.should.map((m) => {
            const q = questionByCode(m.item);
            return (
              <div key={m.item} className="scr-fix"><b>{m.item}</b> {RECO[m.item] || q.th}
                <div className="scr-now">คำตอบตอนนี้: {q.opts[answers[m.item]]?.th}</div></div>
            );
          })}
        </>
      )}
    </div>
  );
}

// One-line summary for approvers: level, must/should codes and the ticked package items.
export function ScreeningSummary({ agent }) {
  const sc = agent?.screening;
  const cl = agent?.deployChecklist;
  if (!sc && !cl) return null;
  const labels = cl ? (CHECKLIST[cl.tier] || []).filter((i) => (cl.checked || []).includes(i.id)).map((i) => i.label) : [];
  return (
    <div className="scr-sum">
      {sc && (
        <span>
          Screening: <span className={`scr-lvl ${sc.level || ''}`}>{sc.level || '—'}</span>
          {sc.must?.length > 0 && <span className="scr-sum-must"> · Must fix {sc.must.join(', ')}</span>}
          {sc.should?.length > 0 && <span> · Should fix {sc.should.join(', ')}</span>}
        </span>
      )}
      {labels.length > 0 && <div className="scr-now">Package: {labels.join(' · ')}</div>}
    </div>
  );
}
