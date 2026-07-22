import { useEffect } from 'react';

// Dismiss the topmost modal on Escape (2026-07-06 improve pass) — every .mov
// modal previously only closed via a mouse click on the ✕ button or the
// overlay backdrop. Pass the modal's own onClose; when several modals are
// stacked (e.g. AgentDetailModal opened from inside PendingApprovalModal),
// each instance attaches its own listener and React unmounts the topmost
// one's listener first on close, so Escape naturally peels one layer at a
// time without any z-index/stack bookkeeping.
export default function useEscapeKey(onClose) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
}
