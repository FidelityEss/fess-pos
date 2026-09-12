// Server-safe constants for display preferences (lib/preferences.tsx is a client module; the root layout needs these
// as plain values for the pre-paint script).

export const PREFS_STORAGE_KEY = 'fess-pos-admin.prefs';

/** Inline <head> script: applies the saved text size before first paint (no flash of small text). */
export const PREFS_BOOTSTRAP_SCRIPT = `try{var p=JSON.parse(localStorage.getItem('${PREFS_STORAGE_KEY}')||'{}');if(p.textSize==='large'||p.textSize==='xlarge')document.documentElement.dataset.textSize=p.textSize}catch(e){}`;
