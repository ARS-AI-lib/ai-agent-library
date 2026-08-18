import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * Live per-agent usage counters + rating histogram, as a Map(agentId → stats).
 *
 * One collection subscription, not one read per card: /agentStats has exactly
 * one small doc per agent (~239), so a single snapshot feeds every card, the
 * Dashboard and the sort at once. Cards render frequently, so the alternative —
 * a read per card — would be 239 reads per page view.
 *
 * A failure here is intentionally silent and non-fatal: stats are decoration
 * over the library, never a precondition for it. If /agentStats is unreadable
 * (most likely because firestore.rules hasn't been published yet) the map stays
 * empty, every agent shows "ยังไม่มีรีวิว", and nothing else changes.
 * That is also why there is no retry/backoff like useAgents has — nothing
 * breaks while it is missing, so there is nothing worth retrying for.
 */
export function useAgentStats(enabled = true) {
  const [statsById, setStatsById] = useState(() => new Map());

  useEffect(() => {
    if (!enabled) return undefined;
    const unsub = onSnapshot(
      collection(db, 'agentStats'),
      (snap) => setStatsById(new Map(snap.docs.map((d) => [d.id, d.data()]))),
      (err) => {
        console.warn('agentStats unavailable (stats will show as empty):', err?.message || err);
        setStatsById(new Map());
      },
    );
    return unsub;
  }, [enabled]);

  return statsById;
}
