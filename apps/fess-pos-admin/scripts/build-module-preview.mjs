#!/usr/bin/env node
// Builds the phone app's preview (packages/fess_pos/example/lib/preview.dart) for the web and puts it in
// public/module-preview/, which this admin serves at /module-preview/ for its phone preview (T3-12, D-101).
//
//   pnpm --dir apps/fess-pos-admin module-preview           by hand: fails if anything goes wrong
//   node scripts/build-module-preview.mjs --soft             the admin's own build (prebuild / vercel-build): never fails
//
// Where Flutter comes from:
//   - On Vercel (VERCEL is set): the pinned version (package.json "config": {"flutter_version"}), installed by a shallow
//     git clone of exactly that tag into a cache folder (FESS_POS_FLUTTER_CACHE, default .next/cache/fess-pos-flutter,
//     which Vercel keeps between builds when it can). Flutter then downloads its Dart SDK and web files on first use.
//   - Anywhere else: the `flutter` on the PATH (a different version only gets a note).
// With --soft, any failure prints a loud warning and exits 0: the admin build carries on, and its phone preview shows the
// sketch, as it does whenever the app is missing. FESS_POS_SKIP_MODULE_PREVIEW=1 skips the step (the same result).
//
// Served from the admin's own origin, the preview listens only to this admin (the module's default: its own origin), so
// no origin setting is needed. Kept: what the page loads (the app, the CanvasKit renderer, fonts). Left out: the
// WebAssembly-only renderers, debug symbols, and the local-store files (sqlite3.wasm, drift_worker.js): a preview never
// opens the store (D-90). The output is not committed (see .gitignore and D-101); it is about 19 MB.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const admin = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(admin, '..', '..');
const example = join(repo, 'packages', 'fess_pos', 'example');
const out = join(admin, 'public', 'module-preview');
const soft = process.argv.includes('--soft');
const onVercel = !!process.env.VERCEL;
const MINUTE = 60_000;

/** Runs a command with its output shown as it goes (the build log). */
function run(cmd, args, cwd, { timeout = 20 * MINUTE, env } = {}) {
  try {
    execFileSync(cmd, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'], timeout, env: env ?? process.env });
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`${cmd} is not on the PATH. Install Flutter (docs/03 §7) and try again.`);
    const what = [cmd.split('/').pop(), ...args.filter((a) => !a.startsWith('-') && !a.includes('=')).slice(0, 2)].join(' ');
    if (e.signal === 'SIGTERM') throw new Error(`${what} took longer than ${timeout / MINUTE} minutes and was stopped.`);
    throw new Error(`${what} failed (exit ${e.status ?? e.signal}); its output is above.`);
  }
}

/** A path for the log: relative inside the repo, in full outside it. */
const shown = (p) => (p.startsWith(repo) ? relative(repo, p) : p);

/** Runs a command and returns what it printed. */
function read(cmd, args, cwd, env) {
  return execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 5 * MINUTE, env: env ?? process.env });
}

function pinnedFlutter() {
  const version = process.env.FESS_POS_FLUTTER_VERSION || JSON.parse(readFileSync(join(admin, 'package.json'), 'utf8')).config?.flutter_version;
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('No pinned Flutter version (package.json "config": {"flutter_version"}).');
  return version;
}

/** On Vercel: the pinned Flutter, from the cache when it is there, else a shallow clone of exactly that tag. */
function flutterOnVercel(version) {
  const cache = process.env.FESS_POS_FLUTTER_CACHE || join(admin, '.next', 'cache', 'fess-pos-flutter');
  const root = join(cache, `flutter-${version}`);
  const flutter = join(root, 'bin', 'flutter');
  const env = {
    ...process.env,
    CI: 'true',
    FLUTTER_SUPPRESS_ANALYTICS: 'true',
    PUB_CACHE: join(cache, 'pub-cache'),
    PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
  };
  let cached = false;
  if (existsSync(flutter)) {
    try {
      cached = read('git', ['tag', '--points-at', 'HEAD'], root).split('\n').includes(version);
    } catch {
      cached = false;
    }
  }
  if (cached) {
    console.log(`Flutter ${version}: using the cached copy in ${shown(root)}.`);
  } else {
    console.log(`Flutter ${version}: installing (shallow clone of the ${version} tag into ${shown(root)})…`);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(cache, { recursive: true });
    const source = process.env.FESS_POS_FLUTTER_GIT_URL || 'https://github.com/flutter/flutter.git';
    run('git', ['-c', 'advice.detachedHead=false', 'clone', '--depth', '1', '--branch', version, '--single-branch', source, root], cache, {
      timeout: 10 * MINUTE,
    });
  }
  run(flutter, ['config', '--no-analytics'], example, { timeout: 15 * MINUTE, env });
  run(flutter, ['--version'], example, { timeout: 15 * MINUTE, env });
  return { flutter, env };
}

