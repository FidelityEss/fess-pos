#!/usr/bin/env node
// Builds the phone app's preview (packages/fess_pos/example/lib/preview.dart) for the web and puts it in
// public/module-preview/, which this admin serves at /module-preview/ for its phone preview (T3-12, D-101).
//
//   pnpm --dir apps/fess-pos-admin module-preview
//
// Needs Flutter (the version the module is built with) with its web SDK cached. Served from the admin's own origin, the
// preview listens only to this admin (the module's default: its own origin), so no origin setting is needed.
//
// Kept: what the page loads (the app, the CanvasKit renderer, fonts). Left out: the WebAssembly-only renderers, debug
// symbols, and the local-store files (sqlite3.wasm, drift_worker.js): a preview never opens the store (D-90).
// The output is not committed (see .gitignore and D-101); it is about 19 MB.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const admin = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(admin, '..', '..');
const example = join(repo, 'packages', 'fess_pos', 'example');
const out = join(admin, 'public', 'module-preview');
const tmp = mkdtempSync(join(tmpdir(), 'fess-pos-module-preview-'));

function run(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`${cmd} is not on the PATH. Install Flutter (docs/03 §7) and try again.`);
    throw e;
  }
}

const skipped = (path) =>
  path.endsWith('.symbols') ||
  /^canvaskit\/(skwasm|wimp)/.test(path) ||
  path === 'sqlite3.wasm' ||
  path === 'drift_worker.js';

try {
  console.log('Building the phone app for the web (lib/preview.dart)…');
  process.stdout.write(run('flutter', [
    'build', 'web', '--release', '--target', 'lib/preview.dart', '--base-href', '/module-preview/',
    '--no-web-resources-cdn', '--no-wasm-dry-run', '-o', tmp,
  ], example));

  rmSync(out, { recursive: true, force: true });
  cpSync(tmp, out, { recursive: true, filter: (src) => !skipped(relative(tmp, src)) });

  const index = join(out, 'index.html');
  writeFileSync(index, readFileSync(index, 'utf8')
    .replace(/<title>[^<]*<\/title>/, '<title>POS phone preview</title>')
    .replace(/(<meta name="description" content=")[^"]*"/, '$1The POS phone app in preview mode, for the admin panel."'));

  const version = /^version:\s*(\S+)/m.exec(readFileSync(join(repo, 'packages', 'fess_pos', 'pubspec.yaml'), 'utf8'))?.[1] ?? 'unknown';
  let commit = 'unknown';
  try {
    commit = run('git', ['rev-parse', '--short', 'HEAD'], repo).trim();
    if (run('git', ['status', '--porcelain', '--', 'packages/fess_pos'], repo).trim()) commit += '+changes';
  } catch {
    // not a git checkout
  }
  writeFileSync(join(out, 'preview-build.json'), `${JSON.stringify({ module_version: version, built_at: new Date().toISOString(), commit }, null, 2)}\n`);

  let bytes = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else bytes += statSync(p).size;
    }
  };
  walk(out);
  console.log(`Done: ${relative(repo, out)} (${(bytes / 1_048_576).toFixed(1)} MB, module ${version}, ${commit}).`);
  if (!existsSync(join(out, 'main.dart.js'))) throw new Error('The build has no main.dart.js.');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
