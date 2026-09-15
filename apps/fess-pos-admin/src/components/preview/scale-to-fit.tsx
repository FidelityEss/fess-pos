'use client';

// Shows a phone at a real phone's width, scaled down only when its column is narrower (T3-12): it lays out as it would on
// the phone (four home stats side by side, not two by two) and still fits beside the editor.
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { MODULE_PHONE } from './module-preview-bridge';

/** A drawn phone's outer width: a real phone's screen plus PhoneFrame's 10 px bezel on each side. */
export const PHONE_OUTER_WIDTH = MODULE_PHONE.width + 20;

export function ScaleToFit({ naturalWidth, children, className }: { naturalWidth: number; children: ReactNode; className?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => setSize({ width: o.clientWidth, height: i.offsetHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(o);
    observer.observe(i);
    return () => observer.disconnect();
  }, []);
  const scale = size.width > 0 ? Math.min(1, size.width / naturalWidth) : 1;
  return (
    <div ref={outer} className={cn('w-full', className)}>
      <div className="relative mx-auto" style={{ width: naturalWidth * scale, height: size.height ? size.height * scale : undefined }}>
        <div ref={inner} className={cn('left-0 top-0 origin-top-left', size.height ? 'absolute' : 'relative')} style={{ width: naturalWidth, transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}
