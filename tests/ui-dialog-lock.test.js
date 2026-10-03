import test from 'node:test';
import assert from 'node:assert/strict';
import { React, load, mount, click, screen, within, cleanup, stopVite } from './ui-harness.js';

test.after(async () => {
  cleanup();
  await stopVite();
});

test('overlapping dialogs restore page scrolling only when the final dialog closes', async () => {
  const { Modal } = await load('/src/ui.jsx');
  function Dialogs() {
    const [first, setFirst] = React.useState(true);
    const [second, setSecond] = React.useState(true);
    return React.createElement(
      React.Fragment,
      null,
      first &&
        React.createElement(
          Modal,
          { title: 'First', onClose: () => setFirst(false) },
          'First dialog',
        ),
      second &&
        React.createElement(
          Modal,
          { title: 'Second', onClose: () => setSecond(false) },
          'Second dialog',
        ),
    );
  }
  document.body.style.overflow = 'auto';
  try {
    await mount(Dialogs);
    await click(
      within(screen.getByRole('dialog', { name: 'First' })).getByRole('button', {
        name: 'Close dialog',
      }),
    );
    assert.equal(document.body.style.overflow, 'hidden', 'remaining dialog keeps scroll locked');
    await click(
      within(screen.getByRole('dialog', { name: 'Second' })).getByRole('button', {
        name: 'Close dialog',
      }),
    );
    assert.equal(document.body.style.overflow, 'auto', 'original overflow is restored');
  } finally {
    cleanup();
    document.body.style.overflow = '';
  }
});
