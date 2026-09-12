// Minimal RFC 4180 CSV parser (no dependencies): quoted fields, "" escapes, embedded delimiters and line breaks,
// CRLF / LF / CR line endings, UTF-8 BOM, and delimiter auto-detection (comma, semicolon or tab).

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

const CANDIDATES = [',', ';', '\t'] as const;

/** Count delimiter occurrences in the first line, ignoring quoted text. */
function detectDelimiter(text: string): string {
  let best: string = ',';
  let bestCount = -1;
  for (const d of CANDIDATES) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
      else if (!inQuotes && ch === d) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Parse CSV text into records (arrays of cell strings). */
export function parseCsvRecords(input: string, delimiter?: string): { records: string[][]; delimiter: string } {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const d = delimiter ?? detectDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === d) {
      record.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return { records, delimiter: d };
}

/** Parse CSV with a header row. Blank records are dropped; short rows are padded, extra cells are kept. */
export function parseCsv(input: string): ParsedCsv {
  const { records, delimiter } = parseCsvRecords(input);
  const nonBlank = records.filter((r) => r.some((c) => c.trim() !== ''));
  const [head, ...body] = nonBlank;
  const headers = (head ?? []).map((h, i) => h.trim() || `Column ${i + 1}`);
  const rows = body.map((r) => (r.length < headers.length ? [...r, ...Array<string>(headers.length - r.length).fill('')] : r));
  return { headers, rows, delimiter };
}
