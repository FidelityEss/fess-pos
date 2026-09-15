'use client';

// Authorisation card photo (docs/07 §10): shown to merchants who scan the agent's card.
import { useQuery } from '@tanstack/react-query';
import { ImageUp, UserRound } from 'lucide-react';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { ApiErrorAlert } from '@/components/api-error-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useMutationWithToast } from '@/lib/mutations';
import type { UserPhotoBody } from '@/lib/schemas';
import type { PosUser } from '@/lib/types';

const MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type PhotoType = (typeof PHOTO_TYPES)[number];
const isPhotoType = (t: string): t is PhotoType => (PHOTO_TYPES as readonly string[]).includes(t);

/** The file's bytes as base64 (without the data: prefix). */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Could not read the file'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

export function PhotoCard({ user, canManage }: { user: PosUser; canManage: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const photo = useQuery({
    queryKey: ['users', user.id, 'photo', user.photo_path],
    queryFn: () => adminApi.users.photoUrl(user.id),
    enabled: !!user.photo_path,
    // Signed URLs last 300 s.
    staleTime: 240_000,
    refetchInterval: 240_000,
  });
  const upload = useMutationWithToast({
    mutationFn: (body: UserPhotoBody) => adminApi.users.uploadPhoto(user.id, body),
    invalidate: [['users']],
    toastErrors: false,
    successMessage: 'Photo uploaded',
    onSuccess: () => {
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    },
  });

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFileError(null);
    upload.reset();
    if (!picked) {
      setFile(null);
      return;
    }
    if (!isPhotoType(picked.type)) {
      setFile(null);
      setFileError('Choose a JPEG, PNG or WebP image.');
      return;
    }
    if (picked.size > MAX_BYTES) {
      setFile(null);
      setFileError(`That file is ${formatBytes(picked.size)} — the limit is 5 MB.`);
      return;
    }
    setFile(picked);
  }

  async function send() {
    if (!file || !isPhotoType(file.type)) return;
    setReading(true);
    try {
      const data = await readBase64(file);
      upload.mutate({ content_type: file.type, data_base64: data });
    } catch (err) {
      setFileError(err instanceof Error ? err.message : 'Could not read the file');
    } finally {
      setReading(false);
    }
  }

  const shownUrl = previewUrl ?? photo.data?.url ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Authorisation card photo</CardTitle>
        <CardDescription>Shown to merchants who scan this person’s card. JPEG, PNG or WebP up to 5 MB.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex aspect-square w-full max-w-60 items-center justify-center overflow-hidden rounded-md border bg-white">
          {user.photo_path && photo.isPending && !previewUrl ? (
            <Skeleton className="size-full" />
          ) : shownUrl ? (
            // Signed, short-lived storage URL — next/image would need remote-pattern config for it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shownUrl} alt={previewUrl ? 'Selected photo (not uploaded yet)' : 'Current photo'} className="size-full object-cover" />
          ) : (
            <UserRound className="size-16 text-slate-300" aria-label="No photo" />
          )}
        </div>
        {previewUrl ? <p className="text-sm text-amber-700">Preview — not uploaded yet.</p> : null}
        <ApiErrorAlert error={photo.error} title="Could not load the current photo" />
        {canManage ? (
          <div className="space-y-2">
            <input
              ref={inputRef}
              type="file"
              accept={PHOTO_TYPES.join(',')}
              onChange={onPick}
              className="block w-full text-sm file:mr-2 file:rounded-md file:border file:border-input file:bg-card file:px-3 file:py-2 file:text-sm file:font-medium"
              aria-label="Choose a photo"
            />
            {fileError ? <p className="text-sm text-destructive">{fileError}</p> : null}
            {file ? (
              <Button type="button" size="sm" onClick={() => void send()} loading={reading || upload.isPending}>
                <ImageUp /> Upload {formatBytes(file.size)}
              </Button>
            ) : null}
            <ApiErrorAlert error={upload.error} />
            <p className="text-sm text-muted-foreground">Earlier photos are kept; the newest upload is the one shown.</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
