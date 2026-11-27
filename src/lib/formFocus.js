// One standard for "validation failed → take the user to the field".
// Each form passes its error text plus a table of [label, pattern] pairs, in the
// same order it validates. We find the matching `.fg` block by its label text,
// scroll it to the middle of the dialog and focus its control. If nothing
// matches, fall back to the error banner so the user still lands on something.
const CONTROL = 'input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select, .tms-input, button';

export function goToField(rootSelector, err, fields = [], fallbackSelector = '.msg.error') {
  setTimeout(() => {
    const roots = document.querySelectorAll(rootSelector);
    const root = roots.length ? roots[roots.length - 1] : document;   // topmost dialog
    const hit = fields.find(([, re]) => re.test(err));
    let target = null;
    if (hit) {
      const lbl = [...root.querySelectorAll('.fg > label, label.fl')].find((l) => l.textContent.replace('*', '').trim().startsWith(hit[0]));
      target = lbl ? (lbl.closest('.fg') || lbl.parentElement) : null;
    }
    if (!target) target = root.querySelector(fallbackSelector);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const controls = [...target.querySelectorAll(CONTROL)];
    (controls.find((c) => !c.value) || controls[0])?.focus({ preventScroll: true });
  }, 0);
}

// "Skill #2: ใส่ Description" → the second sub-skill row, then the field named
// after the colon. Shared by the registration and Edit forms.
export function goToSkillRowError(rootSelector, err) {
  const m = /^Skill #(\d+)/.exec(err);
  if (!m) return false;
  goToField(rootSelector, '', [], `[data-skill-row="${Number(m[1]) - 1}"]`);
  return true;
}
