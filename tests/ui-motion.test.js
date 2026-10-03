import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, click, screen, cleanup, stopVite, act } from './ui-harness.js';
import { withWindow } from './ui-drivers.js';

afterEach(() => {
  cleanup();
  localStorage.removeItem('anthroprime-motion');
  delete document.documentElement.dataset.motion;
});
test.after(stopVite);

test('decorative motion can be paused and stays paused when another page is opened', async () => {
  const { MotionToggle } = await load('/src/Visuals.jsx');
  await withWindow(
    'matchMedia',
    () => ({ matches: false }),
    async () => {
      await mount(MotionToggle, {});
      await click(screen.getByRole('button', { name: 'Pause decorative motion' }));
      assert.equal(document.documentElement.dataset.motion, 'paused');
      cleanup();
      await mount(MotionToggle, {});
      assert.equal(
        screen
          .getByRole('button', { name: 'Enable decorative motion' })
          .getAttribute('aria-pressed'),
        'true',
      );
      assert.equal(document.documentElement.dataset.motion, 'paused');
      await click(screen.getByRole('button', { name: 'Enable decorative motion' }));
      assert.equal(document.documentElement.dataset.motion, 'on');
    },
  );
});

test('a new visitor who prefers reduced motion starts with decorative motion paused', async () => {
  const { MotionToggle } = await load('/src/Visuals.jsx');
  await withWindow(
    'matchMedia',
    () => ({ matches: true }),
    async () => {
      await mount(MotionToggle, {});
      assert.ok(screen.getByRole('button', { name: 'Enable decorative motion' }));
      assert.equal(document.documentElement.dataset.motion, 'paused');
    },
  );
});

test('pausing motion in another open portal updates the workspace control', async () => {
  const { MotionToggle } = await load('/src/Visuals.jsx');
  await withWindow(
    'matchMedia',
    () => ({ matches: false }),
    async () => {
      await mount(MotionToggle, {});
      await act(async () => {
        window.dispatchEvent(
          new window.StorageEvent('storage', {
            key: 'anthroprime-motion',
            newValue: 'paused',
          }),
        );
      });
      assert.equal(document.documentElement.dataset.motion, 'paused');
      assert.ok(screen.getByRole('button', { name: 'Enable decorative motion' }));
    },
  );
});
