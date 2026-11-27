import { useEffect, useState } from 'react';
import { toJsDate } from '../lib/agentUtils';
import { goToField } from '../lib/formFocus';
import { AUDIENCES, AUDIENCE_LABEL, validateAnnouncement } from '../lib/inbox';
import { createAnnouncement, updateAnnouncement, deleteAnnouncement } from '../lib/announcements';
import { failMsg } from '../lib/copy';

// Composer for Inbox announcements (admin + committee only; rules enforce it).
// `announcement` present = edit mode (prefilled, Save changes + Delete).
// All text is plain: nothing here renders HTML.
const TITLE_MAX = 120;
const BODY_MAX = 5000;

function pad(n) { return String(n).padStart(2, '0'); }
function toLocalInput(v) {
  const d = toJsDate(v);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AnnouncementComposer({ user, announcement, onClose }) {
  const edit = !!announcement;
  const [title, setTitle] = useState(announcement?.title || '');
  const [body, setBody] = useState(announcement?.body || '');
  const [audience, setAudience] = useState(announcement?.audience || 'all');
  const [pinned, setPinned] = useState(!!announcement?.pinned);
  const [expires, setExpires] = useState(toLocalInput(announcement?.expiresAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);

  // Escape closes only this layer (the Inbox below keeps its own listener).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      if (!saving) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, saving]);

  const fields = () => ({ title, body, audience, pinned, expiresAt: expires ? new Date(expires) : null });

  // Show the message and take the user to the field it is about (src/lib/formFocus.js).
  const FIELDS = [['Title', /หัวข้อ/], ['Message', /เนื้อหา/], ['Audience', /กลุ่มผู้รับ/], ['Expires', /วันหมดอายุ/]];
  const fail = (msg) => { setError(msg); goToField('.v7-ann-composer', msg, FIELDS); };

  const submit = async (e) => {
    e.preventDefault();
    const f = fields();
    const bad = validateAnnouncement(f);
    if (bad) { fail(bad); return; }
    if (f.expiresAt && Number.isNaN(f.expiresAt.getTime())) { fail('วันหมดอายุไม่ถูกต้อง'); return; }
    if (f.expiresAt && f.expiresAt.getTime() <= Date.now()) { fail('วันหมดอายุต้องเป็นเวลาในอนาคต — ประกาศที่หมดอายุแล้วจะถูกซ่อนทันที'); return; }
    setError('');
    setSaving(true);
    try {
      if (edit) await updateAnnouncement(announcement.id, f);
      else await createAnnouncement(user, f);
      onClose();
    } catch (err) {
      setError(failMsg('ส่งประกาศ', err));
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await deleteAnnouncement(announcement.id);
      onClose();
    } catch (err) {
      setError(failMsg('ลบประกาศ', err));
      setSaving(false);
    }
  };

  return (
    <div className="mov open" onClick={(e) => e.target.classList.contains('mov') && !saving && onClose()}>
      <form className="mbox v7-ann-composer" onSubmit={submit} noValidate>
        <button type="button" className="mclose" disabled={saving} onClick={onClose} aria-label="Close">✕</button>
        <h2 className="mtitle">{edit ? 'Edit announcement' : 'New announcement'}</h2>

        <div className="fg">
          <label htmlFor="ann-title">Title</label>
          <input id="ann-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <span className="v7-ann-count">{title.length}/{TITLE_MAX}</span>
        </div>
        <div className="fg">
          <label htmlFor="ann-body">Message</label>
          <textarea id="ann-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          <span className="v7-ann-count">{body.length}/{BODY_MAX}</span>
        </div>
        <div className="fg">
          <label id="ann-aud-l">Audience</label>
          <div className="v7-ann-radios" role="radiogroup" aria-labelledby="ann-aud-l">
            {AUDIENCES.map((a) => (
              <label key={a} className="v7-ann-radio">
                <input type="radio" name="ann-aud" checked={audience === a} onChange={() => setAudience(a)} />
                {AUDIENCE_LABEL[a]}
              </label>
            ))}
          </div>
        </div>
        <div className="fg">
          <label className="v7-ann-radio">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Pin to top
          </label>
        </div>
        <div className="fg">
          <label htmlFor="ann-exp">Expires (optional)</label>
          <input id="ann-exp" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </div>

        {error && <div className="v7-ann-error" role="alert">{error}</div>}

        {confirmDel ? (
          <div className="v7-ann-confirm">
            <span>ลบประกาศนี้ถาวรหรือไม่? การลบไม่สามารถย้อนกลับได้</span>
            <button type="button" className="v7-sub-btn" disabled={saving} onClick={() => setConfirmDel(false)}>Cancel</button>
            <button type="button" className="v7-sub-btn v7-ann-danger" disabled={saving} onClick={remove}>Delete</button>
          </div>
        ) : (
          <div className="v7-ann-actions">
            {edit && <button type="button" className="v7-sub-btn v7-ann-danger" disabled={saving} onClick={() => setConfirmDel(true)}>Delete</button>}
            <button type="submit" className="v7-sub-btn pri" disabled={saving}>{edit ? 'Save changes' : 'Post'}</button>
          </div>
        )}
      </form>
    </div>
  );
}
