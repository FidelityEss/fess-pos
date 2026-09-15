import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth/auth-gate';
import { AppShell } from '@/components/shell/app-shell';

/** Every screen under (app) requires a session and an active POS admin or bank viewer (/me). */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
