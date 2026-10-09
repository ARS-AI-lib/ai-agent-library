'use strict';
// Shared frame for every outgoing message (email html + Teams card text):
// greeting, closing and the single optional button. Pure, offline-testable.
// Email clients strip <style> and most layout, so this stays inline-styled.

const APP_URL = 'https://wolfy-ai-library.web.app';
const NAME_TOKEN = '{{name}}';
const GENERIC_NAME = 'ผู้ใช้งาน AI Agent Library';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "คุณทินภัทร" from a display name; generic wording when there is no name. */
function salutation(displayName) {
  const first = String(displayName || '').trim().split(/\s+/)[0];
  if (!first) return GENERIC_NAME;
  return /^[฀-๿]/.test(first) ? `คุณ${first}` : `คุณ ${first}`;
}

/** Replace the name placeholder in html / card text for one recipient. */
function personalize(str, displayName, { json = false } = {}) {
  const s = salutation(displayName);
  return String(str).split(NAME_TOKEN).join(json ? JSON.stringify(s).slice(1, -1) : esc(s));
}

const greetingHtml = () => `<p style="margin:0 0 14px">เรียน ${NAME_TOKEN}</p>`;

const buttonHtml = (label, link) => `<p style="margin:22px 0 0"><a href="${esc(link)}" style="display:inline-block;background:#2f6bff;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-weight:600">${esc(label)}</a></p>`;

const closingHtml = (footerNote = 'หากไม่ต้องการรับการแจ้งเตือน โปรดแจ้ง Admin') => `<p style="margin:22px 0 0">ขอแสดงความนับถือ<br/>AI Agent Library Team</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:22px 0 10px" />
<p style="font-size:11.5px;color:#9ca3af;margin:0">ส่งอัตโนมัติจากระบบ AI Agent Library · ${esc(footerNote)}</p>`;

/** Whole email body. `cta` ({label, link}) is rendered only when given. */
function frameHtml(bodyHtml, { cta = null, footerNote } = {}) {
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.65;color:#1f2937;max-width:560px">
${greetingHtml()}
${bodyHtml}
${cta ? buttonHtml(cta.label, cta.link) : ''}
${closingHtml(footerNote)}
</div>`;
}

/** Plain-text twin of a body fragment. */
function htmlToText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/h2>|<\/blockquote>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = {
  APP_URL, NAME_TOKEN, GENERIC_NAME, esc, salutation, personalize,
  greetingHtml, buttonHtml, closingHtml, frameHtml, htmlToText,
};
