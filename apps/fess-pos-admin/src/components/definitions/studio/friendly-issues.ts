// Check results (docs/04 §9) as plain-language advice for the Basic view: where the problem is ("Premises › Premises type")
// and what to do about it ("It must be answered but is never shown; did you mean to hide it?"). Advanced view keeps the
// raw code and path.
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
    parts.push(fieldName(f) || `Detail ${segs[1] + 1}`);
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
    parts.push(`Page ${q(asStr(pg.title) || humanLabel(segs[1]))} (${pageWording(asStr(pg.type)).name})`);
    target = ['pages', segs[1]];
  } else if (root === 'navigation') {
    parts.push('Tabs');
    target = ['navigation'];
  } else if (root === 'strings' && typeof segs[1] === 'string') {
    parts.push(`Text ${q(segs[1])}`);
    target = ['strings', segs[1]];
  } else if (root === 'outcome_sets') {
    parts.push(`Result pages ${q(humanLabel(String(segs[1] ?? '')))}`);
  } else if (typeof root === 'string') {
    parts.push(humanLabel(root));
  }
  return { where: parts.length ? parts.join(' › ') : null, target: target.length ? target.join('/') : null };
}

function sectionTitle(doc: unknown, bundleForm: unknown, key: string): string {
  for (const s of asArr(asObj(bundleForm ?? doc).sections)) if (asStr(asObj(s).key) === key) return asStr(asObj(s).title) || key;
  return key;
}

