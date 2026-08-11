import { useEffect, useState } from 'react';
import { doc, onSnapshot, updateDoc, setDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../lib/firebase';

const MAX_ATTEMPTS = 5;

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
 *   category: string[],   // 2026-08: left-sidebar shortcuts — see agent-skill-structured-horizon plan
 *   team: string[],       // 2026-08-10: canonical org team list (Owner field autocomplete + filter
 *                          // options), seeded from an org roster. Grow-only self-service like
 *                          // relatedRole — free-typing a new team name in PreRegModal appends it.
 *                          // NOT retroactive: existing agent.owner values (free text, ~20 distinct)
 *                          // predate this list and mostly don't match it — left untouched per
 *                          // explicit decision, so this only shapes NEW submissions going forward.
 *   approveArea: string[],       // 2026-08-10: the 12 approver areas — see src/lib/approveAreas.js
 *   categoryAreaMap: object,     // 2026-08-10: {categoryName: areaName} — live overrides/additions on
 *                                 top of approveAreas.js's baked-in CATEGORY_AREA, written by
 *                                 CategoryApprovalPanel when an admin approves a NEW category (a category
 *                                 that didn't exist when CATEGORY_AREA was written has no code-level
 *                                 mapping, so without this every agent that gets it would fall through to
 *                                 the role layer or unresolved — the exact bug this whole feature fixes).
 * }
 *
 * `enabled` gates the subscription the same way useApprovedAgents/
 * usePendingAgents/useDeploymentRequests do (useAgents.js) — this hook used
 * to subscribe unconditionally on mount, before Firebase Auth had finished
 * restoring the session. The very first onSnapshot attached while
 * auth.currentUser was still null, the read got denied by
 * firestore.rules' isKnownUser() check, and — unlike a transient network
 * error — Firestore treats permission-denied as terminal: it does NOT
 * retry once auth later resolves. The sidebar's Category/SDLC Stage groups
 * (driven by this schema) stayed empty until something created a brand new
 * listener, i.e. a manual page refresh. The retry-with-backoff loop below
 * covers the remaining case where the role doc itself hasn't propagated yet
 * even after auth is ready (same reasoning as useAgents.js's identical loop).
 */
export function useConfigSchema(enabled = true) {
  const [schema, setSchema] = useState({
    sdlcStage: [],
    sdlcProcessMapping: [],
    developmentPhase: [],
    coreAbility: [],
    reusable: [],
    relatedRole: [],
    category: [],
    approveArea: [],
    categoryAreaMap: {},
    team: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;

    let unsub = null;
    let retryTimer = null;
    let cancelled = false;
    let attempts = 0;

    const ref = doc(db, 'config', 'schema');

    const subscribe = () => {
      if (cancelled) return;
      attempts += 1;
      unsub = onSnapshot(
        ref,
        (snap) => {
          if (cancelled) return;
          attempts = 0; // a successful read means auth is settled
          if (snap.exists()) setSchema((prev) => ({ ...prev, ...snap.data() }));
          setLoading(false);
        },
        (err) => {
          if (cancelled) return;
          if (attempts < MAX_ATTEMPTS) {
            if (unsub) { unsub(); unsub = null; }
            retryTimer = setTimeout(subscribe, 400 * attempts);
          } else {
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
  }, [enabled]);

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

  // Same grow-only pattern as addRelatedRoles — a user typing a team name
  // that isn't in the list yet (PreRegModal's Owner field) appends it rather
  // than being blocked. firestore.rules scopes this to ONLY the team field
  // and only allows appending.
  async function addTeams(newTeams) {
    const existing = new Set((schema.team || []).map((t) => t.toLowerCase()));
    const toAdd = [...new Set(newTeams.map((t) => t.trim()).filter(Boolean))]
      .filter((t) => !existing.has(t.toLowerCase()));
    if (!toAdd.length) return;
    const ref = doc(db, 'config', 'schema');
    try {
      await updateDoc(ref, { team: arrayUnion(...toAdd) });
    } catch {
      await setDoc(ref, { team: toAdd }, { merge: true });
    }
  }

  return { schema, loading, addRelatedRoles, addTeams };
}
