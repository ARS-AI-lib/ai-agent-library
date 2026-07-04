import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';

// ⚠️ Field name note: the approval workflow uses `approvalStatus`
// (pending/approved/rejected) — NOT `status`. The legacy `status` field
// (value 'active' on all 144 migrated agents from Phase 1) is a different,
// unrelated flag and is left untouched.

// devProgress is stored as a plain number since the 2026-07-02 migration
// (tmp/migrate-devprogress-deploy.cjs) — the old string format ("90%") is
// kept as a defensive fallback here only, in case any doc was missed.
function normalizeAgent(agent) {
  const raw = agent.devProgress;
  const num = typeof raw === 'number' ? raw : parseInt(String(raw || '').replace('%', ''), 10);
  return { ...agent, devProgress: isNaN(num) ? 0 : num };
}

/**
 * Real-time list of *approved* agents/skills (status === 'approved') —
 * this is the data backing the main Agent Library dashboard view.
 */
export function useApprovedAgents(enabled = true) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Wait until the caller signals the user's /users role doc exists —
    // subscribing before it does gets a permanent permission-denied on the
    // agents read (security rules resolve role via a get() on /users/{uid}),
    // and Firestore listeners don't auto-retry a denied subscription.
    if (!enabled) return;
    const q = query(collection(db, 'agents'), where('approvalStatus', '==', 'approved'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setAgents(snap.docs.map((d) => normalizeAgent({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );
    return unsub;
  }, [enabled]);

  return { agents, loading, error };
}

/**
 * Real-time list of agents/skills pending approval — backs the
 * Pending Approval badge + queue (admin only).
 */
export function usePendingAgents(enabled = true) {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    const q = query(collection(db, 'agents'), where('approvalStatus', '==', 'pending'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPending(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [enabled]);

  return { pending, loading };
}

/**
 * Real-time list of agents with a pending deployment request
 * (deploymentStatus === 'requested') — Deploy Approval feature (2026-07-02).
 * Separate query from usePendingAgents: these are already-approved,
 * in-library agents asking to cross the 95% gate, not new submissions.
 */
export function useDeploymentRequests(enabled = true) {
  const [deployRequests, setDeployRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    const q = query(collection(db, 'agents'), where('deploymentStatus', '==', 'requested'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setDeployRequests(snap.docs.map((d) => normalizeAgent({ id: d.id, ...d.data() })));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [enabled]);

  return { deployRequests, loading };
}
