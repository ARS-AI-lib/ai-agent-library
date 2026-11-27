// Large popup that hosts a report page (Agent/Skill Usage, Assessment Results) on top of the Library
// (2026-11-27). The pages still work as standalone routes (/usage, /assessments) for direct links.
export default function ReportModal({ onClose, label, children }) {
  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox xl" role="dialog" aria-label={label}>
        <button className="mclose" onClick={onClose} style={{ zIndex: 3 }} aria-label="Close">✕</button>
        {children}
      </div>
    </div>
  );
}
