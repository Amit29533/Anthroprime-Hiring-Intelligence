import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/LinkedinImport.jsx')).LinkedinImport;
});
afterEach(cleanup);
test.after(stopVite);
test('pasted LinkedIn profiles require contact/review and save through normal candidate persistence with stable retry identity', async () => {
  const saves = [];
  const data = { candidates: [] };
  let closed = false;
  await mount(Panel, {
    data,
    isCloud: false,
    onSave: async (table, rows) => {
      saves.push([table, rows]);
      // A refreshed repository can expose a committed save whose response was lost.
      if (saves.length === 1) data.candidates.push(rows[0]);
      return saves.length > 1;
    },
    onImported: () => {
      closed = true;
    },
  });
  fireEvent.change(screen.getByLabelText('LinkedIn profile URL or ID'), {
    target: { value: 'priya-sharma' },
  });
  fireEvent.change(screen.getByLabelText('LinkedIn profile text'), {
    target: { value: 'Priya Sharma\nSoftware Engineer\nPython' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Extract pasted LinkedIn profile' }));
  await settle();
  assert.equal(
    screen.getByRole('button', { name: 'Save reviewed LinkedIn candidate' }).disabled,
    true,
  );
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed LinkedIn candidate' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /email address or phone/);
  assert.equal(saves.length, 0);
  fireEvent.change(screen.getByLabelText('LinkedIn draft email'), {
    target: { value: 'priya@example.com' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed LinkedIn candidate' }));
  await settle();
  assert.equal(closed, false);
  assert.equal(saves[0][0], 'candidates');
  assert.equal(saves[0][1][0].linkedin, 'https://www.linkedin.com/in/priya-sharma');
  assert.equal(saves[0][1][0].current, null);
  assert.equal(saves[0][1][0].source, 'LinkedIn import');
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed LinkedIn candidate' }));
  await settle();
  assert.equal(saves[0][1][0].id, saves[1][1][0].id);
  assert.equal(closed, true);
});
test('duplicate canonical LinkedIn profiles are refused before provider lookup', async () => {
  let lookups = 0;
  await mount(Panel, {
    data: {
      candidates: [
        { id: 'id', name: 'Existing', linkedin: 'https://linkedin.com/in/priya-sharma/?trk=old' },
      ],
    },
    isCloud: true,
    request: async ({ action }) => {
      if (action === 'status') return { configured: true, enabled: true };
      lookups++;
      return {};
    },
    onSave: async () => true,
  });
  await settle();
  fireEvent.change(screen.getByLabelText('LinkedIn profile URL or ID'), {
    target: { value: 'priya-sharma' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Look up LinkedIn ID' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Already in your repository/);
  assert.equal(lookups, 0);
});
