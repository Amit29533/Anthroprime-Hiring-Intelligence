import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');

function directive(name) {
  const policy = headers.match(/Content-Security-Policy:\s*([^\n]+)/i)?.[1];
  assert.ok(policy, 'the deployable headers file must define a CSP');
  return policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
}

test('CSP allows the configured Supabase and R2 network requests without unsafe script execution', () => {
  const connect = directive('connect-src');
  assert.ok(connect, 'cloud API and signed object-storage requests need connect-src');
  assert.match(connect, /https:\/\/\*\.supabase\.co/);
  assert.match(connect, /wss:\/\/\*\.supabase\.co/);
  assert.match(connect, /https:\/\/\*\.r2\.cloudflarestorage\.com/);

  const scripts = directive('script-src');
  assert.ok(scripts);
  assert.doesNotMatch(scripts, /unsafe-inline|unsafe-eval/);
});
