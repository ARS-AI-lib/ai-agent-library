import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { toJsDate } from '../lib/agentUtils';

// Messages addressed to one person (/inboxMessages, e.g. assessment backfill).
// The rules allow a read only when toEmail == the lower-cased token email, so
// the query must filter on exactly that. Sorted client-side (no index).
// No listener until the email is known.
export default function useInboxMessages(email) {
  const key = String(email || '').toLowerCase();
  const [state, setState] = useState({ key: null, messages: [] });

  useEffect(() => {
    if (!key) return undefined;
    const q = query(collection(db, 'inboxMessages'), where('toEmail', '==', key));
    return onSnapshot(
      q,
      (snap) => {
        const messages = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (toJsDate(b.createdAt)?.getTime() || 0) - (toJsDate(a.createdAt)?.getTime() || 0));
        setState({ key, messages });
      },
      () => setState({ key, messages: [] }),
    );
  }, [key]);

  return { messages: key && state.key === key ? state.messages : [] };
}
