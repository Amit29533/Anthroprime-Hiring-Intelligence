import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadApp,
  mount,
  screen,
  cleanup,
  stopVite,
  settle,
  click,
  act,
  fireEvent,
} from './ui-harness.js';
import { navTo, press, type, choose, allText } from './ui-drivers.js';
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
const store = () => JSON.parse(localStorage.getItem('ecod-demo-v1'));
async function boot(seed) {
  localStorage.setItem('ecod-demo-v1', JSON.stringify(seed || makeSeed()));
  await mount(M.App);
  await settle(6);
}
test('client documents upload privately and archive/restore without deleting the original', async () => {
  await boot();
  const candidateCount = store().candidates.length;
  await navTo('Clients');
  await click(allText('Meridian Technologies')[0]);
  await settle(3);
  await click(screen.getByRole('button', { name: /^Collaboration and documents/ }));
  assert.ok(screen.getByText('Agreements and documents'));
  const file = new File(['Client agreement terms'], 'Agreement.txt', { type: 'text/plain' });
  await act(async () =>
    fireEvent.change(screen.getByLabelText('Attach client document'), {
      target: { files: [file] },
    }),
  );
  for (let i = 0; i < 30 && !store().documents.some((d) => d.name === 'Agreement.txt'); i++)
    await settle(1);
  const saved = store().documents.find((d) => d.name === 'Agreement.txt');
  assert.ok(saved, 'attachment metadata is persisted');
  assert.ok(saved.dataUrl, 'original stored');
  assert.ok(saved.clientId);
  assert.equal(saved.candidateId, null);
  assert.equal(saved.kind, 'Agreement');
  assert.equal(saved.uploadedBy, 'Amit Singh');
  await press('Archive document');
  await settle(2);
  assert.equal(store().documents.find((d) => d.id === saved.id).removed, true);
  await click(screen.getByLabelText('Show archived'));
  await press('Restore document');
  await settle(2);
  const restored = store().documents.find((d) => d.id === saved.id);
  assert.equal(restored.removed, false);
  assert.equal(restored.dataUrl, saved.dataUrl);
  assert.equal(store().candidates.length, candidateCount);
});
test('structured repository filters combine and persist in saved views', async () => {
  const seed = makeSeed();
  seed.candidates[0].engagement = 'Contract';
  seed.candidates[0].expected = 30;
  await boot(seed);
  await navTo('Candidates');
  await press('Filters');
  await type('Current employer', 'deloitte');
  await choose('Engagement preference', 'Contract');
  await type('Maximum expected CTC (₹ LPA)', '35');
  await settle(2);
  assert.ok(screen.getByText('Aarav Mehta'));
  assert.equal(screen.queryByText('Aditya Sen'), null);
  const previous = window.prompt;
  window.prompt = () => 'Affordable contract talent';
  try {
    await press('Save current view');
  } finally {
    window.prompt = previous;
  }
  await settle(2);
  const view = store()
    .settings.find((row) => row.id === 'workspace')
    .custom.savedViews.at(-1);
  assert.equal(view.filters.repositoryFilters.employer, 'deloitte');
  await press('Clear filters');
  await settle(2);
  assert.ok(screen.getByText('Aditya Sen'));
  await choose('Saved views', view.id);
  await settle(2);
  assert.equal(screen.getByLabelText('Current employer').value, 'deloitte');
  assert.equal(screen.queryByText('Aditya Sen'), null);
});