/** Plain-language advice for one check result. `relatedForm` helps name sections in visit-step issues. */
export function friendlyIssue(issue: ValidationIssue, doc: unknown, relatedForm?: unknown): FriendlyIssue {
  const names = quoted(issue.message);
  const [a, b] = names;
  const { where, target } = describeLocation(doc, issue.path ?? issue.field);
  let text: string;
  switch (issue.code) {
    case 'DUPLICATE_KEY':
    case 'DUPLICATE_STEP_ID':
      text = `Two items are saved under the same name, ${q(a)}. Rename one so each is different.`;
      break;
    case 'DUPLICATE_OPTION_VALUE':
      text = `Two answers are saved as ${q(a)}. Give each answer its own value.`;
      break;
    case 'MISSING_REF':
      text = /lookup list/.test(issue.message)
        ? `The drop-down list ${q(a)} doesn’t exist. Choose another list, or add it on the Drop-down lists page.`
        : /reason-code/.test(issue.message)
          ? `There are no reasons in the group ${q(a)} yet. Add some on the Reasons page.`
          : /declaration/.test(issue.message)
            ? `The declaration ${q(a)} doesn’t exist yet. Publish it on the Declarations page first.`
            : `A condition or setting points to ${q(b ?? a)}, which isn’t a question here. Did you remove or rename it?`;
      break;
    case 'REFERENCES_LATER_FIELD':
      text = `A condition uses the answer to ${q(b)}, which the agent only answers later. Did you mean to move that question up?`;
      break;
    case 'UNKNOWN_OPTION_VALUE':
      text = `A condition checks for ${q(a)}, but that isn’t one of the answers to ${q(b)}. Did the answers change?`;
      break;
    case 'REQUIRED_NEVER_VISIBLE':
      text = `${q(a)} must be answered but is never shown, so the agent could never finish. Did you mean to hide it, or to make it optional?`;
      break;
    case 'UNREACHABLE_SECTION':
      text = `Section ${q(a)} is never shown to anyone. Did you mean to hide it?`;
      break;
    case 'CYCLE':
      text = 'Some conditions depend on each other in a circle. Change one of them to break the circle.';
      break;
    case 'SECTION_NOT_IN_FLOW':
      text = `The section ${q(sectionTitle(doc, relatedForm, a ?? ''))} isn’t in any step, so agents never see it. Add it to a Questions step.`;
      break;
    case 'MISSING_SECTION_REF':
      text = `A step shows the section ${q(a)}, which isn’t in the questions ${q(b)}. Did you rename or remove it?`;
      break;
    case 'MISSING_FORM_REF':
      text = a ? `The questions ${q(a)} don’t exist yet, or haven’t been published.` : 'A Questions step doesn’t say which questions to show. Choose them at the top.';
      break;
    case 'MISSING_VIEW_REF':
      text = `The screen layout ${q(a)} doesn’t exist yet, or hasn’t been published.`;
      break;
    case 'MISSING_FLOW_REF':
      text = `The visit steps ${q(a)} don’t exist yet, or haven’t been published.`;
      break;
    case 'MISSING_PAGE_REF':
      text = `The page ${q(a)} isn’t in this app.`;
      break;
    case 'MISSING_STEP_REF':
      text = `A step jumps to ${q(a)}, which isn’t one of these steps.`;
      break;
    case 'UNREACHABLE_STEP':
      text = 'The agent can never reach this step. Did you mean to remove it?';
      break;
    case 'STEP_NEVER_VISIBLE':
      text = 'This step is never shown. Did you mean to hide it?';
      break;
    case 'INTEGRITY_STEP_MISSING':
      text = a ? `The ${stepWording(a).name} step protects the visit record, so it has to stay.` : 'The steps need a Submit step at the end.';
      break;
    case 'NO_SUBMIT_STEP':
      text = 'The steps need a Submit step at the end.';
      break;
    case 'INTEGRITY_STEP_DUPLICATE':
      text = a ? `The ${stepWording(a).name} step appears more than once. Keep just one.` : 'There can only be one Submit step.';
      break;
    case 'INTEGRITY_STEP_ORDER':
      text = a ? `Move the ${stepWording(a).name} step so it comes before Submit.` : 'Questions steps must come before Submit.';
      break;
    case 'INTEGRITY_STEP_BYPASSABLE':
      text = `The agent could reach Submit without going through the ${stepWording(a ?? '').name} step. Check the conditions on the steps in between.`;
      break;
    case 'DECLARATION_FIELD_MISSING':
      text = 'The questions used here need exactly one Declaration question.';
      break;
    case 'ORPHAN_PAGE':
      text = `No button or tab leads to the page ${q(a)}. Link to it from somewhere, or remove it.`;
      break;
    case 'OUTCOME_SET_MISSING':
      text = a
        ? `The result pages ${q(a)} don’t exist, so the agent never sees a result.`
        : 'Starting visit steps straight from a page needs a set of result pages called “default”.';
      break;
    case 'OUTCOME_PAGE_INVALID':
      text = `${q(a)} must be a result page for the matching result.`;
      break;
    case 'INVALID_TEMPLATE':
      text = 'Some text has a {{ }} that isn’t closed, or a placeholder name that isn’t allowed.';
      break;
    case 'MIN_GREATER_THAN_MAX':
      text = 'The lowest allowed value is higher than the highest. Swap them round.';
      break;
    case 'TYPE_MISMATCH':
      text = 'A condition compares two different kinds of value, such as a number with a word.';
      break;
    case 'DEF_INVALID_EXPRESSION':
      text = 'A condition isn’t written correctly.';
      break;
    case 'UNKNOWN_ROOT':
      text = `A condition or value reads ${q(a)}, which isn’t available here.`;
      break;
    case 'INVALID_STAT_TILE':
      text = 'A total tile doesn’t say what to count. Choose what it counts.';
      break;
    case 'ACTION_PENDING_DECISION':
      text = `What ${q(a)} does hasn’t been decided yet, so it can’t be used for now.`;
      break;
    case 'DEF_MISSING_PROPERTY':
      text = 'A required setting is missing.';
      break;
    case 'DEF_UNKNOWN_PROPERTY':
      text = 'It has a setting the app doesn’t recognise.';
      break;
    case 'DEF_UNKNOWN_COMPONENT':
    case 'DEF_UNKNOWN_STEP_TYPE':
    case 'DEF_UNKNOWN_VIEW_COMPONENT':
    case 'DEF_UNKNOWN_PAGE_TYPE':
      text = 'It uses something the current phone app doesn’t know yet.';
      break;
    case 'DEF_OPTIONS_REQUIRED':
      text = 'A choice question needs answers to choose from.';
      break;
    default:
      text = issue.message ? issue.message.charAt(0).toUpperCase() + issue.message.slice(1) : 'Something here needs attention.';
  }
  return { text, where, target };
}
