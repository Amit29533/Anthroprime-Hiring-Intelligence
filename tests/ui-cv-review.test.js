import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
import { makeSeed } from '../src/seed.js';
let M;
test.before(async () => {
  M = await loadApp();
});
test.after(async () => {
  cleanup();
  await stopVite();
});
afterEach(() => cleanup());
async function draft(data, saved) {
  await mount(M.ImportModal, {
    data,
    onClose: () => {},
    onSave: async (...args) => {
      saved.push(args);
      return true;
    },
    busy: false,
    notify: () => {},
  });
  fireEvent.click(screen.getByText('Paste email content'));
  fireEvent.change(
    screen.getByPlaceholderText(
      'Paste the forwarded application email here — headers are stripped automatically…',
    ),
    { target: { value: 'Application\nReact developer' } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Extract CV from email' }));
  await settle();
}
test('a recruiter can correct an incomplete CV draft and import the reviewed values', async () => {
  const saved = [];
  await draft(makeSeed(), saved);
  fireEvent.change(screen.getByLabelText('Candidate name for Forwarded email'), {
    target: { value: 'Morgan Example' },
  });
  fireEvent.change(screen.getByLabelText('Email for Forwarded email'), {
    target: { value: 'morgan@example.com' },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Import 1 profile with CVs' }));
  await settle();
  assert.equal(saved[0][0], 'candidates');
  assert.equal(saved[0][1][0].name, 'Morgan Example');
  assert.equal(saved[0][1][0].email, 'morgan@example.com');
});
test('correcting a draft to an existing contact blocks import', async () => {
  const seed = makeSeed(),
    saved = [];
  seed.candidates[0].email = 'existing@example.com';
  await draft(seed, saved);
  fireEvent.change(screen.getByLabelText('Candidate name for Forwarded email'), {
    target: { value: 'Morgan Example' },
  });
  fireEvent.change(screen.getByLabelText('Email for Forwarded email'), {
    target: { value: 'existing@example.com' },
  });
  await settle();
  assert.ok(screen.getByText(`Duplicate of ${seed.candidates[0].name}; skip or review.`));
  assert.equal(screen.getByRole('button', { name: 'Import 0 profiles with CVs' }).disabled, true);
  assert.equal(saved.length, 0);
});
