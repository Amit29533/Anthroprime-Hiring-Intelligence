import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/LinkedinImport.jsx')).LinkedinImport;
});
afterEach(cleanup);
test.after(stopVite);

test('quick extraction copies a profile-bound command and clipboard import requires review without automatic saving', async () => {
  const copied = [],
    saves = [];
  const payload = JSON.stringify({
    url: 'https://www.linkedin.com/in/mira-testcandidate/',
    name: 'Mira Testcandidate',
    headline: 'Developer',
  });
  await mount(Panel, {
    data: { candidates: [] },
    isCloud: false,
    canImport: true,
    readClipboard: async () => payload,
    writeClipboard: async (value) => copied.push(value),
    onSave: async (_, rows) => {
      saves.push(rows);
      return true;
    },
  });
  fireEvent.change(screen.getByLabelText('LinkedIn profile URL or ID'), {
    target: { value: 'mira-testcandidate' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Copy extraction command' }));
  await settle();
  assert.equal(copied.length, 1);
  assert.match(copied[0], /https:\/\/www.linkedin.com\/in\/mira-testcandidate\//);
  assert.equal(screen.getByLabelText('LinkedIn extraction command').value, copied[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Paste extracted profile' }));
  await settle();
  assert.equal(screen.getByLabelText('LinkedIn draft name').value, 'Mira Testcandidate');
  assert.equal(
    screen.getByRole('button', { name: 'Save reviewed LinkedIn candidate' }).disabled,
    true,
  );
  assert.equal(saves.length, 0);
});

test('clipboard denial or wrong-profile data clears stale drafts and viewer cannot copy or import', async () => {
  let content = JSON.stringify({
    url: 'https://www.linkedin.com/in/mira-testcandidate',
    name: 'Mira',
  });
  await mount(Panel, {
    data: { candidates: [] },
    isCloud: false,
    canImport: true,
    readClipboard: async () => {
      if (content instanceof Error) throw content;
      return content;
    },
    onSave: async () => assert.fail('No save expected'),
  });
  fireEvent.click(screen.getByRole('button', { name: 'Paste extracted profile' }));
  await settle();
  assert.ok(screen.getByLabelText('LinkedIn draft name'));
  content = JSON.stringify({ url: 'https://www.linkedin.com/in/another-person', name: 'Other' });
  fireEvent.click(screen.getByRole('button', { name: 'Paste extracted profile' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /different/);
  assert.equal(screen.queryByLabelText('LinkedIn draft name'), null);
  content = new Error('Clipboard permission denied');
  fireEvent.click(screen.getByRole('button', { name: 'Paste extracted profile' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /permission denied/);
  cleanup();
  await mount(Panel, {
    data: { candidates: [] },
    isCloud: false,
    canImport: false,
    onSave: async () => assert.fail('No save'),
  });
  assert.equal(screen.getByRole('button', { name: 'Copy extraction command' }).disabled, true);
  assert.equal(screen.getByRole('button', { name: 'Paste extracted profile' }).disabled, true);
});
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
test('local JSON import needs evidence/contact review, saves bounded claims and resets confirmation after edits', async () => {
  const saves = [];
  await mount(Panel, {
    data: { candidates: [] },
    isCloud: false,
    canImport: true,
    onSave: async (table, rows) => {
      saves.push(rows[0]);
      return true;
    },
  });
  const exported = {
    url: 'https://www.linkedin.com/in/mira-testcandidate/',
    name: 'Mira Testcandidate',
    headline: 'Developer',
    company: 'Example Labs',
    about: 'Fictional summary',
    experience: [['Developer', 'Example Labs', '2022–2026']],
    skills: [['React']],
    warnings: ['Additional entries collapsed'],
  };
  fireEvent.change(screen.getByLabelText('LinkedIn JSON export'), {
    target: {
      files: [{ name: 'profile.json', size: 800, text: async () => JSON.stringify(exported) }],
    },
  });
  await settle();
  assert.equal(screen.getByLabelText('LinkedIn draft company').value, 'Example Labs');
  assert.match(screen.getByLabelText('LinkedIn extraction warnings').textContent, /collapsed/);
  assert.equal(
    screen.getByRole('button', { name: 'Save reviewed LinkedIn candidate' }).disabled,
    true,
  );
  fireEvent.change(screen.getByLabelText('LinkedIn draft email'), {
    target: { value: 'mira@example.invalid' },
  });
  fireEvent.click(screen.getByText(/Structured LinkedIn evidence/));
  for (const box of screen.getAllByRole('checkbox', { name: /LinkedIn confirm evidence/ }))
    fireEvent.click(box);
  fireEvent.click(screen.getByLabelText('Confirm LinkedIn profile review'));
  fireEvent.change(screen.getByLabelText('LinkedIn draft summary'), {
    target: { value: 'Reviewed fictional summary' },
  });
  assert.equal(screen.getByLabelText('Confirm LinkedIn profile review').checked, false);
  fireEvent.click(screen.getByLabelText('Confirm LinkedIn profile review'));
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed LinkedIn candidate' }));
  await settle();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].summary, 'Reviewed fictional summary');
  assert.ok(saves[0].cvEvidence.items.every((item) => item.reviewed));
  assert.equal(saves[0].custom.linkedinImport.provider, 'Local LinkedIn export');
  assert.equal(saves[0].experience, null);
});
test('wrong-profile or failed replacement file clears stale draft and duplicate local files cannot be saved', async () => {
  await mount(Panel, {
    data: { candidates: [] },
    isCloud: false,
    canImport: true,
    onSave: async () => assert.fail('No save expected'),
  });
  const choose = (data) =>
    fireEvent.change(screen.getByLabelText('LinkedIn JSON export'), {
      target: {
        files: [{ name: 'profile.json', size: 100, text: async () => JSON.stringify(data) }],
      },
    });
  choose({ url: 'https://linkedin.com/in/mira-testcandidate', name: 'Mira' });
  await settle();
  assert.ok(screen.getByLabelText('LinkedIn draft name'));
  choose({ url: 'https://linkedin.com/in/another-person', name: 'Other' });
  await settle();
  assert.match(screen.getByRole('alert').textContent, /different/);
  assert.equal(screen.queryByLabelText('LinkedIn draft name'), null);
  cleanup();
  await mount(Panel, {
    data: {
      candidates: [
        {
          id: 'existing',
          name: 'Existing Mira',
          linkedin: 'https://www.linkedin.com/in/mira-testcandidate',
        },
      ],
    },
    isCloud: false,
    canImport: true,
    onSave: async () => assert.fail('No save expected'),
  });
  choose({ url: 'https://linkedin.com/in/mira-testcandidate', name: 'Mira' });
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Already in your repository/);
});
test('viewer cannot import local exports or pasted profiles', async () => {
  await mount(Panel, {
    data: { candidates: [] },
    isCloud: false,
    canImport: false,
    onSave: async () => assert.fail('Viewer cannot save'),
  });
  assert.equal(screen.getByLabelText('LinkedIn JSON export').disabled, true);
  assert.equal(
    screen.getByRole('button', { name: 'Extract pasted LinkedIn profile' }).disabled,
    true,
  );
});

test('test-account session lookup is a separate, disclosed option and still requires review before saving', async () => {
  const requests = [];
  await mount(Panel, {
    data: { candidates: [] },
    isCloud: true,
    isAdmin: false,
    onSave: async () => true,
    request: async (body) => {
      requests.push(body);
      if (body.action === 'status')
        return { enabled: true, configured: false, sessionWorker: true };
      return {
        provider: 'LinkedIn test-account session',
        lookedUpAt: new Date().toISOString(),
        draft: {
          name: 'Priya Sharma',
          email: '',
          phone: '',
          title: 'Engineer',
          company: 'Example',
          location: 'Pune',
          skills: ['Python'],
          linkedin: 'https://www.linkedin.com/in/priya-sharma',
          summary: '',
        },
      };
    },
  });
  await settle();
  assert.match(document.body.textContent, /not a LinkedIn-approved integration/);
  fireEvent.change(screen.getByLabelText('LinkedIn profile URL or ID'), {
    target: { value: '123456789' },
  });
  assert.equal(
    screen.getByRole('button', { name: 'Look up with LinkedIn test-account session' }).disabled,
    true,
  );
  fireEvent.change(screen.getByLabelText('LinkedIn profile URL or ID'), {
    target: { value: 'priya-sharma' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Look up with LinkedIn test-account session' }),
  );
  await settle();
  assert.equal(requests.at(-1).action, 'session-lookup');
  assert.equal(
    screen.getByRole('button', { name: 'Save reviewed LinkedIn candidate' }).disabled,
    true,
  );
});
