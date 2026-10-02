import { useCallback, useEffect, useRef, useState } from 'react';

// Guarded close for the New (PreRegModal) and Edit (EditAgentModal) forms
// (2026-09-30). Before this, a stray click on the backdrop or an Escape press
// closed the form instantly and everything typed was lost.
//   · Backdrop clicks do nothing — the caller simply stops wiring them.
//   · ✕ / Cancel / Escape all call requestClose().
//   · requestClose() asks "discard?" ONLY when something was actually changed.
//
// "Changed" = the watched state differs from a snapshot taken at the user's
// FIRST interaction (pointerdown/keydown inside the modal). Taking it then,
// not at mount, keeps async mount work (catalog loads, drop-stale effects)
// from counting as an edit.
const ser = (v) => JSON.stringify(v, (_, x) => (x instanceof Set ? [...x].sort() : x));

export default function useCloseGuard(watched, onClose) {
  const snapshot = useRef(null);
  const current = ser(watched);
  const [asking, setAsking] = useState(false);
  const dirty = snapshot.current !== null && snapshot.current !== current;

  // Attach to the modal box: onPointerDownCapture + onKeyDownCapture.
  const armRef = useRef(null);
  armRef.current = () => { if (snapshot.current === null) snapshot.current = current; };
  const arm = useCallback(() => armRef.current(), []);

  const requestClose = useCallback(() => {
    if (dirty) setAsking(true); else onClose();
  }, [dirty, onClose]);

  // Escape = same as ✕; with the confirm open, Escape just dismisses it.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Escape') return;
      if (asking) setAsking(false); else requestClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [asking, requestClose]);

  const confirmDialog = asking ? (
    <div className="mov open" style={{ zIndex: 1200 }}>
      <div className="mbox" style={{ maxWidth: 380 }} role="alertdialog" aria-modal="true">
        <h3 style={{ fontSize: 15, marginBottom: 8 }}>Discard changes?</h3>
        <p style={{ fontSize: 13, color: 'var(--mu)', margin: '0 0 14px' }}>ข้อมูลที่กรอกหรือแก้ไขไว้จะหายทั้งหมด ต้องการปิดจริงไหม</p>
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={() => setAsking(false)}>Keep Editing</button>
          <button type="button" className="btn btn-danger" onClick={() => { setAsking(false); onClose(); }}>Discard</button>
        </div>
      </div>
    </div>
  ) : null;

  return { requestClose, arm, confirmDialog, dirty };
}
