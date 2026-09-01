// CSV emission, shared (2026-08-26).
//
// Extracted verbatim from ExportDataModal.jsx, where these were module-local,
// when the Agent/Skill Usage report needed the same two behaviours. Copying
// them would have put the BOM rule in two places — the same anti-drift reason
// normalizeProgress and agentApproveAreas each live in exactly one module.

/** Quote a cell only when it actually needs it. */
export function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build a CSV and hand it to the browser.
 *
 * `rows` must already be in the order you want — sorting is the caller's job.
 * (The old private version sorted by owner+agentName internally, which is
 * wrong for a report whose whole point is "newest adoption first".)
 *
 * `columns` is the key list AND the header row. Pass `headers` when the column
 * keys are not what a human should read at the top of the file.
 */
export function downloadCsv(rows, filename, columns, headers = null) {
  const lines = [(headers || columns).map(csvCell).join(',')];
  rows.forEach((r) => lines.push(columns.map((c) => csvCell(r[c])).join(',')));
  // Excel (Windows especially) doesn't auto-detect UTF-8 without a BOM — Thai
  // text renders as mojibake ("ต่างดาว") even though the bytes are correct
  // UTF-8. Numbers on Mac sniffs the encoding anyway, which is why the same
  // file looked fine there. The BOM is a no-op for every other CSV reader.
  const blob = new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
