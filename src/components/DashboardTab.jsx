import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { agentStatus, phaseForProgress, ST_DEF, ST_ORDER, progressBucket } from '../lib/status';
import { getType, getTier, TIER_DEF, isInternalOrExternal } from '../lib/tier';
import { toTimelineItem, timelineStatus, autoFitRange, TL_ST } from '../lib/timeline';
import { fmtDate, normalizeProgress, categoryColor, agentCategories } from '../lib/agentUtils';
import { VERTICAL_CATEGORIES } from '../lib/approveAreas';
import { readStats, demandScore, isUntouched } from '../lib/agentStats';
import { useAgentStats } from '../hooks/useAgentStats';
import DashboardRoleView from './DashboardRoleView';
import '../styles/SDLCTab.css';
import '../styles/DashboardTab.css';

const DAY = 864e5;

/**
 * Dashboard tab — v2 rebuild (2026-09-24).
 *
 * One scrolling page, ordered as the questions an executive asks in turn:
 *   headline counters → what kind of library is it (Tier, Reusable) →
 *   is anyone using it (Adoption) → what is it about (Category) →
 *   which roles does it serve (Role Coverage, unchanged) →
 *   is delivery on track (Delivery Health) → what needs chasing (Needs Attention).
 * Replaces the old overview/roles toggle; the approved mockup is the spec.
 *
 * Every number comes from the app's own rules, never re-derived here:
 * status = phaseForProgress(normalizeProgress)/ST_DEF, tier = getTier/TIER_DEF, delivery forecast =
 * toTimelineItem + timelineStatus with the Timeline page's own axis (so the
 * Delayed count matches the Timeline dots 1:1), demand = demandScore.
 * Colours are the site's own tokens (ST_DEF dots, --tier-*, --tl-*, --ag/--sk,
 * categoryColor) — this page introduces no palette of its own.
 */
