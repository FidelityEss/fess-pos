'use client';

// Per-browser display preferences: text size (readability) and view mode (Basic hides technical screens and detail).
// UX only — never a security boundary: access is enforced by the API and RLS whatever the mode.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PREFS_STORAGE_KEY as STORAGE_KEY } from './preferences-script';

export type TextSize = 'standard' | 'large' | 'xlarge';
export type ViewMode = 'basic' | 'advanced';

export const TEXT_SIZES: readonly { value: TextSize; label: string; px: number }[] = [
  { value: 'standard', label: 'Standard', px: 16 },
  { value: 'large', label: 'Large', px: 18 },
  { value: 'xlarge', label: 'Extra large', px: 20 },
];

interface Prefs {
  textSize: TextSize;
  viewMode: ViewMode;
}

const DEFAULTS: Prefs = { textSize: 'standard', viewMode: 'basic' };

function isTextSize(v: unknown): v is TextSize {
  return v === 'standard' || v === 'large' || v === 'xlarge';
}

function readPrefs(): Prefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Prefs>;
    return {
      textSize: isTextSize(raw.textSize) ? raw.textSize : DEFAULTS.textSize,
      viewMode: raw.viewMode === 'advanced' ? 'advanced' : 'basic',
    };
  } catch {
    return DEFAULTS;
  }
}

interface PreferencesValue extends Prefs {
  setTextSize: (size: TextSize) => void;
  setViewMode: (mode: ViewMode) => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);

  useEffect(() => {
    document.documentElement.dataset.textSize = prefs.textSize;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      // storage unavailable (private mode): preferences last for this tab only
    }
  }, [prefs]);

  // Keep several open tabs in step.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setPrefs(readPrefs());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTextSize = useCallback((textSize: TextSize) => setPrefs((p) => ({ ...p, textSize })), []);
  const setViewMode = useCallback((viewMode: ViewMode) => setPrefs((p) => ({ ...p, viewMode })), []);
  const value = useMemo(() => ({ ...prefs, setTextSize, setViewMode }), [prefs, setTextSize, setViewMode]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return ctx;
}

/** True in Advanced mode. */
export function useIsAdvanced(): boolean {
  return usePreferences().viewMode === 'advanced';
}

/** Renders its children only in Advanced mode (optionally a Basic-mode fallback). */
export function Advanced({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return <>{useIsAdvanced() ? children : fallback}</>;
}

/** Renders its children only in Basic mode. */
export function BasicOnly({ children }: { children: ReactNode }) {
  return <>{useIsAdvanced() ? null : children}</>;
}