/** Anywhere else: the installed Flutter. */
function flutterOnPath(version) {
  let found = '';
  try {
    found = /Flutter (\S+)/.exec(read('flutter', ['--version'], example))?.[1] ?? '';
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('flutter is not on the PATH. Install Flutter (docs/03 §7) and try again.');
    throw e;
  }
  if (found !== version) console.log(`Note: this is Flutter ${found || 'of an unknown version'}; hosted builds use ${version}.`);
  return { flutter: 'flutter', env: process.env };
}

const skipped = (path) =>
  path.endsWith('.symbols') ||
  /^canvaskit\/(skwasm|wimp)/.test(path) ||
  path === 'sqlite3.wasm' ||
  path === 'drift_worker.js';

function build() {
  const started = Date.now();
  const version = pinnedFlutter();
  const { flutter, env } = onVercel ? flutterOnVercel(version) : flutterOnPath(version);
  const tmp = mkdtempSync(join(tmpdir(), 'fess-pos-module-preview-'));
  const staging = `${out}.new`;
  try {
    console.log('Building the phone app for the web (lib/preview.dart)…');
    run(flutter, [
      'build', 'web', '--release', '--target', 'lib/preview.dart', '--base-href', '/module-preview/',
      '--no-web-resources-cdn', '--no-wasm-dry-run', '-o', tmp,
    ], example, { timeout: 25 * MINUTE, env });
    if (!existsSync(join(tmp, 'main.dart.js'))) throw new Error('The build has no main.dart.js.');

    rmSync(staging, { recursive: true, force: true });
    cpSync(tmp, staging, { recursive: true, filter: (src) => !skipped(relative(tmp, src)) });
    const index = join(staging, 'index.html');
    writeFileSync(index, readFileSync(index, 'utf8')
      .replace(/<title>[^<]*<\/title>/, '<title>POS phone preview</title>')
      .replace(/(<meta name="description" content=")[^"]*"/, '$1The POS phone app in preview mode, for the admin panel."'));

    const moduleVersion = /^version:\s*(\S+)/m.exec(readFileSync(join(repo, 'packages', 'fess_pos', 'pubspec.yaml'), 'utf8'))?.[1] ?? 'unknown';
    let commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'unknown';
    if (commit === 'unknown') {
      try {
        commit = read('git', ['rev-parse', '--short', 'HEAD'], repo).trim();
        if (read('git', ['status', '--porcelain', '--', 'packages/fess_pos'], repo).trim()) commit += '+changes';
      } catch {
        // not a git checkout
      }
    }
    writeFileSync(join(staging, 'preview-build.json'), `${JSON.stringify({
      module_version: moduleVersion, flutter_version: version, built_at: new Date().toISOString(), commit,
    }, null, 2)}\n`);

    // Swap in the new build whole, so a failed build never leaves half an app behind.
    rmSync(out, { recursive: true, force: true });
    renameSync(staging, out);

    let bytes = 0;
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else bytes += statSync(p).size;
      }
    };
    walk(out);
    const took = Math.round((Date.now() - started) / 1000);
    console.log(`Done: ${relative(repo, out)} (${(bytes / 1_048_576).toFixed(1)} MB, module ${moduleVersion}, ${commit}; ${took} s).`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(staging, { recursive: true, force: true });
  }
}

function warnLoudly(reason) {
  const line = '='.repeat(100);
  console.warn(`\n${line}\nWARNING: the phone app's web build (the admin's phone preview) was NOT made.\n  ${reason}\n` +
    'The admin build carries on without it: its phone preview shows the sketch instead of the real app.\n' +
    `To make it by hand: pnpm --dir apps/fess-pos-admin module-preview (docs/15 §6, D-101).\n${line}\n`);
}

if (process.env.FESS_POS_SKIP_MODULE_PREVIEW === '1') {
  console.log('Phone app web build skipped (FESS_POS_SKIP_MODULE_PREVIEW=1): the phone preview shows the sketch.');
} else if (soft) {
  try {
    build();
  } catch (e) {
    warnLoudly(e instanceof Error ? e.message : String(e));
  }
} else {
  build();
}
