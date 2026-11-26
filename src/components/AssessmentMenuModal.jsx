// ☰ → Assessment chooser (2026-11-26): Settings (admin/committee) and Results (admin/committee/approver).
export default function AssessmentMenuModal({ onClose, canSettings, onOpenSettings }) {
  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox" style={{ padding: 18, maxWidth: 380 }}>
        <button className="mclose" onClick={onClose}>✕</button>
        <h2 className="mtitle">Assessment</h2>
        <div className="msub">Settings and results of the screening assessment</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          <button className="btn btn-primary" onClick={() => { window.location.href = '/assessments'; }}>Assessment Results</button>
          {canSettings && <button className="btn btn-secondary" onClick={() => { onClose(); onOpenSettings(); }}>Assessment Settings</button>}
        </div>
      </div>
    </div>
  );
}
