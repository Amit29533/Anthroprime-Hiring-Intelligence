// Builds the demo and packages `dist/` into `releases/ecod-netlify-demo.zip` — the archive the
// README tells you to upload through Netlify's manual-deploy interface. `releases/` is gitignored:
// this zip is a reproducible build artifact, so run `npx pnpm@11.25.0 release` rather than expecting it to
// be checked in.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'releases');
const zip = join(outDir, 'ecod-netlify-demo.zip');

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status}`);
};

console.log('› building');
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);

for (const marker of ['_redirects', '_headers']) {
  if (!existsSync(join(dist, marker))) {
    throw new Error(
      `dist/${marker} is missing — Netlify manual deploys need it for SPA routing and headers`,
    );
  }
}

mkdirSync(outDir, { recursive: true });
rmSync(zip, { force: true });

console.log('› packaging', zip);
if (process.platform === 'win32') {
  run('powershell', [
    '-NoProfile',
    '-Command',
    `Compress-Archive -Path '${join(dist, '*')}' -DestinationPath '${zip}'`,
  ]);
} else if (spawnSync('zip', ['--version'], { stdio: 'ignore' }).status === 0) {
  // -j would flatten the tree; run from dist so the archive holds files at its root, which is
  // what Netlify's "drag and drop / upload a folder" flow expects after extraction.
  run('zip', ['-rq', zip, '.'], { cwd: dist });
} else {
  throw new Error(
    'no zip implementation found — install `zip`, or upload the dist/ folder directly',
  );
}

console.log(`✓ ${zip}`);
console.log('  extract it and upload the extracted folder to Netlify (Deploys › drag and drop).');
