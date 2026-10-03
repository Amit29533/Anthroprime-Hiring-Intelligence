import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  load,
  loadApp,
  mount,
  cleanup,
  stopVite,
  settle,
  screen,
  fireEvent,
  click,
  createHarness,
} from './ui-harness.js';
import { navTo, press, type, choose, submitVia } from './ui-drivers.js';
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
test('admin configures client fields and saves typed values, then archives without losing them', async () => {
  const seed = makeSeed();
  const initialSettings = structuredClone(seed.settings[0].custom);
  localStorage.setItem('ecod-demo-v1', JSON.stringify(seed));
  await mount(M.App);
  await settle(6);
  await press('Workspace settings');
  await settle(6);
  await choose('Field module', 'clients');
  await type('New field name', 'Account region');
  await choose('Field type', 'select');
  await type('Choices', 'East\nWest');
  await submitVia('Add custom field');
  await settle(4);
  const original = store().settings[0].custom;
  assert.ok(original.customFields.candidates.length, 'existing definitions are preserved');
  const withoutFields = (custom) =>
    Object.fromEntries(Object.entries(custom).filter(([key]) => key !== 'customFields'));
  assert.deepEqual(
    withoutFields(original),
    withoutFields(initialSettings),
    'unrelated settings are retained',
  );
  await type('New field name', 'Seats');
  await choose('Field type', 'number');
  await submitVia('Add custom field');
  await settle(3);
  await navTo('Clients');
  await press('New client');
  await type('Client name', 'Custom Fields Test');
  await choose('Account region', 'West');
  await type('Seats', '12.5');
  await submitVia('Create client');
  await settle(4);
  assert.deepEqual(store().clients.find((row) => row.name === 'Custom Fields Test').custom, {
    'Account region': 'West',
    Seats: 12.5,
  });
  assert.ok(screen.getByText('12.5'));
  await press('Workspace settings');
  await settle(6);
  await choose('Field module', 'clients');
  await click(screen.getByRole('button', { name: 'Archive field Account region' }));
  await settle(3);
  assert.equal(store().settings[0].custom.customFields.clients[0].archived, true);
  assert.equal(
    store().clients.find((row) => row.name === 'Custom Fields Test').custom['Account region'],
    'West',
  );
  await click(screen.getByRole('button', { name: 'Restore field Account region' }));
  await settle(3);
  assert.equal(store().settings[0].custom.customFields.clients[0].archived, false);
});
test('contact editing retains custom values and clearing a numeric input saves an empty value', async () => {
  const data = makeSeed();
  data.settings[0].custom.customFields.clientContacts = [{ name: 'Office code', type: 'number' }];
  const contact = { ...data.clientContacts[0], custom: { 'Office code': 42 } };
  const h = createHarness(data);
  await mount(M.ContactForm, {
    contact,
    clientId: contact.clientId,
    data,
    onSave: h.save,
    onClose: () => {},
    busy: false,
  });
  assert.equal(screen.getByLabelText('Office code').value, '42');
  await type('Office code', '');
  await submitVia('Save contact');
  await settle(2);
  assert.equal(h.state.writes[0].rows[0].custom['Office code'], '');
});
test('new selects stay empty until chosen and field failures remain visible', async () => {
  const { CustomFieldsPanel } = await load('/src/CustomFields.jsx');
  const data = makeSeed();
  await mount(CustomFieldsPanel, { data, onSave: async () => false });
  await type('New field name', 'Custom test');
  await submitVia('Add custom field');
  await settle(2);
  assert.match(screen.getByRole('alert').textContent, /could not be saved/);
  assert.equal(screen.getByLabelText('New field name').value, 'Custom test');
  cleanup();
  data.settings[0].custom.customFields.clients = [
    { name: 'Region', type: 'select', options: ['East', 'West'] },
  ];
  await mount(M.ClientForm, { data, onSave: async () => false, onClose: () => {} });
  assert.equal(screen.getByLabelText('Region').value, '');
  fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'East' } });
  assert.equal(screen.getByLabelText('Region').value, 'East');
});
