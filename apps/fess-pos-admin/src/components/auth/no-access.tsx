'use client';

import { LogOut, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useSignOut } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import { AuthCard } from './auth-card';

/** Full-page message when /me answers FORBIDDEN (signed in, but not an active POS admin/reader). */
export function NoAccess() {
  const signOut = useSignOut();
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    void getSupabase()
      .auth.getSession()
      .then(({ data }) => setEmail(data.session?.user.email ?? null));
  }, []);

  return (
    <AuthCard title="No POS admin access" wide>
      <Alert variant="warning">
        <ShieldAlert />
        <AlertDescription>This account has no active POS admin access — ask a POS administrator to provision you</AlertDescription>
      </Alert>
      {email ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{email}</span>
        </p>
      ) : null}
      <Button className="mt-4 w-full" variant="outline" onClick={() => void signOut()}>
        <LogOut /> Sign out
      </Button>
    </AuthCard>
  );
}
