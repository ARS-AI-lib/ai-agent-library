import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * Reads /config/schema — the single document holding all choice-field
 * options (SDLC Stage, SDLC Process Mapping, Development Phase,
 * Core Ability, Reusable). Stored in Firestore (not hardcoded) so an
 * admin can edit the lists without a redeploy.
 *
 * Expected doc shape (flexible — falls back to [] per field if missing):
 * {
 *   sdlcStage: string[],
 *   sdlcProcessMapping: string[],
 *   developmentPhase: string[],
 *   coreAbility: string[],
 *   reusable: string[],
 * }
 */
export function useConfigSchema() {
  const [schema, setSchema] = useState({
    sdlcStage: [],
    sdlcProcessMapping: [],
    developmentPhase: [],
    coreAbility: [],
    reusable: [],
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

  return { schema, loading };
}
