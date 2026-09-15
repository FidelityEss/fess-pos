// Small drawings of how the most used question types look on the phone, for the "Add a question" picture grid
// (docs/17 §4.6: "pick a question type from pictures"). Decorative: the tile's name and sentence carry the meaning.
import { Camera } from 'lucide-react';
import type { ReactNode } from 'react';
import { componentWording } from './catalogue-ui';

/** The types shown first, as pictures, in the order office users reach for them. */
export const FEATURED_TYPES = ['photo', 'boolean', 'single_select', 'text', 'number', 'date', 'signature', 'multi_select', 'textarea'] as const;

const box = 'rounded border border-slate-300 bg-white';
const line = (w: string) => <span className={`block h-1.5 rounded-full bg-slate-300 ${w}`} />;

function Radio({ on }: { on?: boolean }) {
  return <span className={`flex size-3 items-center justify-center rounded-full border ${on ? 'border-primary' : 'border-slate-400'}`}>{on ? <span className="size-1.5 rounded-full bg-primary" /> : null}</span>;
}

function Tick({ on }: { on?: boolean }) {
  return (
    <span className={`flex size-3 items-center justify-center rounded-[3px] border text-[8px] leading-none ${on ? 'border-primary bg-primary text-white' : 'border-slate-400'}`}>
      {on ? '✓' : null}
    </span>
  );
}

const ART: Record<string, () => ReactNode> = {
  photo: () => (
    <div className="flex items-center gap-1.5">
      <span className="flex size-10 items-center justify-center rounded border border-dashed border-primary/60 text-primary">
        <Camera className="size-4" />
      </span>
      <span className="size-10 rounded bg-gradient-to-br from-slate-300 to-slate-200" />
      <span className="size-10 rounded bg-gradient-to-br from-slate-200 to-slate-300" />
    </div>
  ),
  boolean: () => (
    <div className="flex gap-1.5 text-[11px] font-medium">
      <span className="rounded-full bg-primary px-3 py-1 text-white">Yes</span>
      <span className="rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-600">No</span>
    </div>
  ),
  single_select: () => (
    <div className="grid gap-1.5">
      {[true, false, false].map((on, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <Radio on={on} />
          {line(i === 0 ? 'w-16' : i === 1 ? 'w-12' : 'w-14')}
        </span>
      ))}
    </div>
  ),
  multi_select: () => (
    <div className="grid gap-1.5">
      {[true, true, false].map((on, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <Tick on={on} />
          {line(i === 0 ? 'w-14' : i === 1 ? 'w-16' : 'w-10')}
        </span>
      ))}
    </div>
  ),
  text: () => (
    <span className={`flex h-7 w-32 items-center px-2 text-[11px] text-slate-500 ${box}`}>
      Shop 4<span className="ml-px h-3.5 w-px animate-none bg-slate-700" />
    </span>
  ),
  textarea: () => (
    <span className={`grid h-14 w-32 content-start gap-1.5 p-2 ${box}`}>
      {line('w-24')}
      {line('w-20')}
      {line('w-12')}
    </span>
  ),
  number: () => (
    <span className="flex items-center gap-1 text-[11px]">
      <span className={`flex size-7 items-center justify-center text-slate-500 ${box}`}>−</span>
      <span className={`flex h-7 w-12 items-center justify-center font-medium ${box}`}>12</span>
      <span className={`flex size-7 items-center justify-center text-slate-500 ${box}`}>+</span>
    </span>
  ),
  date: () => (
    <span className={`grid w-24 grid-cols-7 gap-0.5 p-1.5 ${box}`}>
      {Array.from({ length: 21 }, (_, i) => (
        <span key={i} className={`h-1.5 rounded-sm ${i === 9 ? 'bg-primary' : 'bg-slate-200'}`} />
      ))}
    </span>
  ),
  signature: () => (
    <span className={`flex h-12 w-32 items-end px-2 pb-1.5 ${box}`}>
      <svg viewBox="0 0 110 30" className="h-7 w-full text-slate-700" aria-hidden>
        <path d="M2 22 C 12 4, 18 4, 20 18 S 30 28, 36 12 S 48 2, 50 20 S 62 26, 70 10 S 86 6, 92 18 L 108 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  ),
};

/** The drawing for a type; types without one show their icon large. */
export function QuestionTypeArt({ type }: { type: string }) {
  const draw = ART[type];
  if (draw) return <>{draw()}</>;
  const W = componentWording(type).icon;
  return <W className="size-7 text-slate-500" />;
}
