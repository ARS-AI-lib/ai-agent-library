// Single source of truth for "which pending items is THIS user responsible
// for?" — used by both the Pending queue itself (PendingApprovalModal) and the
// badge counter on the Pending button (App.jsx).
//
// 2026-08-12: these two disagreed. The modal filtered by the viewer's
// approveAreas, but the badge counted `pending.length + deployRequests.length`
// raw, so an approver saw a badge of N, clicked it, and found an empty (or
// much shorter) list — the difference being items belonging to OTHER areas
// that they can neither see nor act on. Reported as "เห็นเลข badge แต่กดเข้าไป
// ไม่เห็นข้อมูล". Rather than copy the filter into App.jsx (which is how the
// two drifted apart in the first place), both now call these functions — same
// anti-drift discipline as normalizeProgress / agentApproveAreas /
// isInternalToolName.
import { agentApproveAreas } from './approveAreas';
import { isPairedSubSkill, canDecideRename } from './agentUtils';

/**
 * Build the viewer context both filters need.
 *   fullAccess     admin/committee see and may act on everything, any area.
 *   areas          the viewer's own approveAreas (Set).
 *   uid            used for the base-user "own submissions" fallback.
 *   categoryAreaMap  live /config/schema.categoryAreaMap overrides, so a
 *                  brand-new category routes correctly before approveAreas.js's
 *                  code-level table is updated.
 */
export function queueViewer({ isAdmin, isCommittee, role, approveAreas = [], uid, categoryAreaMap }) {
  return {
    fullAccess: !!(isAdmin || isCommittee),
    areas: new Set(approveAreas || []),
    uid: uid || null,
    categoryAreaMap,
    // Rename decisions use a NARROWER set than fullAccess — admin or an
    // approver of the area, never committee and never staff (canDecideRename,
    // mirroring the server's RENAME_DECIDER_ROLES). So the raw role and the
    // raw area list are carried through rather than collapsed into fullAccess.
    role: role || null,
    isAdmin: !!isAdmin,
    areaList: Array.isArray(approveAreas) ? approveAreas : [],
  };
}

function inMyAreas(agent, v) {
  return agentApproveAreas(agent, v.categoryAreaMap).some((area) => v.areas.has(area));
}

/**
 * New-entry approval queue, scoped to the viewer.
 *   admin/committee → everything
 *   approver with matching items → just their areas
 *   otherwise → only their own submissions, so a base "user" can still track
 *     and withdraw what they filed. (An approver whose areas happen to be
 *     empty today also lands here — see queueAreaEmptyForApprover, which
 *     exists so the UI can tell those two apart.)
 */
export function visiblePending(pending, v) {
  if (v.fullAccess) return pending;
  const areaMatches = pending.filter((a) => inMyAreas(a, v));
  if (areaMatches.length > 0) return areaMatches;
  return pending.filter((a) => a.createdBy === v.uid);
}

/**
 * Deployment-request queue, same visibility policy as new-entry approval.
 * Paired sub-skills are dropped first: they are cascaded to 'requested'
 * alongside their parent Agent, but the parent represents the whole package,
 * so they must never appear (or be counted) as separate line items.
 */
export function visibleDeployRequests(deployRequests, agents, v) {
  const parentsOnly = deployRequests.filter((a) => !isPairedSubSkill(a, agents));
  if (v.fullAccess) return parentsOnly;
  return parentsOnly.filter((a) => inMyAreas(a, v));
}

/**
 * True when the viewer IS a scoped approver but nothing in their areas is
 * pending right now — distinct from having no approver rights at all, which
 * otherwise renders identically (own-submissions-only, no explanation).
 */
export function queueAreaEmptyForApprover(pending, v) {
  return !v.fullAccess && v.areas.size > 0 && !pending.some((a) => inMyAreas(a, v));
}

/**
 * Rename-request queue (2026-08-20). Lives here for the same reason the other
 * two do: it was written inline in PendingApprovalModal and therefore invisible
 * to the badge, so a rename request sat in the queue with no counter — the
 * exact drift this module was created to stop, repeated for a third queue.
 *
 * Requests whose agent no longer resolves are dropped: the row cannot render
 * an owner/area without it, and it cannot be counted either or the badge would
 * promise an item the modal will not show.
 *
 * Returns [{ r, agent }] so the modal renders straight from it.
 */
export function visibleRenameRequests(renameReqs, agents, v) {
  return (renameReqs || [])
    .map((r) => ({ r, agent: agents.find((a) => a.id === r.agentId) }))
    .filter(({ agent }) => !!agent)
    .filter(({ agent }) => canDecideRename(
      v.role, v.isAdmin, v.areaList, agentApproveAreas(agent, v.categoryAreaMap),
    ));
}

/** The number the Pending badge shows — exactly what the modal will list. */
export function pendingBadgeCount(pending, deployRequests, renameReqs, agents, v) {
  return visiblePending(pending, v).length
    + visibleDeployRequests(deployRequests, agents, v).length
    + visibleRenameRequests(renameReqs, agents, v).length;
}
