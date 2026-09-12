import type { ReactNode } from 'react';
import { AuthGate } from '@/components/auth/auth-gate';
import { AppShell } from '@/components/shell/app-shell';

/** Every screen under (app) requires a session, MFA (aal2) and an active POS admin/reader (/me). */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <AppShell>{children}</AppShell>
    </AuthGate>
  );
}
