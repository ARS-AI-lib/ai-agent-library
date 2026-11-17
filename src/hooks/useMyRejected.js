import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';

// The signed-in user's own rejected / withdrawn items. Rejected docs are not in
// the approved or pending listeners, so this is the createdBy==uid query the
// rules already allow (same one PendingApprovalModal uses). Shared by
// My Submissions and the Inbox; the listener lives only while the caller is
// mounted.
export default function useMyRejected(uid) {
  const [rejected, setRejected] = useState([]);
  useEffect(() => {
    if (!uid) return undefined;
    const q = query(collection(db, 'agents'), where('createdBy', '==', uid));
    return onSnapshot(
      q,
      (snap) => setRejected(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => a.approvalStatus === 'rejected')),
      () => setRejected([]),
    );
  }, [uid]);
  return rejected;
}
