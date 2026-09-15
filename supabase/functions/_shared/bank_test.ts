// Unit tests for the bank API helpers (T6-06). Run: pnpm functions:test (deno test, no downloads: the asserts are local).
import { BANK_KEY_PATTERN, decodeCursor, encodeCursor, keyEnvironment, labelledAnswers, newBankKey, routeName } from './bank.ts';

function assert(cond: unknown, message = 'assertion failed'): asserts cond {
  if (!cond) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message ? `${message}: ` : ''}expected ${e}, got ${a}`);
}

Deno.test('a new key has the fpos_<env>_<random> shape and its last four', () => {
  const { key, lastFour } = newBankKey('qa');
  assert(BANK_KEY_PATTERN.test(key), key);
  assert(key.startsWith('fpos_qa_'));
  assertEquals(lastFour, key.slice(-4));
  assert(newBankKey('qa').key !== key, 'keys are random');
});

Deno.test('the environment part of a key', () => {
  assertEquals(keyEnvironment('production'), 'prod');
  assertEquals(keyEnvironment('qa'), 'qa');
  assertEquals(keyEnvironment('staging'), 'staging');
  assertEquals(keyEnvironment(''), 'dev');
  assert(newBankKey('production').key.startsWith('fpos_prod_'));
});

Deno.test('cursors round-trip and refuse anything else', () => {
  const c = { changed_at: '2026-09-15T15:37:08.582123+00:00', id: '01a0a596-f3c6-754d-b54c-6fcb49c26667' };
  assertEquals(decodeCursor(encodeCursor(c)), c);
  assertEquals(decodeCursor('not a cursor!'), null);
  assertEquals(decodeCursor(btoa(JSON.stringify({ t: 'yesterday', id: c.id }))), null);
  assertEquals(decodeCursor(btoa(JSON.stringify({ t: c.changed_at, id: 'x' }))), null);
});

const FORM = {
  kind: 'form',
  sections: [
    {
      key: 'business',
      title: 'Business',
      fields: [
        { key: 'intro', type: 'markdown', text: 'Read this first' },
        { key: 'premises_type', type: 'single_choice', label: 'Type of premises', options: [{ value: 'shop', label: 'Shop' }, { value: 'complex', label: 'Shopping complex' }] },
        { key: 'payment_methods', type: 'multi_choice', label: 'Payment methods', options: [{ value: 'pos', label: 'Card machine' }, { value: 'cash', label: 'Cash' }] },
        { key: 'pair', type: 'group', fields: [{ key: 'floor_area_m2', type: 'number', label: 'Floor area', export: { column_label: 'Floor area (m²)' } }] },
        { key: 'internal_note', type: 'text', label: 'Internal note', export: { include: false } },
        { key: 'ruled', type: 'text', label: { if: [true, 'A', 'B'] } },
      ],
    },
    { key: 'evidence', fields: [{ key: 'shopfront_photo', type: 'photo', label: 'Shop front' }, { key: 'signature', type: 'signature', label: 'Signature' }] },
  ],
};

Deno.test('answers come back in form order with labels, option labels and evidence ids', () => {
  const out = labelledAnswers(FORM, {
    signature: { v: 'ev-2' },
    premises_type: { v: 'complex' },
    payment_methods: { v: ['pos', 'cash', 'qr'] },
    floor_area_m2: { v: 45, prefilled: true },
    internal_note: { v: 'secret' },
    ruled: { v: 'x', computed: true },
    shopfront_photo: { v: ['ev-1'] },
  });
  assertEquals(out.map((a) => a.key), ['premises_type', 'payment_methods', 'floor_area_m2', 'ruled', 'shopfront_photo', 'signature']);
  assertEquals(out[0].label, 'Type of premises');
  assertEquals(out[0].value_label, 'Shopping complex');
  assertEquals(out[1].value_label, ['Card machine', 'Cash', null], 'an unknown option has no label');
  assertEquals(out[2].label, 'Floor area (m²)', 'export.column_label wins');
  assertEquals(out[2].source, 'prefilled');
  assertEquals(out[3].label, 'ruled', 'a label that is a rule falls back to the key');
  assertEquals(out[3].source, 'computed');
  assertEquals(out[4].evidence_ids, ['ev-1']);
  assertEquals(out[5].evidence_ids, ['ev-2']);
  assertEquals(out[0].section_title, 'Business');
});

Deno.test('fields left out of exports stay out; answers the form does not describe are kept', () => {
  const out = labelledAnswers(FORM, { internal_note: { v: 'secret' }, legacy_field: { v: 1 } });
  assertEquals(out.map((a) => a.key), ['legacy_field']);
  assertEquals(out[0].label, 'legacy_field');
  assertEquals(labelledAnswers(null, { a: { v: 1 } }).length, 1, 'no form: everything kept');
});

Deno.test('route names hide ids', () => {
  assertEquals(routeName('/api/v1/bank/inspections/01a0a596-f3c6-754d-b54c-6fcb49c26667'), '/v1/bank/inspections/:id');
  assertEquals(routeName('/api/v1/bank/inspections'), '/v1/bank/inspections');
});
