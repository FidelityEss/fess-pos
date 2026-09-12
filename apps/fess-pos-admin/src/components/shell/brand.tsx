import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * FESS POS Admin brand (FESS look, schema/design/tokens.json): the FESS app icon + wordmark, or the full Fidelity Services
 * Group logo (sign-in and other standalone pages). The images are Fidelity's own brand assets from the FESS app.
 */
export function Brand({ className, inverted = false, variant = 'mark' }: { className?: string; inverted?: boolean; variant?: 'mark' | 'full' }) {
  if (variant === 'full') {
    return (
      <span className={cn('inline-flex flex-col items-center gap-3', className)}>
        <Image src="/brand/fidelity-services-group.png" alt="Fidelity Services Group" width={240} height={58} priority />
        <span className="text-sm font-semibold tracking-wide text-primary">FESS POS Admin</span>
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <Image src="/brand/fess-app-icon.png" alt="" width={32} height={32} className="size-8 rounded-full ring-1 ring-white/25" />
      <span className={cn('text-[0.9375rem] font-semibold tracking-tight', inverted ? 'text-white' : 'text-foreground')}>
        FESS POS <span className={inverted ? 'font-medium text-sidebar-foreground/80' : 'text-muted-foreground'}>Admin</span>
      </span>
    </span>
  );
}
