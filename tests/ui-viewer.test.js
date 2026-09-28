// Exercise the real workspace components with Vite configured as cloud mode. Repository roles
// start restrictive until membership is loaded, so this verifies viewer-facing controls without
// needing a hosted Supabase project or attempting any network writes.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, loadApp, mount, click, screen, cleanup, stopVite, makeSeed } from './ui-harness.js';

process.env.VITE_SUPABASE_URL = 'https://viewer-test.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'viewer-test-anon-key';

let M;
let data;
let repository;
const noop = () => {};

test.before(async () => {
  M = await loadApp();
  repository = await load('/src/repository.js');
  data = makeSeed();
  assert.equal(repository.cloud, true, 'the UI is running with cloud role checks enabled');
  assert.equal(repository.getRole(), 'viewer', 'unresolved cloud roles fail closed');
});
test.after(async () => {
  cleanup();
  await stopVite();
});
afterEach(() => cleanup());

test('viewer can inspect the dashboard and repository but cannot start mutations or export', async () => {
  await mount(M.Dashboard, {
    data,
    navigate: noop,
    openCandidate: noop,
    openDemand: noop,
    onNewDemand: noop,
    onAdd: noop,
    onImport: noop,
    onComplete: noop,
  });
  assert.equal(screen.queryByRole('button', { name: 'Create demand' }), null);
  assert.equal(screen.queryByRole('button', { name: /Find matching talent/ }), null);
  assert.equal(screen.queryByRole('button', { name: /Import candidates/ }), null);
  assert.equal(document.querySelector('[aria-label^="Complete follow-up"]') === null, true);
  cleanup();

  await mount(M.Candidates, {
    data,
    query: '',
    setQuery: noop,
    onOpen: noop,
    onAdd: noop,
    onImport: noop,
    notify: noop,
    audit: noop,
    onSave: noop,
  });
  assert.equal(screen.queryByRole('button', { name: 'Add candidate' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Import candidates' }), null);
  const exportButton = screen.getByRole('button', { name: /^Export/ });
  assert.equal(exportButton.disabled, true);
});

test('candidate profiles expose read-only tabs but hide profile edits, notes, consent writes and exports', async () => {
  const candidate = data.candidates[0];
  await mount(M.CandidateProfile, {
    candidate,
    data,
    onClose: noop,
    onEdit: noop,
    onSave: noop,
    onShortlist: noop,
    onAssess: noop,
    busy: false,
    audit: noop,
    initialTab: 'Overview',
    onTabChange: noop,
    notify: noop,
  });
  assert.ok(screen.getByText('Read only'));
  for (const name of ['Edit', 'Generate letter', 'Dossier'])
    assert.equal(screen.queryByRole('button', { name }), null, `${name} is unavailable`);
  assert.equal(screen.queryByRole('link', { name: 'Portal invite' }), null);

  await click(screen.getByRole('button', { name: 'Notes & follow-ups' }));
  assert.equal(screen.queryByRole('button', { name: 'Save note' }), null);
  await click(screen.getByRole('button', { name: 'Consent & privacy' }));
  assert.equal(screen.queryByRole('button', { name: "Export this profile's data" }), null);
  assert.equal(screen.queryByRole('button', { name: 'Record consent' }), null);
});

test('viewer workflow, demand, interview and settings controls cannot mutate or export', async () => {
  await mount(M.Demands, { data, onNew: noop, onOpen: noop });
  assert.equal(screen.queryByRole('button', { name: 'Create demand' }), null);
  cleanup();

  await mount(M.Pipeline, {
    data,
    selectedDemand: null,
    setSelectedDemand: noop,
    onOpen: noop,
    onNew: noop,
    onMove: noop,
    busy: false,
  });
  assert.equal(screen.queryByRole('button', { name: 'Create demand' }), null);
  const stageControl = document.querySelector('select[aria-label^="Stage for"]');
  if (stageControl) assert.equal(stageControl.disabled, true);
  cleanup();

  await mount(M.Assessments, {
    data,
    onNew: noop,
    onEnrich: noop,
    onOpen: noop,
    onSave: noop,
    busy: false,
  });
  assert.equal(screen.queryByRole('button', { name: 'Record assessment' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Enrichment plan' }), null);
  cleanup();

  await mount(M.Interviews, {
    data,
    onSave: noop,
    onOpen: noop,
    busy: false,
    notify: noop,
    audit: noop,
  });
  assert.equal(screen.queryByRole('button', { name: 'Schedule interview' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Import .ics' }), null);
  const calendarExport = screen.getByRole('button', { name: 'Export calendar (.ics)' });
  assert.equal(calendarExport.disabled, true);
  assert.equal(screen.queryByRole('button', { name: 'New offer' }), null);
  cleanup();

  await mount(M.Settings, {
    data,
    session: null,
    onReload: noop,
    notify: noop,
    audit: noop,
    onSave: noop,
  });
  const csvExport = screen.getByRole('button', { name: 'Export candidate CSV' });
  const backupExport = screen.getByRole('button', { name: /Download workspace backup/ });
  assert.equal(csvExport.disabled, true);
  assert.equal(backupExport.disabled, true);
  assert.equal(screen.queryByText('Restore from backup'), null);
  assert.ok(screen.getByText(/viewer role is read-only/i));
  assert.ok(
    screen.getByText(/This release includes in-browser CV parsing, private document storage/),
    'settings distinguishes shipped capabilities from future integrations',
  );
});
