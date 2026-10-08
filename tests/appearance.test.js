import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../public/appearance.js', import.meta.url), 'utf8');
function paint(values = {}, preferences = {}, blocked = false) {
  const root = { dataset: {}, style: {} };
  vm.runInNewContext(source, {
    document: { documentElement: root },
    localStorage: {
      getItem(key) {
        if (blocked) throw Error('Unavailable');
        return values[key] ?? null;
      },
    },
    window: {
      matchMedia(query) {
        return { matches: !!preferences[query] };
      },
    },
  });
  return root;
}
test('first paint honors saved theme and paused motion without storage writes', () => {
  const root = paint({ 'ecod-theme-v1': 'dark', 'anthroprime-motion': 'paused' });
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(root.style.colorScheme, 'dark');
  assert.equal(root.dataset.motion, 'paused');
  assert.equal(
    paint({ 'ecod-theme-v1': 'light' }, { '(prefers-color-scheme: dark)': true }).dataset.theme,
    'light',
  );
});
test('first paint follows system preferences and remains usable when storage is blocked', () => {
  const root = paint(
    {},
    { '(prefers-color-scheme: dark)': true, '(prefers-reduced-motion: reduce)': true },
    true,
  );
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(root.dataset.motion, 'paused');
  assert.equal(paint({ 'ecod-theme-v1': 'invalid' }).dataset.theme, 'light');
});
