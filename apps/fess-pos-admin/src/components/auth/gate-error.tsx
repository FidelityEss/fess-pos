'use client';

import { LogOut } from 'lucide-react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { Button } from '@/components/ui/button';
import { useSignOut } from '@/lib/auth';
import { AuthCard } from './auth-card';

/** Full-page error when /me fails for a reason other than FORBIDDEN (e.g. the POS API is down). */
export function GateError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const signOut = useSignOut();
  return (
    <AuthCard title="Couldn't load your profile" description="The panel could not confirm your POS admin access." wide>
      <ApiErrorAlert error={error} onRetry={onRetry} />
      <Button className="mt-4 w-full" variant="outline" onClick={() => void signOut()}>
        <LogOut /> Sign out
      </Button>
    </AuthCard>
  );
}
