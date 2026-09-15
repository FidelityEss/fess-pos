// The groups the job information is shown in (docs/17 §4.6: "Merchant", "Where", "Who to contact", "When"). A job
// schema attribute has no group of its own (the definition format is strict), so each is placed by what its name and
// type say it's about; anything unclear goes under "Other details". Placement is display only: the saved order and the
// definition never change because of it (D-103).
import { asStr, type Obj } from './doc';

export type JobGroup = 'merchant' | 'where' | 'contact' | 'when' | 'other';

export interface JobGroupInfo {
  key: JobGroup;
  title: string;
  description: string;
  /** What every job's form already asks for in this group (the built-in fields of the new-job form). */
  builtIn: readonly string[];
  note?: string;
}

export const JOB_GROUPS: readonly JobGroupInfo[] = [
  { key: 'merchant', title: 'Merchant', description: 'The business being visited.', builtIn: ['Bank', 'Merchant name', 'Trading name', 'Bank’s reference', 'Business type'] },
  { key: 'where', title: 'Where', description: 'Where the visit happens.', builtIn: ['Address', 'Map pin and site area', 'Type of place'] },
  { key: 'contact', title: 'Who to contact', description: 'Who the agent speaks to, and how to reach them.', builtIn: ['Contact name, phone and email', 'Notes for the agent'] },
  { key: 'when', title: 'When', description: 'Dates and times that matter for the visit.', builtIn: [], note: 'The visit time itself is agreed and booked after the job is created.' },
  { key: 'other', title: 'Other details', description: 'Anything else the bank asks for.', builtIn: [] },
];

const CONTACT = /^(contact|phone|mobile|cell|email|manager|owner|person|representative|rep|telephone|tel|whatsapp|director|signatory|liaison)/;
const WHERE = /^(address|street|suburb|city|town|province|postal|postcode|region|area|location|site|gps|latitude|longitude|branch|premises|mall|centre|center|building|floor|district|municipality|coordinates|geo)/;
const MERCHANT = /^(merchant|business|trading|trade|company|registration|vat|cipc|mcc|industry|category|risk|tier|turnover|revenue|account|segment|product|terminal|device|card|onboard|established|sector|licen|legal)/;
const WHEN = /^(visit|appointment|deadline|due|schedul|window|expir|start|end|before|after|time|date|day)/;
const DATE_TYPES = new Set(['date', 'time', 'datetime', 'duration']);

/** The group a job detail belongs in, from the words in its technical name and label, then its type. */
export function jobGroupOf(attr: Obj): JobGroup {
  const words = `${asStr(attr.key)} ${asStr(attr.label)}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const type = asStr(attr.type);
  const has = (re: RegExp) => words.some((w) => re.test(w));
  if (type === 'phone' || type === 'email' || has(CONTACT)) return 'contact';
  if (type === 'address' || type === 'location_pin' || has(WHERE)) return 'where';
  if (has(MERCHANT)) return 'merchant';
  if (DATE_TYPES.has(type) || has(WHEN)) return 'when';
  return 'other';
}
