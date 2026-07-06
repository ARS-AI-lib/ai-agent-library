import { useEffect, useState } from 'react';
import { doc, onSnapshot, updateDoc, setDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * Reads /config/schema — the single document holding all choice-field
 * options (SDLC Stage, SDLC Process Mapping, Development Phase,
 * Core Ability, Reusable, Related Role). Stored in Firestore (not
 * hardcoded) so an admin can edit the lists without a redeploy.
 *
 * Expected doc shape (flexible — falls back to [] per field if missing):
 * {
 *   sdlcStage: string[],
 *   sdlcProcessMapping: string[],
 *   developmentPhase: string[],
 *   coreAbility: string[],
 *   reusable: string[],
 *   relatedRole: string[],
 * }
 */
export function useConfigSchema() {
  const [schema, setSchema] = useState({
    sdlcStage: [],
    sdlcProcessMapping: [],
    developmentPhase: [],
    coreAbility: [],
    reusable: [],
    relatedRole: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = doc(db, 'config', 'schema');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) setSchema((prev) => ({ ...prev, ...snap.data() }));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, []);

  // Grow-only: any known user may add newly-typed Related Role values to the
  // shared list (firestore.rules scopes this write to ONLY the relatedRole
  // field, and only allows appending — never removing existing values).
  // De-dupe is case-insensitive against the current schema list.
  async function addRelatedRoles(newRoles) {
    const existing = new Set((schema.relatedRole || []).map((r) => r.toLowerCase()));
    const toAdd = [...new Set(newRoles.map((r) => r.trim()).filter(Boolean))]
      .filter((r) => !existing.has(r.toLowerCase()));
    if (!toAdd.length) return;
    const ref = doc(db, 'config', 'schema');
    try {
      await updateDoc(ref, { relatedRole: arrayUnion(...toAdd) });
    } catch {
      // Doc may not exist yet — fall back to a merge-create.
      await setDoc(ref, { relatedRole: toAdd }, { merge: true });
    }
  }

  return { schema, loading, addRelatedRoles };
}
