import test from 'node:test';
import assert from 'node:assert/strict';
import {
  load,
  mount,
  click,
  screen,
  cleanup,
  stopVite,
  downloaded,
  resetDownloads,
  blobText,
} from './ui-harness.js';
import { normalizeData } from '../src/schema.js';
import { makeSeed } from '../src/seed.js';
import { anthroIdFor, candidateLabel } from '../src/anthroId.js';

test.afterEach(() => cleanup());
test.after(async () => {
  await stopVite();
});

test('the repository finds an exact Anthro-ID and exports the same identity', async () => {
  const { Candidates, exportCandidates } = await load('/src/Candidates.jsx');
  const data = normalizeData(makeSeed());
  const c = data.candidates[0];
  const identity = anthroIdFor(c);
  const opened = [];
  await mount(Candidates, {
    data,
    query: identity,
    onQuery: () => {},
    onOpen: (id) => opened.push(id),
    onNew: () => {},
    onImport: () => {},
    onSave: async () => true,
    notify: () => {},
  });
  assert.equal(screen.getAllByText(identity).length, 1);
  await click(screen.getByRole('button', { name: new RegExp(c.name) }));
  assert.deepEqual(opened, [c.id]);
  resetDownloads();
  exportCandidates([c]);
  const csv = await blobText(downloaded[0].blob);
  assert.ok(csv.includes('anthroId'));
  assert.ok(csv.includes(identity));
});

test('training and assessment selectors distinguish candidates using Anthro-ID', async () => {
  const { EnrichmentForm, AssessmentForm } = await load('/src/Workflows.jsx');
  const data = normalizeData(makeSeed());
  const c = data.candidates[0];
  const props = { data, onSave: async () => true, onClose: () => {}, busy: false };
  await mount(EnrichmentForm, props);
  assert.equal(screen.getByRole('option', { name: candidateLabel(c), exact: true }).value, c.id);
  cleanup();
  await mount(AssessmentForm, props);
  assert.equal(screen.getByRole('option', { name: candidateLabel(c), exact: true }).value, c.id);
});

test('profile editing exposes a read-only Anthro-ID', async () => {
  const { CandidateForm } = await load('/src/Candidates.jsx');
  const data = normalizeData(makeSeed());
  const c = data.candidates[0];
  await mount(CandidateForm, {
    candidate: c,
    data,
    onSave: async () => true,
    onClose: () => {},
    busy: false,
  });
  const field = screen.getByDisplayValue(anthroIdFor(c));
  assert.equal(field.readOnly, true);
});
