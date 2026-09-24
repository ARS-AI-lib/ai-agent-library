import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { buildRoleGroupIndex } from '../lib/roleGroups';

// Live /config/roleGroups (Role Group Management, 2026-09-24). Returns the
// lookup index from buildRoleGroupIndex(); until the doc arrives — or if it
// is missing — the index is built from the code fallback, so the Dashboard
// never renders empty. Writes never happen here: they go through the
// manageRoleGroups callable.
export function useRoleGroups() {
  const [groups, setGroups] = useState(null);
  useEffect(() => onSnapshot(
    doc(db, 'config', 'roleGroups'),
    (snap) => setGroups(snap.exists() ? snap.data().groups || null : null),
    () => setGroups(null),
  ), []);
  return useMemo(() => buildRoleGroupIndex(groups), [groups]);
}
