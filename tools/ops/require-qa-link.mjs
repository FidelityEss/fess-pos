// Stops a command unless the Supabase CLI is linked to QA. Database tests and seeders never run on production
// (instructions §10, rule 6), and `supabase test db --linked` would run against whatever project is linked.
import { readFileSync } from 'node:fs';

const QA = 'ysbgdxhdexpjvmlnjofc';
let ref = '';
try {
  ref = readFileSync(new URL('../../supabase/.temp/project-ref', import.meta.url), 'utf8').trim();
} catch {
  // not linked at all
}
if (ref !== QA) {
  console.error(`Refusing: the Supabase CLI is linked to "${ref || 'nothing'}", not QA (${QA}). Run: supabase link --project-ref ${QA}`);
  process.exit(1);
}
