import { evaluate, optionOf, questionById, stageResults } from '../lib/screening';
import { CHECKLIST } from '../lib/deployChecklist';
import '../styles/Screening.css';

// Renders the given questions (radio per option). answers: { questionId: optionId }.
export function ScreeningQuestions({ config, questionIds, answers, onChange }) {
  let lastGroup = null;
  return (
    <div>
      {config.questions.filter((q) => questionIds.includes(q.id)).map((q) => {
        const v = answers[q.id];
        const done = !!optionOf(config, q.id, v);
        const head = q.group !== lastGroup ? <div className="scr-grp">{q.group}</div> : null;
        lastGroup = q.group;
        return (
          <div key={q.id}>
            {head}
            <div className={`scr-q ${done ? 'ans' : 'unans'}`}>
              <div className="scr-qh">
                <span className="scr-code">{q.code}</span>
                <div>
                  <div className="scr-qt">{q.th}</div>
                  {q.en && <div className="scr-qe">{q.en}</div>}
                </div>
              </div>
              <div className="scr-opts" role="radiogroup">
                {q.options.map((o) => (
                  <label key={o.id} className="scr-opt">
                    <input type="radio" name={`scr-${q.id}`} checked={v === o.id} onChange={() => onChange(q.id, o.id)} />
                    <span>{o.th} <em>({o.en})</em></span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Result panel: level, must fix, main factors, should fix.
export function ScreeningResult({ config, answers }) {
  const r = evaluate(config, answers);
  return (
    <div className="scr-res">
      <div>
        <span className={`scr-lvl ${r.level || ''}`}>{r.level || 'Not enough answers'}</span>
        {r.level && <span className="scr-score" title="Total points from the answers">Score {r.total}</span>}
      </div>
      {r.must.length > 0 && (
        <div className="scr-must">
          <h4>Must fix</h4>
          {r.must.map((m) => (
            <div key={m.id} className="scr-fix"><b>{m.item}</b> {questionById(config, m.id).th.split(' ').slice(0, 9).join(' ')}…
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
            const q = questionById(config, m.id);
            return (
              <div key={m.id} className="scr-fix"><b>{m.item}</b> {q.advice || q.th}
                <div className="scr-now">คำตอบตอนนี้: {optionOf(config, m.id, answers[m.id])?.th}</div></div>
            );
          })}
        </>
      )}
    </div>
  );
}

// Approver view: pre-assessment result, deploy-assessment result (once a deploy was requested)
// and the ticked Deployment checklist items.
export function ScreeningSummary({ agent, config }) {
  const r = stageResults(config, agent?.screening);
  const cl = agent?.deployChecklist;
  if (!r && !cl) return null;
  const code = (id) => questionById(config, id)?.code || id;
  const labels = cl ? (CHECKLIST[cl.tier] || []).filter((i) => (cl.checked || []).includes(i.id)).map((i) => i.label) : [];
  const fixes = (res) => (
    <>
      {res.must?.length > 0 && <span className="scr-sum-must"> · Must fix {res.must.map(code).join(', ')}</span>}
      {res.should?.length > 0 && <span> · Should fix {res.should.map(code).join(', ')}</span>}
    </>
  );
  return (
    <div className="scr-sum">
      {r && (
        <div>
          Pre-assessment: <span className={`scr-lvl ${r.pre.level || ''}`}>{r.pre.level || '—'}</span><span className="scr-score">Score {r.pre.total}</span>{fixes(r.pre)}
        </div>
      )}
      {r?.deploy && (
        <div>
          Deploy assessment:{' '}
          {r.deploy.rows.map((row) => (
            <span key={row.id} className={row.ok ? 'scr-ok' : 'scr-sum-must'} title={row.answer}>{row.code} {row.ok ? '✓' : '✗'} </span>
          ))}
          · Overall <span className={`scr-lvl ${r.deploy.level || ''}`}>{r.deploy.level || '—'}</span><span className="scr-score">Score {r.deploy.total}</span>{fixes(r.deploy)}
        </div>
      )}
      {labels.length > 0 && <div>Deployment checklist: {labels.map((l) => `✓ ${l}`).join(' · ')}</div>}
    </div>
  );
}
