'use client';

import { Lock } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { keyFromText } from '@/components/admin/form-helpers';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { Details } from '@/components/details';
import { apiFieldErrors, type FieldErrors, FormField, zodFieldErrors } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { adminApi } from '@/lib/api';
import { useMutationWithToast } from '@/lib/mutations';
import { type DeclarationBody, declarationSchema } from '@/lib/schemas';

export interface DeclarationBase {
  key: string;
  title: string;
  text: string;
  version: number;
}

/** Publish a new immutable version of a declaration (base = latest version), or a new declaration (base = null). */
export function PublishDeclarationDialog({
  base,
  open,
  onOpenChange,
}: {
  base: DeclarationBase | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">{open ? <PublishForm base={base} onClose={() => onOpenChange(false)} /> : null}</DialogContent>
    </Dialog>
  );
}

function PublishForm({ base, onClose }: { base: DeclarationBase | null; onClose: () => void }) {
  const uid = useId();
  const [key, setKey] = useState(base?.key ?? '');
  // A new declaration's key follows its title until someone types their own.
  const [keyTouched, setKeyTouched] = useState(false);
  const [title, setTitle] = useState(base?.title ?? '');
  const [text, setText] = useState(base?.text ?? '');
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const shownKey = base ? base.key : keyTouched ? key : keyFromText(title);
  const publish = useMutationWithToast({
    mutationFn: (body: DeclarationBody) => adminApi.declarations.publish(body),
    invalidate: [['declarations']],
    toastErrors: false,
    successMessage: (d) => `Version ${d.version} of “${d.title}” published.`,
    onSuccess: () => onClose(),
  });
  const errors: FieldErrors = { ...apiFieldErrors(publish.error), ...clientErrors };
  const unchanged = base !== null && title.trim() === base.title && text.trim() === base.text.trim();

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = declarationSchema.safeParse({ key: shownKey.trim(), title, text });
    if (!parsed.success) {
      setClientErrors(zodFieldErrors(parsed.error));
      return;
    }
    setClientErrors({});
    publish.mutate(parsed.data);
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{base ? `Publish version ${base.version + 1} of ${base.title}` : 'Add a declaration'}</DialogTitle>
        <DialogDescription>The statement people agree to in the app. Write it exactly as it should appear.</DialogDescription>
      </DialogHeader>
      <Alert variant="info">
        <Lock />
        <AlertDescription>
          Once published, a version can’t be changed. Each agreement records the exact version that was shown, so earlier
          agreements keep pointing at the wording people actually saw.
        </AlertDescription>
      </Alert>
      <FormField label="Title" htmlFor={`${uid}-title`} required error={errors.title}>
        <Input id={`${uid}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} aria-invalid={!!errors.title || undefined} />
      </FormField>
      <FormField label="Wording" htmlFor={`${uid}-text`} required error={errors.text} hint={`${text.length.toLocaleString('en-ZA')} characters`}>
        <Textarea id={`${uid}-text`} value={text} onChange={(e) => setText(e.target.value)} rows={14} maxLength={50_000} className="font-serif leading-relaxed" aria-invalid={!!errors.text || undefined} />
      </FormField>
      <Details defaultOpen={!!errors.key}>
        <FormField
          label="Key"
          htmlFor={`${uid}-key`}
          required
          error={errors.key}
          hint={
            base
              ? 'Publishing under the same key creates the next version.'
              : 'The name the set-up uses to find this declaration. It’s filled in from the title and can’t be changed later.'
          }
        >
          <Input
            id={`${uid}-key`}
            value={shownKey}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
            }}
            readOnly={base !== null}
            maxLength={64}
            className="font-mono"
            aria-invalid={!!errors.key || undefined}
          />
        </FormField>
      </Details>
      {unchanged ? <p className="text-sm text-amber-700">This is the same as the current version. Change the title or wording before publishing.</p> : null}
      <ApiErrorAlert error={publish.error} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={publish.isPending} disabled={unchanged}>
          Publish {base ? `version ${base.version + 1}` : 'version 1'}
        </Button>
      </DialogFooter>
    </form>
  );
}
