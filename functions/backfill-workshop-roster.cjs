// One-off: applies the finalized Workshop roster (a Google Sheet the user
// maintains: Team,Fullname (English),Email,Level) to Firestore. Part of the
// 2026-09-17 round.
//
// What it does:
//   1. Ensures workshopTeams docs for team numbers 3-18 exist (teams 1/2 are
//      the pre-existing test teams and are reused as-is — no create/rename).
//   2. For every sheet row whose email already has a /users doc: force-sets
//      `role` to exactly what the sheet says (Workshop -> 'workshop', Staff
//      -> 'staff'), even if that downgrades an existing higher role (this is
//      an explicit, locked decision — not a bug). Workshop-level rows also
//      get their uid added to the matching team's members/memberNames.
//      Staff-level rows never touch team membership.
//   3. For every sheet row whose email has NO /users doc yet (never logged
//      in): writes a pendingRoleGrants/{emailLower} doc, consumed by the
//      claimPendingRoleGrant Cloud Function on that person's first login.
//
// The roster is fetched LIVE from the sheet's CSV export at run time and is
// never committed to this repo (it's personal data — name/email/team).
//
//   node functions/backfill-workshop-roster.cjs            # dry run
//   node functions/backfill-workshop-roster.cjs --apply    # write
//
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1ZtKdVKc5sNcC0th92GSokgsyQKxIL_Iphh0NocMHTpo/export?format=csv';
const ROLE_MAP = { Workshop: 'workshop', Staff: 'staff' };
// Higher index = higher privilege, for the dry-run downgrade warning only —
// does not gate any behavior, per the locked "force per sheet, always"
// decision.
const ROLE_RANK = { user: 0, workshop: 1, staff: 1, approver: 2, committee: 3, admin: 4 };

const app = initializeApp({ credential: applicationDefault(), projectId: 'wolfy-481609' });
const db = getFirestore(app, 'ai-agent-lib');

// Minimal character-by-character CSV parser (quote-aware, per this repo's
// CLAUDE.md §6 convention) even though this specific sheet is verified
// quote/comma-clean — keeps the script correct if a name is edited later to
// contain a comma.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ''])));
}

async function fetchRoster() {
  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  return parseCsv(await res.text());
}

// Must stay in sync with claimNextTeamNumber()/createTeamDoc() in
// src/components/WorkshopPage.jsx — same counter doc, same numbering scheme,
// duplicated here only because the client version uses the client Firestore
// SDK's runTransaction/serverTimestamp, which this Admin-SDK script can't
// import directly.
async function claimNextTeamNumber() {
  const counterRef = db.doc('config/workshopTeamCounter');
  const n = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const cur = snap.exists ? (snap.data().next || 1) : 1;
    tx.set(counterRef, { next: cur + 1 }, { merge: true });
    return cur;
  });
  return String(n).padStart(2, '0');
}

(async () => {
  const rows = await fetchRoster();
  console.log(`Fetched ${rows.length} roster row(s).`);

  // 1. Ensure teams 3-18 exist.
  const teamsSnap = await db.collection('workshopTeams').get();
  const teamsByNumber = new Map(teamsSnap.docs.map((d) => [d.data().number, d]));
  const teamsToCreate = [];
  for (let n = 3; n <= 18; n++) {
    const padded = String(n).padStart(2, '0');
    if (!teamsByNumber.has(padded)) teamsToCreate.push({ name: String(n), number: padded });
  }
  console.log(`Teams 1-18: ${18 - teamsToCreate.length} already exist, ${teamsToCreate.length} to create.`);
  if (APPLY) {
    for (const t of teamsToCreate) {
      const ref = await db.collection('workshopTeams').add({
        name: t.name,
        createdBy: 'migration',
        createdByName: 'Migration Script',
        createdAt: FieldValue.serverTimestamp(),
      });
      const number = await claimNextTeamNumber();
      await ref.update({ number });
      teamsByNumber.set(number, await ref.get());
      console.log(`  created team "${t.name}" -> number ${number}`);
    }
  }

  // 2. In-memory email -> user-doc map (single .get(), no .where(), per this
  // repo's established convention).
  const usersSnap = await db.collection('users').get();
  const userByEmail = new Map(
    usersSnap.docs.map((d) => [(d.data().email || '').toLowerCase(), { id: d.id, ...d.data() }])
  );

  const counters = { usersUpdated: 0, downgrades: 0, teamJoinsAdded: 0, pendingGrantsCreated: 0, skipped: 0 };
  const teamWrites = new Map(); // teamNumber -> { uids: [], names: {} }

  for (const r of rows) {
    const email = (r.Email || '').trim().toLowerCase();
    const name = (r['Fullname (English)'] || '').trim();
    const level = (r.Level || '').trim();
    const role = ROLE_MAP[level];
    if (!role || !email) { counters.skipped++; console.log(`  skipping malformed row: ${JSON.stringify(r)}`); continue; }
    const teamNumber = role === 'workshop' ? String(r.Team || '').trim().padStart(2, '0') : null;

    const existingUser = userByEmail.get(email);
    if (existingUser) {
      const oldRank = ROLE_RANK[existingUser.role] ?? -1;
      const newRank = ROLE_RANK[role] ?? -1;
      if (oldRank > newRank) {
        counters.downgrades++;
        console.log(`  ⚠ DOWNGRADE: ${email} (was "${existingUser.role}", now "${role}")`);
      }
      counters.usersUpdated++;
      if (APPLY) {
        await db.collection('users').doc(existingUser.id).update({ role, updatedAt: FieldValue.serverTimestamp() });
      }
      if (role === 'workshop' && teamNumber) {
        counters.teamJoinsAdded++;
        if (!teamWrites.has(teamNumber)) teamWrites.set(teamNumber, { uids: [], names: {} });
        const tw = teamWrites.get(teamNumber);
        tw.uids.push(existingUser.id);
        tw.names[existingUser.id] = name || email;
      }
    } else {
      counters.pendingGrantsCreated++;
      if (APPLY) {
        await db.collection('pendingRoleGrants').doc(email).set({
          role,
          teamNumber,
          email,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: 'backfill-workshop-roster.cjs',
        });
      }
    }
  }

  // 3. Batched per-team membership writes.
  for (const [teamNumber, tw] of teamWrites) {
    const teamDoc = teamsByNumber.get(teamNumber);
    if (!teamDoc || !teamDoc.exists) {
      console.log(`  ⚠ no workshopTeams doc for number ${teamNumber} — ${tw.uids.length} join(s) skipped`);
      continue;
    }
    console.log(`  team #${teamNumber}: +${tw.uids.length} member(s)`);
    if (APPLY) {
      const patch = { names: {} };
      const existing = teamDoc.data() || {};
      const members = [...new Set([...(existing.members || []), ...tw.uids])];
      const memberNames = { ...(existing.memberNames || {}), ...tw.names };
      await teamDoc.ref.update({ members, memberNames });
    }
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'}:`, counters);
  if (!APPLY) console.log('re-run with --apply to write.');
})();
