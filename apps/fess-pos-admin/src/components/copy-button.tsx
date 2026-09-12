'use client';

import { Check, Copy } from 'lucide-react';
import { type MouseEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Copies `value` to the clipboard; shows a tick for 1.5 s. With `label` it renders a small text button. */
export function CopyButton({
  value,
  label,
  title = 'Copy',
  className,
  variant = 'ghost',
}: {
  value: string;
  label?: string;
  title?: string;
  className?: string;
  variant?: 'ghost' | 'outline' | 'secondary';
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  async function onClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast.error('Could not copy to the clipboard');
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={label ? 'sm' : 'icon-sm'}
      onClick={onClick}
      title={title}
      aria-label={label ? undefined : title}
      className={cn(!label && 'size-6 [&_svg]:size-3.5', className)}
    >
      {copied ? <Check className="text-emerald-600" /> : <Copy />}
      {label}
    </Button>
  );
}
