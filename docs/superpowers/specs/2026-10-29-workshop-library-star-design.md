# Workshop Library Star — Design (short)

Date: 2026-10-29 · Owner: Tinnapat (user) · Status: awaiting approval

## Intent & Why

On the Workshop board, a **Done** sticker means "this skill is ready to register
in the real Library" — but it never shows whether the team *actually did*.
The board should mark Done stickers whose skill is already on the Library with a
**star shape**, so the board itself answers "ลง Library แล้วหรือยัง" at a glance.

## Goals / Non-goals / Anti-goals

- **Goals:** Done stickers with a unique matching approved Library item render as
  a star (team number kept inside). Works on both the main board and the
  Use Cases board. Retroactive (stickers made before this feature) and
  real-time (Library changes stream in via the existing `onSnapshot`).
- **Non-goals:** No Firestore write, no rules change, no functions change →
  **hosting-only deploy**. Popup, Review Queue and the "Register for AI Library"
  button are untouched. Stickers in other statuses (`idea/dev/qa`) never star.
- **Anti-goals:** Never *claim* a registration that isn't there — if there is no
  matching Library item (or the match is ambiguous) the sticker stays a plain
  Done circle. No change that could mis-route approve queues or touch scope.

## Constraints

- Library items come from `agents` of `useApprovedAgents()` (already streamed
  into `WorkshopPage` at line ~619) = **approved AND not archived** only. An
  archived Library item therefore falls back to plain Done — accepted.
- Detecting "registered" on the Library has no stored link inside the Workshop
  sticker: `openPreRegForIdea` only prefills the pre-reg form. So the match has
  to be computed.

## Approaches

1. **Permanent link-back** — stamp `idea.registeredAgentId` at submit and
   rework the Register flow (plus historical stickers, plus sync jobs).
   Accurate but touches forms for both routes, needs Firestore writes + a
   backfill, and cannot cover stickers already made — dropped as
   disproportionate for a display-only badge.
2. **Name matching** (picked by the user) — fold the sticker's skill name
   against the Library's approved names; mark the sticker a star only when
   exactly one item matches. No writes, works retroactively, reuses the
   pattern already proven by Portfolio adoption links ("case/space folded
   names; a name shared by 2+ items is skipped").
3. **Field-written flag** — add a status field on Workshop ideas and update it
   wherever skills are registered. Doubles bookkeeping for every register
   path → rejected.

Visual options shown to the user: plain star / **star + team number** (picked B)
/ ★ text glyph (rejected because ★ already reads as planet-rating in this app —
   `v7-ac-stats`/`v7-review-stars` — it would look like a rating, not a board badge).

## What the user decided

- Detection: **name matching** (option 2 above).
- Scope: **board stickers only**; popup/queue/Register unchanged.
- Visual: **B — star shape with the team number inside**.

## The how (decided details)

- The match key mirrors the Portfolio adoption rule: fold the name
  case-insensitively, strip zero-width chars, collapse whitespace
  (`portfolioAdoptionRules.js foldName`). Matching name = `agent.agentName`.
- Done sticker stars only when **exactly one** approved Library item matches;
  disputed/duplicated Library names resolve to nothing (plain Done) — a wrong
  star is worse than no star.
- The team's 2-digit number stays inside the star, same font size as today.

## Left to the builder (my calls)

- **Color & shape:** the star is drawn with a CSS `clip-path` polygon (avoids a
  new asset and reads as a shape, not a rating). **Gold (`#f5b301`)** instead of
  the Done blue `#1aacf0`, so "Done + on Library" is distinguishable from plain
  Done at a glance; keep the white number + hover scale. One-line change if the
  user prefers a different color.
- Matching is computed in `WorkshopPage` and passed into `WorkshopStickers`
  (single place, shared by board + Use Cases board).
- Empty skill name on the idea → no match → plain Done. Archived Library items
  never match (see Constraints).
- Verification: `node --check` on the JSX + the existing project build /
  visual smoke test before deploy. Deploy = hosting only, confirmed with the
  user first (locked production rule).