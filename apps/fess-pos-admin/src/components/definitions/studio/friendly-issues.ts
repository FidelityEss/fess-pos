// Analysis issues (docs/04 §9) in plain language for the Basic view: where the problem is ("Premises › Premises type")
// and what it means ("It's required but can never be shown"). Advanced view keeps the raw code and path.
import { humanLabel } from '@/components/structured-view';
import type { ValidationIssue } from '@/lib/types';
import { componentWording, pageWording, stepWording, viewWording } from './catalogue-ui';
import { asArr, asObj, asStr, getIn } from './doc';

export interface FriendlyIssue {
  text: string;
  where: string | null;
  /** Document path (segments joined with '/') the issue points at, when it resolves to something the editor can select. */
  target: string | null;
}

const q = (s: string | undefined) => (s ? `“${s}”` : 'it');

function quoted(message: string): string[] {
  return [...message.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
}

function segments(path: string | undefined): (string | number)[] {
  if (!path) return [];
  return path
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

function fieldName(o: Record<string, unknown>): string {
  return asStr(o.label) || asStr(o.text).slice(0, 40) || asStr(o.key) || componentWording(asStr(o.type)).name;
}

/** Human location + the selectable path for a JSON pointer. */
export function describeLocation(doc: unknown, path: string | undefined): { where: string | null; target: string | null } {
  const segs = segments(path);
  if (segs.length === 0) return { where: null, target: null };
  const parts: string[] = [];
  let target: (string | number)[] = [];
  const root = segs[0];
  if (root === 'sections' && typeof segs[1] === 'number') {
    const s = asObj(getIn(doc, ['sections', segs[1]]));
    parts.push(asStr(s.title) || `Section ${segs[1] + 1}`);
    target = ['sections', segs[1]];
    let i = 2;
    while (segs[i] === 'fields' && typeof segs[i + 1] === 'number') {
      const p = [...target, 'fields', segs[i + 1] as number];
      const f = asObj(getIn(doc, p));
      if (!Object.keys(f).length) break;
      parts.push(fieldName(f));
      target = p;
      i += 2;
    }
  } else if (root === 'attributes' && typeof segs[1] === 'number') {
    const f = asObj(getIn(doc, ['attributes', segs[1]]));
    parts.push(fieldName(f) || `Attribute ${segs[1] + 1}`);
    target = ['attributes', segs[1]];
  } else if (root === 'steps' && typeof segs[1] === 'number') {
    const s = asObj(getIn(doc, ['steps', segs[1]]));
    parts.push(`Step ${segs[1] + 1} · ${asStr(s.label) || stepWording(asStr(s.type)).name}`);
    target = ['steps', segs[1]];
  } else if (root === 'items' && typeof segs[1] === 'number') {
    const it = asObj(getIn(doc, ['items', segs[1]]));
    parts.push(`Item ${segs[1] + 1} · ${viewWording(asStr(it.type)).name}`);
    target = ['items', segs[1]];
  } else if (root === 'pages' && typeof segs[1] === 'string') {
    const pg = asObj(getIn(doc, ['pages', segs[1]]));
    parts.push(`Page ${q(asStr(pg.title) || segs[1])} (${pageWording(asStr(pg.type)).name})`);
    target = ['pages', segs[1]];
  } else if (root === 'navigation') {
    parts.push('Navigation');
    target = ['navigation'];
  } else if (root === 'strings' && typeof segs[1] === 'string') {
    parts.push(`Text ${q(segs[1])}`);
    target = ['strings', segs[1]];
  } else if (root === 'outcome_sets') {
    parts.push(`Outcome set ${q(String(segs[1] ?? ''))}`);
  } else if (typeof root === 'string') {
    parts.push(humanLabel(root));
  }
  return { where: parts.length ? parts.join(' › ') : null, target: target.length ? target.join('/') : null };
}

function sectionTitle(doc: unknown, bundleForm: unknown, key: string): string {
  for (const s of asArr(asObj(bundleForm ?? doc).sections)) if (asStr(asObj(s).key) === key) return asStr(asObj(s).title) || key;
  return key;
}

/** Plain-language rendering of one analysis issue. `relatedForm` helps name sections in flow issues. */
export function friendlyIssue(issue: ValidationIssue, doc: unknown, relatedForm?: unknown): FriendlyIssue {
  const names = quoted(issue.message);
  const [a, b] = names;
  const { where, target } = describeLocation(doc, issue.path ?? issue.field);
  let text: string;
  switch (issue.code) {
    case 'DUPLICATE_KEY':
    case 'DUPLICATE_STEP_ID':
      text = `The key ${q(a)} is used more than once. Every key must be unique.`;
      break;
    case 'DUPLICATE_OPTION_VALUE':
      text = `Two options share the value ${q(a)}. Each option needs its own value.`;
      break;
    case 'MISSING_REF':
      text = /lookup list/.test(issue.message)
        ? `The lookup list ${q(a)} doesn't exist.`
        : /reason-code/.test(issue.message)
          ? `There are no reason codes in the category ${q(a)}.`
          : /declaration/.test(issue.message)
            ? `The declaration ${q(a)} doesn't exist. Publish it on the Declarations page first.`
            : `A rule or setting refers to ${q(b ?? a)}, which isn't a question in this form.`;
      break;
    case 'REFERENCES_LATER_FIELD':
      text = `A rule reads the answer to a later question (${q(b)}). The agent answers that afterwards, so check the order.`;
      break;
    case 'UNKNOWN_OPTION_VALUE':
      text = `A rule compares with ${q(a)}, which isn't one of the options of ${q(b)}.`;
      break;
    case 'REQUIRED_NEVER_VISIBLE':
      text = `${q(a)} is required but can never be shown, so the agent could never complete the form.`;
      break;
    case 'UNREACHABLE_SECTION':
      text = `Section ${q(a)} can never be shown.`;
      break;
    case 'CYCLE':
      text = 'Some rules depend on each other in a loop. Change one so the loop is broken.';
      break;
    case 'SECTION_NOT_IN_FLOW':
      text = `The flow never shows the form's section ${q(sectionTitle(doc, relatedForm, a ?? ''))}. Add it to a Questions step.`;
      break;
    case 'MISSING_SECTION_REF':
      text = `A step shows section ${q(a)}, which isn't in the form ${q(b)}.`;
      break;
    case 'MISSING_FORM_REF':
      text = a ? `The form ${q(a)} doesn't exist (or has no published version).` : 'A Questions step has no form. Link a form to the flow.';
      break;
    case 'MISSING_VIEW_REF':
      text = `The screen ${q(a)} doesn't exist (or has no published version).`;
      break;
    case 'MISSING_FLOW_REF':
      text = `The flow ${q(a)} doesn't exist (or has no published version).`;
      break;
    case 'MISSING_PAGE_REF':
      text = `The page ${q(a)} doesn't exist in this app.`;
      break;
    case 'MISSING_STEP_REF':
      text = `A step jumps to ${q(a)}, which isn't a step of this flow.`;
      break;
    case 'UNREACHABLE_STEP':
      text = 'This step can never be reached.';
      break;
    case 'STEP_NEVER_VISIBLE':
      text = 'This step is never shown.';
      break;
    case 'INTEGRITY_STEP_MISSING':
      text = a ? `The ${stepWording(a).name} step is required and can't be removed.` : 'The flow needs a Submit step.';
      break;
    case 'NO_SUBMIT_STEP':
      text = 'The flow needs a Submit step.';
      break;
    case 'INTEGRITY_STEP_DUPLICATE':
      text = a ? `The ${stepWording(a).name} step appears more than once.` : 'A flow has exactly one Submit step.';
      break;
    case 'INTEGRITY_STEP_ORDER':
      text = a ? `The ${stepWording(a).name} step must come before Submit.` : 'Questions steps must come before Submit.';
      break;
    case 'INTEGRITY_STEP_BYPASSABLE':
      text = `The agent could reach Submit without passing the ${stepWording(a ?? '').name} step.`;
      break;
    case 'DECLARATION_FIELD_MISSING':
      text = `The linked form must contain exactly one Declaration question.`;
      break;
    case 'ORPHAN_PAGE':
      text = `The page ${q(a)} can't be reached from the start page or the navigation.`;
      break;
    case 'OUTCOME_SET_MISSING':
      text = a ? `The outcome set ${q(a)} doesn't exist, so the page never shows a result.` : 'Starting a flow directly needs a "default" outcome set.';
      break;
    case 'OUTCOME_PAGE_INVALID':
      text = `${q(a)} must be a Result page for the right outcome.`;
      break;
    case 'INVALID_TEMPLATE':
      text = 'The text has unbalanced {{ }} or a placeholder with an invalid name.';
      break;
    case 'MIN_GREATER_THAN_MAX':
      text = 'The lowest allowed value is higher than the highest.';
      break;
    case 'TYPE_MISMATCH':
      text = `A rule compares different kinds of value (${issue.message}).`;
      break;
    case 'DEF_INVALID_EXPRESSION':
      text = 'A rule is not valid.';
      break;
    case 'UNKNOWN_ROOT':
      text = `A rule or binding reads ${q(a)}, which isn't available here.`;
      break;
    case 'INVALID_STAT_TILE':
      text = 'A total tile needs a source: records on the phone need a collection; server totals need stats.<name>.';
      break;
    case 'ACTION_PENDING_DECISION':
      text = `The action ${q(a)} is still waiting for a decision (D-38).`;
      break;
    case 'DEF_MISSING_PROPERTY':
      text = `Something required is missing${where ? '' : ''}: ${issue.message}.`;
      break;
    case 'DEF_UNKNOWN_PROPERTY':
      text = `Contains a setting that isn't part of the specification (${issue.message}).`;
      break;
    case 'DEF_UNKNOWN_COMPONENT':
    case 'DEF_UNKNOWN_STEP_TYPE':
    case 'DEF_UNKNOWN_VIEW_COMPONENT':
    case 'DEF_UNKNOWN_PAGE_TYPE':
      text = 'Uses a component type that this version of the app does not know.';
      break;
    case 'DEF_OPTIONS_REQUIRED':
      text = 'A choice question needs a list of options (or a source for them).';
      break;
    default:
      text = issue.message ? issue.message.charAt(0).toUpperCase() + issue.message.slice(1) : 'Problem';
  }
  return { text, where, target };
}
