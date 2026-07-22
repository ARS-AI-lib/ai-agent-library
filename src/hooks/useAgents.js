import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { normalizeProgress } from '../lib/agentUtils';

// ⚠️ Field name note: the approval workflow uses `approvalStatus`
// (pending/approved/rejected) — NOT `status`. The legacy `status` field
// (value 'active' on all 144 migrated agents from Phase 1) is a different,
// unrelated flag and is left untouched.

function normalizeAgent(agent) {
  return { ...agent, devProgress: normalizeProgress(agent.devProgress) };
}

const MAX_ATTEMPTS = 5;

/**
 * Shared real-time agents subscription with retry-on-denied.
 *
 * Even after the caller gates on the /users role doc existing (`enabled`),
 * a brand-new user's FIRST agents-listen can still hit permission-denied:
 * the role doc was just auto-provisioned and the auth token is still
 * propagating, so the security rule's get(/users/{uid}) can momentarily fail.
 * Firestore does NOT auto-retry a denied listen — that's the "blank until
 * manual refresh" bug. So, exactly like useAuth does for the /users doc, we
 * re-attach a few times with a short backoff to let auth settle instead of
 * stranding the user on an empty screen.
 */
function useAgentSubscription({ field, value, enabled, map }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return;

    let unsub = null;
    let retryTimer = null;
    let cancelled = false;
    let attempts = 0;

    const q = query(collection(db, 'agents'), where(field, '==', value));

    const subscribe = () => {
      if (cancelled) return;
      attempts += 1;
      unsub = onSnapshot(
        q,
        (snap) => {
          if (cancelled) return;
          attempts = 0; // a successful read means auth is settled
          setData(snap.docs.map((d) => map({ id: d.id, ...d.data() })));
          setError(null);
          setLoading(false);
        },
        (err) => {
          if (cancelled) return;
          // Transient token/role-doc propagation denial → retry with backoff;
          // give up only after a few tries (a genuinely blocked read settles
          // to empty, as before).
          if (attempts < MAX_ATTEMPTS) {
            if (unsub) { unsub(); unsub = null; }
            retryTimer = setTimeout(subscribe, 400 * attempts);
          } else {
            setError(err);
            setLoading(false);
          }
        }
      );
    };

    subscribe();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (unsub) unsub();
    };
  }, [field, value, enabled]);

  return { data, loading, error };
}

/**
 * Real-time list of *approved* agents/skills (status === 'approved') —
 * this is the data backing the main Agent Library dashboard view.
 */
export function useApprovedAgents(enabled = true) {
  const { data, loading, error } = useAgentSubscription({
    field: 'approvalStatus', value: 'approved', enabled, map: normalizeAgent,
  });
  return { agents: data, loading, error };
}

/**
 * Real-time list of agents/skills pending approval — backs the
 * Pending Approval badge + queue (admin only).
 */
export function usePendingAgents(enabled = true) {
  const { data, loading } = useAgentSubscription({
    field: 'approvalStatus', value: 'pending', enabled, map: (a) => a,
  });
  return { pending: data, loading };
}

/**
 * Real-time list of agents with a pending deployment request
 * (deploymentStatus === 'requested') — Deploy Approval feature (2026-07-02).
 * Separate query from usePendingAgents: these are already-approved,
 * in-library agents asking to cross the 95% gate, not new submissions.
 */
export function useDeploymentRequests(enabled = true) {
  const { data, loading } = useAgentSubscription({
    field: 'deploymentStatus', value: 'requested', enabled, map: normalizeAgent,
  });
  return { deployRequests: data, loading };
}