export default function DashboardTab({ agents = [], onAgentClick }) {
  const statsById = useAgentStats(true);
  const [processes, setProcesses] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [procModal, setProcModal] = useState(null); // { proc, agents } — blueprint tile click-through
  const [roleModal, setRoleModal] = useState(null); // { group, agents } — role card click-through
  const [listModal, setListModal] = useState(null); // { sub, title, agents } — Needs Attention click-throughs

  useEffect(() => {
    let active = true;
    getDocs(collection(db, 'sdlcProcesses'))
      .then((snap) => { if (active) setProcesses(snap.docs.map((d) => ({ id: d.id, ...d.data() }))); })
      .catch((e) => console.error('Error loading sdlcProcesses:', e));
    return () => { active = false; };
  }, []);

  // Milestones only feed autoFitRange — same axis start as the Timeline page.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'timeline'), (snap) => {
      setMilestones(snap.exists() ? (snap.data().milestones || []) : []);
    }, () => setMilestones([]));
    return unsub;
  }, []);

  const total = agents.length;
  const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

  const items = useMemo(() => agents.map(toTimelineItem), [agents]);
  const axisStart = useMemo(() => autoFitRange(items, milestones).start, [items, milestones]);
  const tlOf = useMemo(() => {
    const m = new Map();
    items.forEach((it) => m.set(it.id, timelineStatus(it, axisStart)));
    return m;
  }, [items, axisStart]);

  // ── Headline ──
  const agentN = agents.filter((a) => getType(a) === 'agent').length;
  const skillN = total - agentN;
  // Bucketed from normalizeProgress(): statusCounts() reads the raw field and
  // would score a CSV-imported "90%" string as To Do.
  const st = useMemo(() => {
    const c = { td: 0, ip: 0, pilot: 0, ru: 0 };
    items.forEach((it) => { c[phaseForProgress(it.progress)] += 1; });
    return c;
  }, [items]);
  const avgProgress = total ? Math.round(items.reduce((s, it) => s + it.progress, 0) / total) : 0;
  const launch90 = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const end = new Date(now.getTime() + 90 * DAY);
    return items.filter((it) => it.launch && it.launch >= now && it.launch <= end && it.progress < 100).length;
  }, [items]);

  // ── Tier / Reusable ──
  const tier = useMemo(() => {
    const c = { T1: 0, T2: 0, T3: 0, T4: 0 };
    agents.forEach((a) => { c[getTier(a)] += 1; });
    return c;
  }, [agents]);
  const reuse = useMemo(() => {
    const c = {};
    agents.forEach((a) => { const k = a.reusable || ''; c[k] = (c[k] || 0) + 1; });
    return REUSE.map((r) => ({ ...r, n: c[r.key] || 0 }));
  }, [agents]);

  // ── Adoption ──
  const usage = useMemo(() => {
    const rows = agents.map((a) => ({ a, s: readStats(statsById.get(a.id)), d: demandScore(statsById.get(a.id)) }));
    const t = rows.reduce((acc, r) => ({
      o: acc.o + r.s.detailOpens, c: acc.c + r.s.endpointClicks, h: acc.h + r.s.searchHits, r: acc.r + r.s.ratingCount,
    }), { o: 0, c: 0, h: 0, r: 0 });
    return {
      top: rows.filter((r) => r.d > 0).sort((x, y) => y.d - x.d).slice(0, 8),
      untouched: rows.filter((r) => isUntouched(statsById.get(r.a.id))).length,
      totals: t,
    };
  }, [agents, statsById]);
  const maxOpens = Math.max(1, ...usage.top.map((r) => r.s.detailOpens));

  // ── Engagement Depth ── the deepest thing that has ever happened to each
  // item: used (endpoint click) > viewed (detail open) > surfaced (search hit)
  // > untouched. One bucket per item, so the bar is a true part-to-whole.
  const depth = useMemo(() => {
    const b = { used: [], viewed: [], search: [], none: [] };
    agents.forEach((a) => {
      const s = readStats(statsById.get(a.id));
      if (s.endpointClicks > 0) b.used.push(a);
      else if (s.detailOpens > 0) b.viewed.push(a);
      else if (s.searchHits > 0) b.search.push(a);
      else b.none.push(a);
    });
    const ready = agents.filter((a) => normalizeProgress(a.devProgress) >= 100);
    const readyUnused = ready.filter((a) => readStats(statsById.get(a.id)).endpointClicks === 0);
    return { b, ready, readyUnused };
  }, [agents, statsById]);

  // ── Category ── multi-valued (§23): counted per tag, so bars can sum past `total`.
  const cats = useMemo(() => {
    const c = {};
    agents.forEach((a) => agentCategories(a).forEach((k) => { c[k] = (c[k] || 0) + 1; }));
    const disc = Object.entries(c).filter(([k]) => !VERTICAL_CATEGORIES.includes(k)).sort((a, b) => b[1] - a[1]);
    const prod = VERTICAL_CATEGORIES.map((k) => [k, c[k] || 0]).sort((a, b) => b[1] - a[1]);
    return { disc, prod };
  }, [agents]);
  const prodTagged = useMemo(
    () => agents.filter((a) => agentCategories(a).some((k) => VERTICAL_CATEGORIES.includes(k))).length,
    [agents],
  );

  // ── Delivery ──
  const ru = agents.filter((a) => normalizeProgress(a.devProgress) >= 100);
  const hasLink = (a) => String(a.endpoint || '').trim() || a.endpointFile?.storagePath;
  const accessible = ru.filter(hasLink).length;
  // Only items that are SUPPOSED to be reachable count as a gap: T4 and
  // Non-reusable ones are exempt from needing a link/file (user rule
  // 2026-09-24; Non-reusable matches the 100% gate in §25).
  const linkExempt = (a) => getTier(a) === 'T4' || a.reusable === 'Non-reusable';
  const missingLinkList = ru.filter((a) => !hasLink(a) && !linkExempt(a));
  const missingLink = missingLinkList.length;
  const tlCounts = useMemo(() => {
    const c = { done: 0, pilot: 0, ontime: 0, risk: 0, delay: 0 };
    tlOf.forEach((s) => { c[s] += 1; });
    return c;
  }, [tlOf]);
  const months = useMemo(() => {
    const m = {};
    items.forEach((it) => {
      if (!it.launch) return;
      const k = `${it.launch.getFullYear()}-${String(it.launch.getMonth() + 1).padStart(2, '0')}`;
      m[k] = m[k] || { done: 0, pilot: 0, ontime: 0, risk: 0, delay: 0 };
      m[k][tlOf.get(it.id)] += 1;
    });
    return Object.keys(m).sort().map((k) => ({ key: k, ...m[k] }));
  }, [items, tlOf]);
  const noLaunchList = items.filter((it) => !it.launch).map((it) => it._raw);
  const noLaunch = noLaunchList.length;

  // ── Needs attention ──
  const delayed = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return items
      .filter((it) => tlOf.get(it.id) === 'delay')
      .map((it) => ({ ...it, days: Math.round((today - it.launch) / DAY) }))
      .sort((a, b) => b.days - a.days);
  }, [items, tlOf]);
  const delayByTeam = useMemo(() => {
    const m = {};
    delayed.forEach((it) => { const k = it.team || '—'; (m[k] = m[k] || []).push(it._raw); });
    return Object.entries(m).map(([t, list]) => [t, list.length, list]).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [delayed]);
  const noReusableList = agents.filter((a) => !a.reusable);
  // Data Quality rows with nothing to chase are hidden (user rule 2026-09-24).
  const dqRows = [
    { label: 'Ready to Use แต่ไม่มีลิงก์/ไฟล์', list: missingLinkList },
    { label: 'ไม่มี Launch Date', list: noLaunchList },
    { label: 'Reusable ว่าง', list: noReusableList },
  ].filter((r) => r.list.length > 0);

  return (
    <div className="dash-page">
      {/* ── Headline counters ── */}
      <section className="dash-kpis" aria-label="Headline">
        <div className="dash-kpi hero">
          <div className="dash-kpi-l">AI in the Library</div>
          <div className="dash-kpi-v">{total}</div>
          <div className="dash-split" aria-hidden="true">
            <i style={{ flex: agentN, background: 'var(--ag)' }} />
            <i style={{ flex: skillN, background: 'var(--sk)' }} />
          </div>
          <div className="dash-kpi-d">
            <span className="dash-kd"><b style={{ background: 'var(--ag)' }} />{agentN} Agents</span>
            <span className="dash-kd"><b style={{ background: 'var(--sk)' }} />{skillN} Skills</span>
          </div>
        </div>

        <div className="dash-kpi">
          <div className="dash-kpi-l">Ready to Use</div>
          <div className="dash-kr">
            <StatusRing counts={st} total={total} />
            <div>
              <div className="dash-kpi-v">{st.ru}</div>
              <div className="dash-kpi-d">{pct(st.ru)}% ของไลบรารี</div>
            </div>
          </div>
          <div className="dash-rl">
            {[...ST_ORDER].reverse().map((k) => (
              <span key={k}><b style={{ background: ST_DEF[k].dot }} />{ST_DEF[k].lb} {st[k]}</span>
            ))}
          </div>
        </div>

        <div className="dash-kpi">
          <div className="dash-kpi-l">Launching in 90 days</div>
          <div className="dash-kpi-v">{launch90}</div>
          <div className="dash-kpi-d">รายการที่ launch date อยู่ใน 90 วันข้างหน้า</div>
          <div className="dash-dots" aria-hidden="true">
            {Array.from({ length: launch90 }, (_, i) => <i key={i} />)}
          </div>
        </div>

        <div className="dash-kpi">
          <div className="dash-kpi-l">Average Progress</div>
          <div className="dash-kpi-v">{avgProgress}%</div>
          {/* Band edges are phaseForProgress()'s thresholds (11 / 90 / 100). */}
          <div className="dash-gauge" aria-hidden="true"><i style={{ left: `calc(${avgProgress}% - 1.5px)` }} /></div>
          <div className="dash-gl">{ST_ORDER.map((k) => <span key={k}>{ST_DEF[k].lb}</span>)}</div>
        </div>
      </section>

      {/* ── Tier + Reusable ── */}
      <section className="dash-duo">
        <div className="dash-card">
          <div className="dash-ch"><span className="dash-card-title">Tier</span><span className="dash-card-sub">ชนิด × ขอบเขตการใช้งาน</span></div>
          <div className="dash-tm">
            <span />
            <span className="dash-ax">Skill</span>
            <span className="dash-ax">Agent</span>
            <span className="dash-ax dash-ax-v">Internal</span>
            <TierCell t="T1" n={tier.T1} pct={pct(tier.T1)} />
            <TierCell t="T2" n={tier.T2} pct={pct(tier.T2)} />
            <span className="dash-ax dash-ax-v">External</span>
            <TierCell t="T3" n={tier.T3} pct={pct(tier.T3)} />
            <TierCell t="T4" n={tier.T4} pct={pct(tier.T4)} />
          </div>
          <p className="dash-insight">
            {pct(tier.T1)}% เป็น Skill ใช้ภายใน (T1) — มีเพียง {tier.T3 + tier.T4} รายการที่ใช้กับลูกค้าภายนอก
          </p>
        </div>

        <div className="dash-card">
          <div className="dash-ch"><span className="dash-card-title">Reusable</span><span className="dash-card-sub">ทีมอื่นนำไปใช้ต่อได้แค่ไหน</span></div>
          <div className="dash-donut-w">
            <div className="dash-donut-box">
              <Donut parts={reuse} total={total} />
              <div className="dash-donut-c">
                <b>{pct(reuse[0].n + reuse[1].n)}%</b>
                <span>นำไปใช้ต่อได้</span>
              </div>
            </div>
            <div className="dash-dl">
              {reuse.map((r) => (
                <div key={r.key}>
                  <b style={{ background: r.color }} />
                  <span>{r.label}</span>
                  <em>{r.n}</em>
                  <small>{pct(r.n)}%</small>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Adoption ── */}
      <section className="dash-sec">
        <div className="dash-sec-h"><h2>Adoption</h2><span>มีคนเปิดดู / กดไปใช้จริงไหม</span></div>
        <div className="dash-g21">
          <div className="dash-card">
            <div className="dash-card-title">Most Used</div>
            <div className="dash-card-sub dash-mb">เรียงตาม demand score (clicks×3 + opens×2 + search)</div>
            {usage.top.length === 0 ? (
              <div className="dash-empty">No usage data yet</div>
            ) : (
              <div className="dash-tbl-w">
                <table className="dash-tbl">
                  <thead><tr><th>Agent / Skill</th><th className="r">Opens</th><th className="r">Clicks</th><th className="r">Search</th></tr></thead>
                  <tbody>
                    {usage.top.map(({ a, s }) => {
                      const t = getType(a);
                      return (
                        <tr key={a.id} onClick={() => onAgentClick?.(a)}>
                          <td>{a.agentName}<span className={`tb ${t === 'agent' ? 'tbag' : 'tbsk'} dash-tb`}>{t}</span></td>
                          <td className="r"><span className="dash-mini" style={{ width: `${(s.detailOpens / maxOpens) * 44}px` }} />{s.detailOpens}</td>
                          <td className="r">{s.endpointClicks}</td>
                          <td className="r">{s.searchHits}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="dash-col">
          <div className="dash-card">
            <div className="dash-card-title">Engagement Totals</div>
            <div className="dash-card-sub dash-mb">สะสมทั้งไลบรารี</div>
            <div className="dash-ustats">
              <div><b>{usage.totals.o.toLocaleString()}</b><span>Detail opens</span></div>
              <div><b>{usage.totals.h.toLocaleString()}</b><span>Search hits</span></div>
              <div><b>{usage.totals.c.toLocaleString()}</b><span>Endpoint clicks</span></div>
              <div><b>{usage.totals.r.toLocaleString()}</b><span>Ratings</span></div>
            </div>
            <p className="dash-note">
              มีคน rating แค่ {usage.totals.r} ครั้ง — ยังวัดความพึงพอใจไม่ได้ · {usage.untouched} รายการที่ยังไม่มีใครแตะเลย (retire candidates)
            </p>
          </div>
          <div className="dash-card">
            <div className="dash-card-title">Engagement Depth</div>
            <div className="dash-card-sub dash-mb">Agent/Skill แต่ละตัวถูกใช้ลึกแค่ไหน (นับระดับสูงสุดที่เคยเกิด) · คลิกเพื่อดูรายการ</div>
            <div className="dash-stack dash-depth-bar">
              {DEPTH.filter((d) => depth.b[d.key].length).map((d) => (
                <i
                  key={d.key}
                  style={{ flex: depth.b[d.key].length, background: d.color, cursor: 'pointer' }}
                  title={`${d.label} ${depth.b[d.key].length}`}
                  onClick={() => setListModal({ sub: 'Engagement Depth', title: d.label, agents: depth.b[d.key] })}
                />
              ))}
            </div>
            <div className="dash-depth-lg">
              {DEPTH.filter((d) => depth.b[d.key].length).map((d) => (
                <button
                  type="button"
                  key={d.key}
                  className="dash-rowbtn"
                  onClick={() => setListModal({ sub: 'Engagement Depth', title: d.label, agents: depth.b[d.key] })}
                >
                  <b style={{ background: d.color }} />
                  <span>{d.label}<small>{d.hint}</small></span>
                  <em>{depth.b[d.key].length}</em>
                  <small>{pct(depth.b[d.key].length)}%</small>
                </button>
              ))}
            </div>
            {depth.ready.length > 0 && (
              <button
                type="button"
                className="dash-insight dash-rowbtn dash-depth-ins"
                onClick={() => setListModal({ sub: 'Engagement Depth', title: 'Ready to Use — not used yet', agents: depth.readyUnused })}
              >
                Ready to Use ที่ถูกกดใช้จริง <b>{depth.ready.length - depth.readyUnused.length} / {depth.ready.length}</b>
                {depth.readyUnused.length > 0 && <> · อีก {depth.readyUnused.length} ตัวยังไม่มีใครกดใช้ →</>}
              </button>
            )}
          </div>
          </div>
        </div>
      </section>

      {/* ── Category ── */}
      <section className="dash-sec">
        <div className="dash-sec-h"><h2>Category</h2><span>นับซ้ำได้ — 1 รายการมีได้ทั้งสายงานและผลิตภัณฑ์</span></div>
        <div className="dash-card dash-catw">
          <div>
            <div className="dash-subh">Discipline</div>
            <div className="dash-hb dash-hb-two">
              {cats.disc.map(([k, n]) => <CatBar key={k} label={k} n={n} max={cats.disc[0]?.[1] || 1} />)}
            </div>
          </div>
          <div className="dash-catp">
            <div className="dash-subh">Product</div>
            <div className="dash-hb">
              {cats.prod.map(([k, n]) => <CatBar key={k} label={k} n={n} max={cats.prod[0]?.[1] || 1} />)}
            </div>
            <p className="dash-note">{prodTagged} รายการผูกกับผลิตภัณฑ์ — ที่เหลือเป็นเครื่องมือข้ามผลิตภัณฑ์</p>
          </div>
        </div>
      </section>

      {/* ── Role Coverage — the approved view, mounted unchanged ── */}
      <section className="dash-sec">
        <div className="dash-sec-h"><h2>Role Coverage</h2><span>AI ที่แต่ละ role มีให้ใช้</span></div>
        <DashboardRoleView
          agents={agents}
          processes={processes}
          onProcClick={(proc, list) => setProcModal({ proc, agents: list })}
          onRoleClick={(group, list) => setRoleModal({ group, agents: list })}
        />
      </section>

      {/* ── Delivery Health ── */}
      <section className="dash-sec">
        <div className="dash-sec-h"><h2>Delivery Health</h2><span>ของที่ลงทะเบียนไว้ ไปถึงมือคนใช้จริงแค่ไหน</span></div>
        <div className="dash-g2">
          <div className="dash-card">
            <div className="dash-card-title">Status</div>
            <div className="dash-card-sub dash-mb">Legend หลักของเว็บ · {total} รายการ</div>
            <div className="dash-stack">
              {ST_ORDER.map((k) => <i key={k} style={{ flex: st[k], background: ST_DEF[k].dot }} title={`${ST_DEF[k].lb} ${st[k]}`} />)}
            </div>
            <div className="dash-lg">
              {ST_ORDER.map((k) => <span key={k}><b style={{ background: ST_DEF[k].dot }} />{ST_DEF[k].lb} <em>{st[k]}</em></span>)}
            </div>
            <div className="dash-fn">
              <FunnelRow label="Registered" n={total} max={total} color="var(--mu2)" />
              <FunnelRow label="Pilot or later" n={st.pilot + st.ru} max={total} color={ST_DEF.pilot.dot} />
              <FunnelRow label="Ready to Use" n={ru.length} max={total} color={ST_DEF.ru.dot} />
              <FunnelRow label="Accessible (link/file)" n={accessible} max={total} color={ST_DEF.ru.dot} />
            </div>
            <p className="dash-note">{missingLink} รายการขึ้น Ready to Use แล้ว แต่ยังไม่มีลิงก์หรือไฟล์ให้คนเข้าไปใช้ (ไม่นับ T4 และ Non-reusable ที่ไม่ต้องมี)</p>
          </div>
          <div className="dash-card">
            <div className="dash-card-title">Launch Plan by Month</div>
            <div className="dash-card-sub dash-mb">สถานะเดียวกับหน้า Timeline — ตัวเลขตรงกันทุกเดือน</div>
            <MonthChart months={months} />
            <div className="dash-lg">
              {TL_KEYS.map((k) => <span key={k}><b style={{ background: TL_COLOR[k] }} />{TL_ST[k].lb} <em>{tlCounts[k]}</em></span>)}
              <span className="dash-lg-mu">· ไม่มี launch date {noLaunch} รายการ (ไม่อยู่ในกราฟ)</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Needs Attention ── every row opens its list; anything at 0 is not shown. */}
      {(delayed.length > 0 || dqRows.length > 0) && (
      <section className="dash-sec">
        <div className="dash-sec-h"><h2>Needs Attention</h2><span>สิ่งที่ต้องมีคนตามต่อ</span></div>
        <div className="dash-g2">
          {delayed.length > 0 && (
            <div className="dash-card">
              <div className="dash-card-title">Delayed — longest first</div>
              <button
                type="button"
                className="dash-card-sub dash-mb dash-linkbtn"
                onClick={() => setListModal({ sub: 'Needs Attention', title: 'Delayed', agents: delayed.map((it) => it._raw) })}
              >
                {delayed.length} รายการเลย launch date แล้วยังไม่ถึง Pilot · View all →
              </button>
              <div className="dash-late">
                {delayed.slice(0, 8).map((it) => (
                  <div key={it.id} onClick={() => onAgentClick?.(it._raw)}>
                    <span className="dash-late-n">{it.name}</span>
                    <span className="dash-late-d">{it.days}d late</span>
                    <span className="dash-late-m">{it.team || '—'} · {it.progress}% · {fmtDate(it.launch)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="dash-col">
            {delayByTeam.length > 0 && (
              <div className="dash-card">
                <div className="dash-card-title">Delayed by Owner Team</div>
                <div className="dash-card-sub dash-mb">ใครต้องตามก่อน · คลิกเพื่อดูรายการ</div>
                <div className="dash-bars">
                  {delayByTeam.map(([t, n, list]) => (
                    <button type="button" key={t} className="dash-rowbtn" onClick={() => setListModal({ sub: 'Delayed by Owner Team', title: t, agents: list })}>
                      <span title={t}>{t}</span>
                      <div className="dash-t"><i style={{ width: `${(n / (delayByTeam[0]?.[1] || 1)) * 100}%` }} /></div>
                      <b>{n}</b>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {dqRows.length > 0 && (
              <div className="dash-card">
                <div className="dash-card-title">Data Quality</div>
                <div className="dash-card-sub dash-mb">ข้อมูลที่ยังไม่ครบ · คลิกเพื่อดูรายการ</div>
                <div className="dash-dq">
                  {dqRows.map((r) => (
                    <button type="button" key={r.label} className="dash-rowbtn" onClick={() => setListModal({ sub: 'Data Quality', title: r.label, agents: r.list })}>
                      <span><span className="dash-sev">Fix</span>{r.label}</span><b>{r.list.length}</b>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
      )}

      {listModal && (
        <div className="sdlc-ovl" onClick={() => setListModal(null)}>
          <div className="sdlc-mbox" onClick={(e) => e.stopPropagation()}>
            <button className="sdlc-mclose" onClick={() => setListModal(null)}>✕</button>
            <div className="sdlc-msub">{listModal.sub}</div>
            <div className="sdlc-mtitle">{listModal.title}</div>
            <div className="sdlc-msec">Agents &amp; Skills ({listModal.agents.length})</div>
            {listModal.agents.map((a) => (
              <AgentQuickCard key={a.id} agent={a} onClick={() => { setListModal(null); onAgentClick?.(a); }} />
            ))}
          </div>
        </div>
      )}

      {procModal && (
        <div className="sdlc-ovl" onClick={() => setProcModal(null)}>
          <div className="sdlc-mbox" onClick={(e) => e.stopPropagation()}>
            <button className="sdlc-mclose" onClick={() => setProcModal(null)}>✕</button>
            <div className="sdlc-msub">{procModal.proc.id}{procModal.proc.owner ? ` · Process Owner: ${procModal.proc.owner}` : ''}</div>
            <div className="sdlc-mtitle">{procModal.proc.name || procModal.proc.id}</div>
            <div className="sdlc-msec">Agents &amp; Skills ({procModal.agents.length})</div>
            {procModal.agents.map((a) => (
              <AgentQuickCard key={a.id} agent={a} onClick={() => { setProcModal(null); onAgentClick?.(a); }} />
            ))}
          </div>
        </div>
      )}

      {roleModal && (
        <div className="sdlc-ovl" onClick={() => setRoleModal(null)}>
          <div className="sdlc-mbox" onClick={(e) => e.stopPropagation()}>
            <button className="sdlc-mclose" onClick={() => setRoleModal(null)}>✕</button>
            <div className="sdlc-msub">Role Group</div>
            <div className="sdlc-mtitle">{roleModal.group}</div>
            <div className="sdlc-msec">Agents &amp; Skills ({roleModal.agents.length})</div>
            {roleModal.agents.map((a) => (
              <AgentQuickCard key={a.id} agent={a} onClick={() => { setRoleModal(null); onAgentClick?.(a); }} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Reusable values as stored; '' = never set. Colours are one accent ramp
// (ordinal: most → least reusable) plus a neutral for "not set".
const REUSE = [
  { key: 'Reusable', label: 'Reusable', color: 'var(--accent)' },
  { key: 'Reusable with Conditions', label: 'Reusable with Conditions', color: 'color-mix(in srgb, var(--accent) 45%, var(--sf))' },
  { key: 'Non-reusable', label: 'Non-reusable', color: 'var(--tx2)' },
  { key: '', label: 'Not set', color: 'var(--bd)' },
];

// Engagement Depth buckets, deepest first — one hue (accent) stepping down,
// because depth is ordered, not a set of unrelated categories.
const DEPTH = [
  { key: 'used', label: 'Used', hint: 'กดไปใช้จริง', color: 'var(--accent)' },
  { key: 'viewed', label: 'Viewed only', hint: 'เปิดดูแต่ยังไม่กดใช้', color: 'color-mix(in srgb, var(--accent) 55%, var(--sf))' },
  { key: 'search', label: 'Found in search only', hint: 'ขึ้นในผลค้นหาแต่ไม่มีคนเปิด', color: 'color-mix(in srgb, var(--accent) 25%, var(--sf))' },
  { key: 'none', label: 'Untouched', hint: 'ยังไม่มีใครแตะเลย', color: 'var(--bd)' },
];

const TL_KEYS = ['done', 'pilot', 'ontime', 'risk', 'delay'];
// The saturated member of each TL_ST token family (the Timeline dot colour).
const TL_COLOR = { done: 'var(--tl-done-bd)', pilot: 'var(--tl-pilot-bd)', ontime: 'var(--tl-ontime-bd)', risk: 'var(--tl-risk-bd)', delay: 'var(--tl-delay-bd)' };
const TIER_NAME = { T1: 'Alpha Skill', T2: 'Incubate Agent', T3: 'Public Skill', T4: 'Enterprise Agent' };

// Ready to Use leads at full strength; the other statuses stay visible but
// muted so the card still reads as "how much is ready".
function StatusRing({ counts, total }) {
  const C = 2 * Math.PI * 26;
  let off = 0;
  return (
    <svg className="dash-ring" viewBox="0 0 64 64" role="img" aria-label="Status mix">
      <circle cx="32" cy="32" r="26" stroke="var(--sf2)" />
      {[...ST_ORDER].reverse().map((k) => {
        const f = total ? counts[k] / total : 0;
        const el = (
          <circle
            key={k} cx="32" cy="32" r="26" stroke={ST_DEF[k].dot}
            strokeDasharray={`${Math.max(0, C * f - 1.5)} ${C}`} strokeDashoffset={-C * off}
            transform="rotate(-90 32 32)" opacity={k === 'ru' ? 1 : 0.55}
          >
            <title>{`${ST_DEF[k].lb} ${counts[k]}`}</title>
          </circle>
        );
        off += f;
        return el;
      })}
    </svg>
  );
}

function Donut({ parts, total }) {
  const R = 46; const C = 2 * Math.PI * R;
  let off = 0;
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label="Reusable breakdown">
      {parts.map((p) => {
        const f = total ? p.n / total : 0;
        const el = (
          <circle
            key={p.key} cx="60" cy="60" r={R} fill="none" stroke={p.color} strokeWidth="16"
            strokeDasharray={`${Math.max(0, C * f - (p.n ? 1.5 : 0))} ${C}`} strokeDashoffset={-C * off}
            transform="rotate(-90 60 60)"
          >
            <title>{`${p.label} ${p.n}`}</title>
          </circle>
        );
        off += f;
        return el;
      })}
    </svg>
  );
}

function TierCell({ t, n, pct }) {
  const def = TIER_DEF[t];
  return (
    <div className="dash-cell" style={{ background: def.bg, borderColor: def.bd, color: def.color }} title={`${def.label} — ${n}`}>
      <span>{t} · {TIER_NAME[t]}</span>
      <b>{n}</b>
      <small>{pct}% ของทั้งหมด</small>
    </div>
  );
}

// categoryColor() is the same hash the sidebar uses, so a category keeps its colour everywhere.
function CatBar({ label, n, max }) {
  const color = categoryColor(label);
  return (
    <div title={`${label} ${n}`}>
      <span><b className="dash-cdot" style={{ background: color }} />{label}</span>
      <div className="dash-t"><i style={{ width: `${(n / max) * 100}%`, background: color }} /></div>
      <b>{n}</b>
    </div>
  );
}

function FunnelRow({ label, n, max, color }) {
  return (
    <div className="dash-fn-r">
      <span>{label}</span>
      <div className="dash-fn-t"><i style={{ width: `${max ? (n / max) * 100 : 0}%`, background: color }} /></div>
      <b>{n}</b>
    </div>
  );
}

// Stacked bars per launch month, one y-scale; per-segment <title> tooltip.
function MonthChart({ months }) {
  if (!months.length) return <div className="dash-empty">No launch dates yet</div>;
  const W = 520; const H = 230; const pl = 30; const pr = 8; const pt = 14; const pb = 26;
  const max = Math.max(...months.map((m) => TL_KEYS.reduce((s, k) => s + m[k], 0)));
  const step = max > 50 ? 20 : max > 20 ? 10 : 5;
  const yMax = Math.max(step, Math.ceil(max / step) * step);
  const y = (v) => pt + (H - pt - pb) * (1 - v / yMax);
  const bw = (W - pl - pr) / months.length;
  const ticks = [];
  for (let v = 0; v <= yMax; v += step) ticks.push(v);
  const mLabel = (k) => new Date(`${k}-01T00:00:00`).toLocaleString('en', { month: 'short' });
  return (
    <svg className="dash-mc" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Launch plan by month">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} stroke="var(--bd-soft)" />
          <text x={pl - 6} y={y(v) + 3.5} fontSize="10" textAnchor="end" fill="var(--mu)">{v}</text>
        </g>
      ))}
      {months.map((m, i) => {
        const x = pl + i * bw + bw * 0.2; const w = bw * 0.6;
        const segs = TL_KEYS.filter((k) => m[k]);
        let acc = 0;
        return (
          <g key={m.key}>
            {segs.map((k, j) => {
              const v = m[k]; const y0 = y(acc); const y1 = y(acc + v); acc += v;
              const h = Math.max(0, y0 - y1 - (j < segs.length - 1 ? 2 : 0));
              return (
                <rect key={k} x={x} y={y1} width={w} height={h} rx={j === segs.length - 1 ? 3 : 0} fill={TL_COLOR[k]}>
                  <title>{`${mLabel(m.key)} · ${TL_ST[k].lb} ${v}`}</title>
                </rect>
              );
            })}
            <text x={x + w / 2} y={y(acc) - 4} fontSize="10" fontWeight="700" textAnchor="middle" fill="var(--tx2)">{acc}</text>
            <text x={x + w / 2} y={H - 8} fontSize="10.5" textAnchor="middle" fill="var(--mu)">{mLabel(m.key)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Shared agent row for the click-through modals.
function AgentQuickCard({ agent: a, onClick }) {
  const sd = ST_DEF[agentStatus(a)];
  const t = getType(a);
  const progress = normalizeProgress(a?.devProgress);
  const ability = Array.isArray(a.coreAbility) ? a.coreAbility.join(', ') : a.coreAbility;
  const tier = getTier(a);
  const tierDef = TIER_DEF[tier];
  const scope = isInternalOrExternal(a);
  return (
    <div className="sdlc-mac" style={{ cursor: 'pointer' }} onClick={onClick}>
      <div className="sdlc-machdr">
        <span className={`uc-tb ${t === 'agent' ? 'tbag' : 'tbsk'}`}>{t.toUpperCase()}</span>
        <span className="tier-badge" style={{ color: tierDef.color, background: tierDef.bg, borderColor: tierDef.bd }} title={tierDef.label}>{tier}</span>
        <span className="sdlc-macname">{a.agentName}</span>
        <span className="scope-badge" style={{ position: 'static', marginLeft: 'auto', color: scope === 'External' ? '#0ea5e9' : 'var(--ag)' }} title={scope === 'External' ? 'Customer Facing' : 'Internal Use'}>
          {scope === 'External' ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="1" />
              <line x1="9" y1="10" x2="9" y2="10" /><line x1="15" y1="10" x2="15" y2="10" />
              <line x1="9" y1="14" x2="9" y2="14" /><line x1="15" y1="14" x2="15" y2="14" />
              <path d="M9 22v-4h6v4" />
            </svg>
          )}
        </span>
      </div>
      <div className="sdlc-mrow"><span className="sdlc-mk">Owner</span><span>{a.owner || '—'}</span></div>
      <div className="sdlc-mrow"><span className="sdlc-mk">Ability</span><span>{ability || '—'}</span></div>
      <div className="sdlc-mrow"><span className="sdlc-mk">Phase</span>
        <span className="sdlc-ph" style={{ background: sd.bg, color: sd.color, border: `1px solid ${sd.bd}` }}>{sd.lb}</span>
      </div>
      <div className="sdlc-mrow"><span className="sdlc-mk">Launch</span><span>{fmtDate(a.launchDate) || '—'}</span></div>
      <div style={{ marginTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--mu)' }}>
          <span>Progress</span><strong style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{progress}%</strong>
        </div>
        <div className="mpb"><div className={`mpf ${progressBucket(progress)}`} style={{ width: `${progress}%` }} /></div>
      </div>
    </div>
  );
}
