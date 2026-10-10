import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  load,
  loadApp,
  mount,
  click,
  change,
  screen,
  fireEvent,
  act,
  cleanup,
  stopVite,
  React,
  settle,
} from './ui-harness.js';
import { makeSeed } from '../src/seed.js';
import { normalizeData } from '../src/schema.js';

afterEach(cleanup);
test.after(stopVite);

test('repository search focuses from its surface and clearing keeps focus without submitting a parent form', async () => {
  const { SearchBox } = await load('/src/ui.jsx');
  let submitted = 0;
  function SearchForm() {
    const [value, setValue] = React.useState('React');
    return React.createElement(
      'form',
      {
        onSubmit: (event) => {
          event.preventDefault();
          submitted++;
        },
      },
      React.createElement(SearchBox, { value, onChange: setValue }),
    );
  }
  await mount(SearchForm);
  const input = screen.getByRole('textbox', { name: 'Search candidates, skills, companies…' });
  await click(input.parentElement);
  assert.equal(document.activeElement === input, true);
  input.blur();
  await click(input.parentElement.querySelector('svg'));
  assert.equal(document.activeElement === input, true);
  await click(screen.getByRole('button', { name: 'Clear search' }));
  assert.equal(input.value, '');
  assert.equal(document.activeElement === input, true);
  assert.equal(submitted, 0);
});

test('optional actions dismiss with Escape and outside clicks, keeping a usable keyboard destination', async () => {
  const { MoreOptions } = await load('/src/ProgressiveUI.jsx');
  const invoked = [];
  await mount(MoreOptions, {
    label: 'Actions',
    children: React.createElement('button', { onClick: () => invoked.push(true) }, 'Export'),
  });
  const trigger = screen.getByRole('button', { name: 'Actions' });
  assert.equal(screen.queryByRole('button', { name: 'Export' }) === null, true);
  await click(trigger);
  const action = screen.getByRole('button', { name: 'Export' });
  action.focus();
  await act(async () => fireEvent.keyDown(action, { key: 'Escape' }));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement === trigger, true);
  await click(trigger);
  await act(async () => fireEvent.pointerDown(document.body));
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  await click(trigger);
  await click(screen.getByRole('button', { name: 'Export' }));
  assert.equal(invoked.length, 1);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('collapsed advanced forms preserve drafts and reveal nested invalid required fields', async () => {
  const { FormSection } = await load('/src/ProgressiveUI.jsx');
  await mount(FormSection, {
    title: 'Details',
    children: React.createElement(
      'details',
      null,
      React.createElement('summary', null, 'Custom fields'),
      React.createElement('input', { 'aria-label': 'Reference', required: true }),
    ),
  });
  const input = screen.getByLabelText('Reference');
  const outer = document.querySelector('.form-section');
  assert.equal(outer.open, false);
  await act(async () => fireEvent.invalid(input));
  assert.equal(outer.open, true);
  assert.equal(input.closest('details').open, true);
  await change(input, 'draft reference');
  await click(outer.querySelector('summary'));
  await click(outer.querySelector('summary'));
  assert.equal(input.value, 'draft reference');
});

test('settings starts with category choices and mounts tools only after selection', async () => {
  const M = await loadApp();
  await mount(M.Settings, {
    data: normalizeData(makeSeed()),
    session: null,
    onSave: async () => true,
    onReload: async () => {},
    notify: () => {},
    audit: () => {},
  });
  assert.ok(screen.getByRole('heading', { name: 'Workspace settings' }));
  assert.equal(screen.queryByRole('button', { name: 'Reset demo data' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Save stage labels' }), null);
  await click(screen.getByRole('button', { name: /^Workspace and data/ }));
  assert.ok(screen.getByRole('button', { name: 'Reset demo data' }));
  await click(screen.getByRole('button', { name: /^Assignment and recruiting policies/ }));
  assert.equal(
    screen.getByRole('button', { name: 'Save stage labels' }).closest('details').open,
    false,
  );
  await click(screen.getByText('Pipeline stage labels', { selector: 'strong' }));
  assert.ok(screen.getByRole('button', { name: 'Save stage labels' }));
});

test('profile secondary sections are discoverable and selected sections remain visible after the popover closes', async () => {
  const { SectionTabs } = await load('/src/ProgressiveUI.jsx');
  function Tabs() {
    const [value, setValue] = React.useState('Profile');
    return React.createElement(SectionTabs, {
      items: ['Profile', 'Contacts', 'Documents', 'Notes', 'Privacy'],
      value,
      onChange: setValue,
    });
  }
  await mount(Tabs, {});
  assert.equal(screen.queryByRole('button', { name: 'Privacy' }), null);
  await click(screen.getByRole('button', { name: 'More sections' }));
  await click(screen.getByRole('button', { name: 'Privacy' }));
  assert.equal(
    screen.getByRole('button', { name: 'Privacy' }).getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(screen.queryByRole('region', { name: 'More sections' }) === null, true);
  assert.equal(document.activeElement.textContent, 'Privacy');
  await settle();
});
