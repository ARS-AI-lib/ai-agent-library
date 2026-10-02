import { GLOSSARY } from '../lib/glossary';
import useEscapeKey from '../hooks/useEscapeKey';

export default function GlossaryModal({ onClose }) {
  useEscapeKey(onClose);
  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && onClose()}>
      <div className="mbox" style={{ maxWidth: 620 }}>
        <button className="mclose" onClick={onClose}>✕</button>
        <h2 className="mtitle">Glossary</h2>
        <div className="msub">คำอธิบายศัพท์ที่ใช้ในระบบ</div>
        <dl className="v7-gloss">
          {GLOSSARY.map((t) => (
            <div key={t.k}><dt>{t.k}</dt><dd>{t.v}</dd></div>
          ))}
        </dl>
      </div>
    </div>
  );
}
