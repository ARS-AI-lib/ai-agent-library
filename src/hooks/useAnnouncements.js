import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { allowedAudiences } from '../lib/inbox';

// Announcements the signed-in role may read (Inbox, 2026-11-17).
//
// The query MUST constrain `audience` to exactly the audiences the rules allow
// for this role (allowedAudiences mirrors `audienceOk` in firestore.rules) —
// a list query without that filter is rejected by the rules as a whole.
// Sorting is client-side (activeAnnouncements), so no composite index.
// A role with no audiences (no role yet / unknown) never attaches a listener.
export default function useAnnouncements(role, enabled) {
  const audiences = useMemo(() => allowedAudiences(role), [role]);
  const key = audiences.join(',');
  const active = !!enabled && audiences.length > 0;
  const [state, setState] = useState({ key: null, announcements: [], loaded: false });

  useEffect(() => {
    if (!active) return undefined;
    const q = query(collection(db, 'announcements'), where('audience', 'in', key.split(',')));
    return onSnapshot(
      q,
      (snap) => setState({ key, announcements: snap.docs.map((d) => ({ id: d.id, ...d.data() })), loaded: true }),
      () => setState({ key, announcements: [], loaded: true }),
    );
  }, [active, key]);

  // Results from a previous role's listener are never shown for the current one.
  if (!active) return { announcements: [], loading: false };
  if (state.key !== key) return { announcements: [], loading: true };
  return { announcements: state.announcements, loading: !state.loaded };
}
