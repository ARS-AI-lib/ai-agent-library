import { useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut } from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { auth, googleProvider, db, isAllowedEmail, ALLOWED_DOMAINS_LABEL } from '../lib/firebase';
import { setDirectoryToken, warmDirectory } from '../lib/directory';

/**
 * Tracks Firebase Auth state + the matching /users/{uid} role document.
 * Returns { user, role, loading, domainError, signIn, signOut }.
 *
 * role is one of 'user' | 'staff' | 'approver' | 'committee' | 'admin' | null
 * (null while loading or if no /users doc exists yet — treat null as "no access").
 *
 * Permission model:
 *   admin     — everything, incl. user management.
 *   committee — everything admin can do EXCEPT user management (approve/
 *               reject in any area, not just their own approveAreas).
 *   approver  — approve/reject + progress-update, both scoped to their own
 *               approveAreas; can submit new ideas + (future) chat.
 *   staff     — same rights as 'user' (submit ideas, chat, own-progress
 *               update) PLUS the "All Data" export button (2026-07-06) —
 *               export-only widening, no approve/edit/user-mgmt rights.
 *   user      — base tier: submit new ideas, chat, see/withdraw only their
 *               own pending submissions, update progress on agents they
 *               created (while devProgress < 100).
 * Every tier can submit an idea — there is no role that can't.
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [approveAreas, setApproveAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [domainError, setDomainError] = useState(false);
  // false while the /users role doc is still being resolved (incl. retries) —
  // lets the app show a spinner instead of flashing the "no access" screen
  // during the brief post-login token-propagation window.
  const [roleReady, setRoleReady] = useState(false);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u && !isAllowedEmail(u.email)) {
        setDomainError(true);
      } else {
        setDomainError(false);
      }
    });
    return unsubAuth;
  }, []);

  useEffect(() => {
    if (!user || domainError) {
      setRole(null);
      setApproveAreas([]);
      setRoleReady(!!domainError); // domain-rejected is a settled state; logged-out isn't relevant
      return;
    }

    setRoleReady(false);
    let unsub = null;
    let retryTimer = null;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 5;

    const ref = doc(db, 'users', user.uid);

    // Attach the /users listener. Right after signInWithPopup the Firestore
    // auth token can lag a beat behind onAuthStateChanged, so the very first
    // listen may hit the security rule with request.auth still null →
    // permission-denied. Firestore does NOT auto-retry a denied listen, which
    // is exactly the "blank until manual refresh" bug. So on error we
    // re-attach a few times with a short backoff to let the token propagate,
    // instead of giving up and stranding the user on the no-access screen.
    const subscribe = () => {
      if (cancelled) return;
      attempts += 1;
      unsub = onSnapshot(
        ref,
        (snap) => {
          if (cancelled) return;
          attempts = 0; // a successful read means auth is settled
          if (!snap.exists()) {
            // First sign-in for an allowed-domain account. Route through the
            // claimPendingRoleGrant callable so a pre-seeded role/team (from
            // the 2026-09-17 roster backfill) is honored immediately instead
            // of always landing at the base "user" tier — but a Cloud
            // Function outage must never block login, so any callable
            // failure falls back to the exact direct setDoc this replaces
            // (security rules only permit that self-create with
            // role=="user"; approver/committee/admin are still only granted
            // later by an admin on that fallback path). Either path re-fires
            // this listener once the write lands.
            httpsCallable(getFunctions(undefined, 'asia-southeast1'), 'claimPendingRoleGrant')()
              .catch(() => setDoc(ref, {
                role: 'user',
                email: user.email || '',
                displayName: user.displayName || '',
                approveAreas: [],
                createdAt: serverTimestamp(),
              }))
              .catch(() => { if (!cancelled) { setRole(null); setApproveAreas([]); } });
            return;
          }
          const data = snap.data();
          setRole(data?.role || null);
          setApproveAreas(Array.isArray(data?.approveAreas) ? data.approveAreas : []);
          setRoleReady(true);
        },
        () => {
          if (cancelled) return;
          // Transient token-propagation denial → retry; give up only after a
          // few tries (a genuinely blocked user stays null, as before).
          if (attempts < MAX_ATTEMPTS) {
            retryTimer = setTimeout(subscribe, 400 * attempts);
          } else {
            setRole(null);
            setApproveAreas([]);
            setRoleReady(true); // settled: confirmed no access
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
  }, [user, domainError]);

  async function signIn() {
    const result = await signInWithPopup(auth, googleProvider);
    if (!isAllowedEmail(result.user.email)) {
      await fbSignOut(auth);
      setDomainError(true);
      throw new Error(`อีเมลนี้ไม่อยู่ใน domain ที่อนุญาต (${ALLOWED_DOMAINS_LABEL})`);
    }
    // Preload the Firestore-cached directory in the background right after
    // login so it's warm before the user opens the New Entry form. No Google
    // token needed — the directory.readonly scope is only requested on-demand
    // when an admin runs a sync (see src/lib/directory.js).
    warmDirectory();
  }

  async function logout() {
    setDirectoryToken(null);
    await fbSignOut(auth);
  }

  const isAdmin = role === 'admin';
  const isCommittee = role === 'committee' || isAdmin;

  return {
    user,
    role,
    approveAreas,
    loading,
    roleReady,
    domainError,
    // Any signed-in, allowed-domain user with a role doc can submit an idea
    // and (later) use chat — there is no tier that can't.
    canSubmitIdea: !!role,
    // Approve/reject + progress-update UI gates by combining these with the
    // agent's own createdBy/approvedBy or agentApproveAreas() as appropriate.
    isAdmin,
    isCommittee,
    canManageUsers: isAdmin,
    signIn,
    signOut: logout,
  };
}
