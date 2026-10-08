import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { React, load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Console, SignIn, start;
test.before(async () => {
  Console = (await load('/src/EnterpriseOperations.jsx')).default;
  const m = await load('/src/EnterpriseSignIn.jsx');
  SignIn = m.default;
  start = m.startEnterpriseSignIn;
});
afterEach(cleanup);
test.after(stopVite);
const ctx = { actor: 'admin', policies: [], defaultHead: 'empty', paused: false };
const fixture = async (n, p) =>
  p.p_action === 'context'
    ? ctx
    : p.p_action === 'dashboard'
      ? { notice: 'Recorded outcomes only' }
      : { rows: [], more: false };
test('enterprise operation hides in local and nonadministrator contexts', async () => {
  for (const p of [
    { isCloud: false, role: 'admin' },
    { isCloud: true, role: 'recruiter' },
    { isCloud: true, role: 'viewer' },
  ]) {
    await mount(Console, { ...p, rpc: fixture });
    assert.equal(screen.queryByText('Enterprise operation and fulfillment'), null);
    cleanup();
  }
});
test('Strict Mode supports verified-case preview and prepares only its exact frozen scope', async () => {
  const calls = [];
  const Strict = (p) =>
    React.createElement(React.StrictMode, null, React.createElement(Console, p));
  await mount(Strict, {
    isCloud: true,
    role: 'admin',
    rpc: async (n, p) => {
      calls.push(p);
      if (p.p_action === 'preview')
        return {
          head: 'scope',
          processingHold: false,
          documentHolds: [],
          inventory: { counts: [] },
        };
      return fixture(n, p);
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Enterprise case UUID'), {
    target: { value: 'verified-case' },
  });
  fireEvent.click(screen.getByText('Preview current retention scope'));
  await settle();
  fireEvent.click(screen.getByText('Prepare exact fulfillment plan'));
  await settle();
  const p = calls.find((p) => p.p_action === 'prepare');
  assert.equal(p.p_head, 'scope');
  assert.deepEqual(p.p_payload, { case: 'verified-case' });
  assert.match(p.p_operation, /^[a-f0-9-]{36}$/);
});
test('ambiguous offboarding acknowledgments freeze controls and retry the identical operation', async () => {
  const calls = [];
  await mount(Console, {
    isCloud: true,
    role: 'admin',
    rpc: async (n, p) => {
      if (n === 'api_enterprise_member_head') return 'member-head';
      if (p.p_action === 'offboard') {
        calls.push(p);
        if (calls.length === 1) throw Error('Lost receipt');
        return { status: 'Access revoked' };
      }
      return fixture(n, p);
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Enterprise user UUID'), { target: { value: 'member' } });
  fireEvent.change(screen.getByLabelText('Enterprise member reason'), {
    target: { value: 'Independent current workspace offboarding review' },
  });
  fireEvent.click(screen.getByText('Review current membership'));
  await settle();
  fireEvent.click(screen.getByText('Offboard reviewed workspace member'));
  await settle();
  assert.equal(screen.getByLabelText('Enterprise user UUID').closest('fieldset').disabled, true);
  fireEvent.click(screen.getByText('Retry exact enterprise operation'));
  await settle();
  assert.deepEqual(calls[0], calls[1]);
  assert.ok(screen.getByText('Access revoked'));
});
test('approved plan UI reports human limitations instead of presenting deletion execution', async () => {
  const plan = {
    id: 'plan',
    status: 'Approved',
    candidate_id: 'candidate',
    generation: 1,
    actor: 'other',
    source: { inventory: { counts: [{ category: 'candidates', count: 1 }] } },
  };
  await mount(Console, {
    isCloud: true,
    role: 'admin',
    rpc: async (n, p) =>
      p.p_action === 'browse'
        ? { rows: [plan], more: false }
        : p.p_action === 'detail'
          ? {
              plan,
              head: 'head',
              rows: [
                {
                  id: 'decision',
                  area: 'backups',
                  outcome: 'retained',
                  evidence: 'Offline recovery copies remain retained',
                },
              ],
              more: false,
            }
          : fixture(n, p),
  });
  await settle();
  fireEvent.click(screen.getByText('Approved · plan'));
  await settle();
  assert.ok(screen.getByText('Finish reconciliation with limitations'));
  assert.ok(screen.getByText(/Offline recovery copies/));
  assert.equal(screen.queryByText('Execute deletion'), null);
});
test('SSO calls native provider UUID flow, uses current origin and rejects insecure redirects', async () => {
  const provider = '79000000-0000-4000-8000-000000000501';
  let captured, url;
  await start(provider, {
    origin: 'https://fixture.invalid',
    client: async () => ({
      auth: {
        signInWithSSO: async (p) => {
          captured = p;
          return { data: { url: 'https://idp.invalid/auth' } };
        },
      },
    }),
    redirect: (u) => {
      url = u;
    },
  });
  assert.deepEqual(captured, {
    providerId: provider,
    options: { redirectTo: 'https://fixture.invalid', skipBrowserRedirect: true },
  });
  assert.equal(url, 'https://idp.invalid/auth');
  await assert.rejects(
    start('company.example', {
      client: async () => {
        throw Error('Must not call');
      },
      origin: 'https://fixture.invalid',
    }),
    /provider UUID/,
  );
  await assert.rejects(
    start(provider, {
      client: async () => ({
        auth: { signInWithSSO: async () => ({ data: { url: 'http://idp.invalid' } }) },
      }),
      origin: 'https://fixture.invalid',
    }),
    /Secure SSO/,
  );
  await assert.rejects(
    start(provider, {
      client: async () => ({ auth: { signInWithSSO: async () => ({ data: {} }) } }),
      origin: 'https://fixture.invalid',
    }),
    /Secure SSO/,
  );
});
test('SSO failure stays actionable and button never submits the password form', async () => {
  await mount(SignIn, {
    start: async () => {
      throw Error('Configured provider requires acceptance');
    },
  });
  fireEvent.change(screen.getByLabelText('SSO provider UUID'), { target: { value: 'provider' } });
  const b = screen.getByText('Continue with enterprise SSO');
  assert.equal(b.type, 'button');
  fireEvent.click(b);
  await settle();
  assert.ok(screen.getByRole('alert'));
  assert.equal(b.disabled, false);
});

test('SSO preserves the client portal route without returning query tokens or external destinations', async () => {
  for (const [path, expected] of [
    ['/client.html', 'https://fixture.invalid/client.html'],
    ['//outside.invalid', 'https://fixture.invalid'],
    ['/portal.html', 'https://fixture.invalid'],
  ]) {
    let captured;
    await start(' 79000000-0000-4000-8000-000000000501 ', {
      origin: 'https://fixture.invalid',
      path,
      client: async () => ({
        auth: {
          signInWithSSO: async (p) => {
            captured = p;
            return { data: { url: 'https://idp.invalid/auth' } };
          },
        },
      }),
      redirect: () => {},
    });
    assert.equal(captured.options.redirectTo, expected);
    assert.equal(captured.providerId, '79000000-0000-4000-8000-000000000501');
  }
});

test('Enter in the SSO field starts SSO once and cancels password-form submission', async () => {
  let calls = 0;
  await mount(SignIn, {
    start: async (provider) => {
      assert.equal(provider, '79000000-0000-4000-8000-000000000501');
      calls++;
    },
  });
  const input = screen.getByLabelText('SSO provider UUID');
  assert.ok(input.maxLength > 38, 'pasted whitespace must not truncate the 36-character UUID');
  fireEvent.change(input, { target: { value: ' 79000000-0000-4000-8000-000000000501 ' } });
  assert.equal(fireEvent.keyDown(input, { key: 'Enter' }), false);
  await settle();
  assert.equal(calls, 1);
});

test('administrators can read retained approval evidence and offboarding limitations', async () => {
  const plan = { id: 'plan', status: 'Approved', source: { inventory: { counts: [] } } };
  await mount(Console, {
    isCloud: true,
    role: 'admin',
    rpc: async (n, p) => {
      if (p.p_action === 'browse') return { rows: [plan] };
      if (p.p_action === 'detail')
        return {
          plan,
          rows: [],
          approval: {
            actor: 'independent-admin',
            at: '2026-10-08',
            evidence: 'Independent evidence reference 102',
          },
        };
      if (p.p_action === 'access-history')
        return {
          rows: [
            {
              id: 'receipt',
              action: 'offboard-report',
              body: {
                user: 'former-member',
                idp: 'reported_revoked',
                sessions: 'unresolved',
                downloads: 'retained',
              },
              result: { status: 'Human report' },
            },
          ],
        };
      return fixture(n, p);
    },
  });
  await settle();
  assert.ok(screen.getByText(/IdP: reported_revoked.*sessions: unresolved.*downloads: retained/));
  fireEvent.click(screen.getByText('Approved · plan'));
  await settle();
  assert.ok(screen.getByText(/Independent evidence reference 102/));
});
