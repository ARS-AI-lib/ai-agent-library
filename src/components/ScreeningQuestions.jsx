import { evaluate, optionOf, questionById, stageResults, meterPosition } from '../lib/screening';
import { CHECKLIST } from '../lib/deployChecklist';
import '../styles/Screening.css';

// Assessment questions as option tiles (2 columns). answers: { questionId: optionId }.
// blockKey ('blocksPre' | 'blocksDeploy'): a chosen option carrying it turns red and shows the
// question's advice right under it — the reason the next step is blocked.
// reveal=false (default): the tiles show NO points and NO blocking hints while answering — the score,
// recommendations and blockers are shown only in ScreeningResultModal after the respondent presses Continue,
// so nobody can tune answers against a live score (2026-11-27).
export function ScreeningQuestions({ config, questionIds, answers, onChange, blockKey, reveal = false }) {
  const qs = config.questions.filter((q) => questionIds.includes(q.id));
  const groups = [...new Set(qs.map((q) => q.group))];
  return (
    <div>
      {groups.map((g) => {
        const inGroup = qs.filter((q) => q.group === g);
        const done = inGroup.filter((q) => optionOf(config, q.id, answers[q.id])).length;
        return (
          <div key={g} className="as-group">
            <div className="as-group-h">{g}<em>{done} / {inGroup.length} answered</em></div>
            {inGroup.map((q) => {
              const picked = optionOf(config, q.id, answers[q.id]);
              const blocks = !!(reveal && picked && blockKey && picked[blockKey]);
              return (
                <div key={q.id} className="as-q" data-q={q.id}>
                  <div className="as-qt">
                    <span className="as-code">{q.code}</span>
                    <div>
                      <div className="as-title">{q.th}</div>
                      {q.en && <div className="as-en">{q.en}</div>}
                    </div>
                  </div>
                  <div className="as-opts" role="radiogroup" aria-label={q.code}>
                    {q.options.map((o) => {
                      const on = answers[q.id] === o.id;
                      const bad = reveal && blockKey && o[blockKey];
                      return (
                        <label key={o.id} className={`as-opt${on ? ' on' : ''}${bad ? ' bad' : ''}`}>
                          <input type="radio" name={`as-${q.id}`} checked={on} onChange={() => onChange(q.id, o.id)} />
                          <span className="as-dot" aria-hidden="true" />
                          <span className="as-otext">{o.th}</span>
                          {reveal && <span className="as-pts" title="Points">{o.score}</span>}
                        </label>
                      );
                    })}
                  </div>
                  {blocks && <div className="as-flag">⛔ ข้อนี้บล็อกขั้นถัดไป{q.advice ? ` — ${q.advice}` : ''}</div>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// Result popup shown AFTER the respondent pressed Continue with every question answered: score, level,
// what blocks / needs fixing. When blocked there is no forward button — only "Back to answers".
export function ScreeningResultModal({ config, answers, questionIds, stage, blockKey, blocked, reasons = [], onClose, onContinue, continueLabel = 'Continue', busy = false }) {
  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox" role="dialog" aria-label="Assessment result" style={{ maxWidth: 420 }}>
        <button className="mclose" onClick={onClose}>✕</button>
        <h2 className="mtitle">Assessment result</h2>
        <div className="msub">{blocked ? 'ยังไปขั้นถัดไปไม่ได้ — แก้คำตอบที่ติดเงื่อนไขแล้วกด Continue ใหม่' : 'ผ่านเงื่อนไขของขั้นนี้ — ไปขั้นถัดไปได้'}</div>
        <ScreeningSide config={config} answers={answers} questionIds={questionIds} stage={stage} blockKey={blockKey} />
        {blocked && reasons.length > 0 && (
          <div className="msg error" style={{ marginTop: 12 }}><span className="dot" style={{ background: '#ea4335' }} />{reasons[0]}</div>
        )}
        <div className="btn-group" style={{ marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={onClose}>Back to answers</button>
          {!blocked && <button className="btn btn-primary" disabled={busy} onClick={onContinue}>{continueLabel}</button>}
        </div>
      </div>
    </div>
  );
}

// Live result next to the questions: score, level on a Low|Medium|High bar, progress, what blocks / needs fixing.
export function ScreeningSide({ config, answers, questionIds, stage, blockKey }) {
  const ids = questionIds || config.questions.map((q) => q.id);
  const answered = ids.filter((id) => optionOf(config, id, answers[id])).length;
  const r = evaluate(config, answers, stage);
  const blocking = ids.map((id) => questionById(config, id)).filter((q) => q && blockKey && optionOf(config, q.id, answers[q.id])?.[blockKey]);
  const pos = meterPosition(r.total, config.thresholds);
  return (
    <aside className="as-side" aria-live="polite">
      <div className="as-k">Result so far</div>
      <div className="as-big"><b>{r.total}</b>{r.level && <span className={`scr-lvl ${r.level}`}>{r.level}</span>}</div>
      <div className="as-meter"><i style={{ left: `${pos}%` }} /></div>
      <div className="as-scale"><span>Low 0–{config.thresholds.md - 1}</span><span>Medium {config.thresholds.md}–{config.thresholds.hi - 1}</span><span>High {config.thresholds.hi}+</span></div>
      <div className="as-prog">{answered} of {ids.length} answered<div className="as-bar"><i style={{ width: `${ids.length ? (answered / ids.length) * 100 : 0}%` }} /></div></div>
      {(blocking.length > 0 || r.must.length > 0 || r.should.length > 0) && (
        <div className="as-list">
          {blocking.map((q) => <div key={`b${q.id}`} className="as-li"><span className="as-pill must">Blocks</span>{q.code} {q.th.split(' ').slice(0, 6).join(' ')}</div>)}
          {r.must.filter((m) => !blocking.some((q) => q.id === m.id)).map((m) => <div key={`m${m.id}`} className="as-li"><span className="as-pill must">Required fix</span>{m.item}</div>)}
          {r.should.map((m) => <div key={`s${m.id}`} className="as-li"><span className="as-pill should">Recommended</span>{m.item} {(questionById(config, m.id).advice || '').slice(0, 60)}</div>)}
        </div>
      )}
    </aside>
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
      {res.must?.length > 0 && <span className="scr-sum-must"> · Required fix {res.must.map(code).join(', ')}</span>}
      {res.should?.length > 0 && <span> · Recommended {res.should.map(code).join(', ')}</span>}
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
