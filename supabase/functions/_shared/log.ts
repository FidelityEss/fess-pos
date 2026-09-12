// Structured logs, one JSON object per line. Never log PII, coordinates, tokens or evidence hashes at info level
// (DEVELOPMENT-GUIDELINES §4). Pass ids, codes and counts only.

type Level = 'debug' | 'info' | 'warn' | 'error';

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, msg, at: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
