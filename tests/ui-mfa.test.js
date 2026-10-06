import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/MfaPanel.jsx')).MfaPanel;
});
afterEach(cleanup);
test.after(stopVite);
test('authenticator verification clears enrollment secret and enables policy controls after provider AAL2', async () => {
  let level = 'aal1',
    enabled = false,
    verified = false;
  const calls = [];
  const ok = (data) => ({ data, error: null });
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (args) enabled = args.p_enabled;
      return ok({ enabled });
    },
    auth: {
      mfa: {
        listFactors: async () =>
          ok({ totp: verified ? [{ id: 'factor', friendly_name: 'Device' }] : [] }),
        getAuthenticatorAssuranceLevel: async () => ok({ currentLevel: level }),
        enroll: async () => ok({ id: 'factor', totp: { qr_code: '<svg></svg>' } }),
        challenge: async (args) => {
          calls.push(['challenge', args]);
          return ok({ id: 'challenge' });
        },
        verify: async (args) => {
          calls.push(['verify', args]);
          verified = true;
          level = 'aal2';
          return ok({});
        },
      },
    },
  };
  await mount(Panel, { isCloud: true, isAdmin: true, client });
  await settle();
  assert.equal(screen.getByRole('button', { name: 'Require administrator MFA' }).disabled, true);
  fireEvent.click(screen.getByRole('button', { name: 'Add authenticator' }));
  await settle();
  assert.ok(screen.getByAltText('Authenticator enrollment QR code'));
  fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify authenticator' }));
  await settle();
  assert.equal(screen.queryByAltText('Authenticator enrollment QR code'), null);
  assert.equal(screen.getByLabelText('Authenticator code').value, '');
  assert.deepEqual(calls.find(([name]) => name === 'verify')[1], {
    factorId: 'factor',
    challengeId: 'challenge',
    code: '123456',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Require administrator MFA' }));
  await settle();
  assert.equal(
    screen.getByRole('button', { name: 'Remove selected authenticator' }).disabled,
    true,
  );
  assert.match(screen.getByRole('status').textContent, /enabled/);
});

test('a failed provider challenge leaves the session unverified and policy controls disabled', async () => {
  let verified = false;
  const ok = (data) => ({ data, error: null });
  const client = {
    rpc: async () => ok({ enabled: false }),
    auth: {
      mfa: {
        listFactors: async () => ok({ totp: [{ id: 'factor' }] }),
        getAuthenticatorAssuranceLevel: async () => ok({ currentLevel: 'aal1' }),
        challenge: async () => ({ error: new Error('provider unavailable') }),
        verify: async () => {
          verified = true;
          return ok({});
        },
      },
    },
  };
  await mount(Panel, { isCloud: true, isAdmin: true, client });
  await settle();
  fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify authenticator' }));
  await settle();
  assert.equal(verified, false);
  assert.match(screen.getByRole('alert').textContent, /failed/);
  assert.equal(screen.getByRole('button', { name: 'Require administrator MFA' }).disabled, true);
});
