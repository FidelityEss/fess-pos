// CSV for exports (T6-03, B6.4, D-102): RFC 4180 (quoted when needed, CRLF), UTF-8 with a byte-order mark so Excel reads
// accents and emoji correctly.
//
// Spreadsheet formula guard: a text cell starting with = + - @ tab or CR is written with a leading apostrophe, so opening
// the file in a spreadsheet never runs it as a formula (OWASP "CSV injection"). Numbers are never touched. The stored
// answer is unchanged; the bank API and the Excel export (which types every text cell as text) give it exactly.
export type Cell = string | number | null;

const RISKY_START = /^[=+\-@\t\r]/;

export function csvCell(value: Cell): string {
  if (value === null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = RISKY_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The whole file: BOM, rows joined with CRLF, a final CRLF. */
export function csvText(rows: Cell[][]): string {
  return '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function csvBytes(rows: Cell[][]): Uint8Array {
  return new TextEncoder().encode(csvText(rows));
}
