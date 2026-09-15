// A minimal Excel workbook writer (Office Open XML SpreadsheetML, ECMA-376) for exports (T6-03, D-102). One workbook,
// several sheets, a bold and frozen header row, text as inline strings (so nothing is ever read as a formula), numbers
// as numbers. Built on ./zip.ts; no library.
//
// Two things XML or Excel can't hold are made visible rather than hidden:
//   - characters XML 1.0 forbids (control characters other than tab and newline) become U+FFFD;
//   - text longer than Excel's 32,767-character cell limit is cut, with a note to use the CSV or the API for the rest.
import type { Cell } from './csv.ts';
import { ZipWriter } from './zip.ts';

export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Column widths in characters (optional). */
  widths?: number[];
}

const CELL_MAX = 32_767;
const CUT_NOTE = ' […cut: Excel holds 32,767 characters a cell; the CSV and the API have it all]';

// deno-lint-ignore no-control-regex
const XML_FORBIDDEN = /[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

export function xmlText(s: string): string {
  return s.replace(XML_FORBIDDEN, '\ufffd').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** A → 1, Z → 26, AA → 27 … */
export function columnName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Sheet names: at most 31 characters, none of : \ / ? * [ ], not blank, unique in the workbook. */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = raw.replace(/[:\\/?*[\]]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet';
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) {
      const suffix = ` (${i})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

function cellXml(ref: string, value: Cell, header: boolean): string {
  const style = header ? ' s="1"' : '';
  if (value === null || value === '') return '';
  if (typeof value === 'object') {
    // A date cell: Excel's serial day number of the local wall-clock time (days since 1899-12-30), shown with style 2.
    // Excel has no time zones; "About this file" names the zone.
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(value.time);
    if (!m) return cellXml(ref, value.time, header);
    const serial = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 86_400_000 + 25_569;
    return `<c r="${ref}" s="${header ? 1 : 2}"><v>${serial}</v></c>`;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? `<c r="${ref}"${style}><v>${value}</v></c>` : '';
  const text = value.length > CELL_MAX ? value.slice(0, CELL_MAX - CUT_NOTE.length) + CUT_NOTE : value;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ',
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
  ];
  if (sheet.widths?.length) {
    out.push('<cols>');
    sheet.widths.forEach((w, i) => out.push(`<col min="${i + 1}" max="${i + 1}" width="${Math.max(4, Math.min(80, w))}" customWidth="1"/>`));
    out.push('</cols>');
  }
  out.push('<sheetData>');
  sheet.rows.forEach((row, r) => {
    out.push(`<row r="${r + 1}">`);
    row.forEach((value, c) => out.push(cellXml(`${columnName(c)}${r + 1}`, value, r === 0)));
    out.push('</row>');
  });
  out.push('</sheetData></worksheet>');
  return out.join('');
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** The workbook as ZIP chunks. `title` and `created` go in the document properties. */
export async function xlsxChunks(sheets: Sheet[], opts: { title: string; created: Date }): Promise<Uint8Array[]> {
  if (sheets.length === 0) throw new Error('a workbook needs at least one sheet');
  const names = sheetNames(sheets.map((s) => s.name));
  const enc = new TextEncoder();
  const zip = new ZipWriter();
  const add = (name: string, xml: string) => zip.add({ name, data: enc.encode(xml), compress: true, modified: opts.created });
  const iso = opts.created.toISOString().replace(/\.\d{3}Z$/, 'Z');

  await add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>');
  await add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>');
  await add('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${xmlText(opts.title)}</dc:title><dc:creator>FESS POS</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>` +
    '</cp:coreProperties>');
  await add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>');
  await add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>');
  await add('xl/styles.xml', STYLES);
  for (let i = 0; i < sheets.length; i++) await add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheets[i]));
  return zip.finish();
}
