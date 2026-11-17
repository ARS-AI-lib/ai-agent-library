import { useCallback, useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { pruneReadIds } from '../lib/inbox';

// Per-user Inbox read state at /users/{uid}/inbox/state (rules: owner only).
// Server-side so unread counts match on every device. Every write goes through
// pruneReadIds: ids of announcements that no longer exist / have expired are
// dropped and the list is capped, so the doc cannot grow without bound.
const IDLE = { readIds: [], ready: false };

export default function useInboxState(uid, enabled) {
  const active = !!enabled && !!uid;
  const [state, setState] = useState({ uid: null, readIds: [], ready: false });

  useEffect(() => {
    if (!active) return undefined;
    return onSnapshot(
      doc(db, 'users', uid, 'inbox', 'state'),
      (snap) => {
        const ids = snap.exists() ? snap.data().readIds : [];
        setState({ uid, readIds: Array.isArray(ids) ? ids : [], ready: true });
      },
      () => setState({ uid, readIds: [], ready: true }),
    );
  }, [active, uid]);

  const current = active && state.uid === uid ? state : IDLE;
  const readIds = useMemo(() => new Set(current.readIds), [current.readIds]);

  const write = useCallback((ids) => {
    if (!active) return;
    // Optimistic: the badge drops immediately; the snapshot confirms it.
    setState({ uid, readIds: ids, ready: true });
    setDoc(doc(db, 'users', uid, 'inbox', 'state'), { readIds: ids, updatedAt: serverTimestamp() }, { merge: true })
      .catch((e) => console.warn('inbox state write failed', e));
  }, [active, uid]);

  // knownIds = ids of the announcements currently active for this user.
  const markRead = useCallback((id, knownIds) => {
    if (!id || current.readIds.includes(id)) return;
    write(pruneReadIds([...current.readIds, id], knownIds));
  }, [current.readIds, write]);

  const markAllRead = useCallback((ids) => {
    const next = pruneReadIds([...current.readIds, ...(ids || [])], ids);
    if (next.length === current.readIds.length && next.every((x, i) => x === current.readIds[i])) return;
    write(next);
  }, [current.readIds, write]);

  return { readIds, ready: current.ready, markRead, markAllRead };
}
