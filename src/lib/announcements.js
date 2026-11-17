import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

// Announcement writes (Inbox, 2026-11-17). The payload shape must satisfy
// `validAnnouncement()` in firestore.rules, and is mirrored by the payload
// constants in functions/verify-inbox-rules.cjs — keep them equal.
// Title is stored trimmed: the rules check size() on the stored value.
const editable = ({ title, body, audience, pinned, expiresAt }) => ({
  title: String(title).trim(),
  body,
  audience,
  pinned: !!pinned,
  expiresAt: expiresAt || null,
});

export async function createAnnouncement(user, fields) {
  const ref = await addDoc(collection(db, 'announcements'), {
    ...editable(fields),
    createdBy: user.uid,
    createdByName: user.displayName || user.email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateAnnouncement(id, fields) {
  await updateDoc(doc(db, 'announcements', id), { ...editable(fields), updatedAt: serverTimestamp() });
}

export async function deleteAnnouncement(id) {
  await deleteDoc(doc(db, 'announcements', id));
}
