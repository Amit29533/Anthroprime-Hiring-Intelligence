import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
let Panel;
test.before(async () => {
  Panel = (await load('/src/SubjectRequests.jsx')).SubjectRequests;
});
afterEach(cleanup);
test.after(stopVite);
const record = {
  id: 'case',
  candidateId: 'candidate',
  anthroId: 'ANTHRO-12345',
  candidateName: 'Candidate',
  kind: 'access',
  status: 'opened',
  summary: 'Email access request',
  version: 1,
  dueDate: null,
  assignee: null,
};
const page = (rows = [record]) => ({
  rows,
  total: rows.length,
  overdue: 0,
  admins: [{ id: 'admin', label: 'admin@example.com' }],
});
test('request intake and identity review reuse operation IDs after lost receipts', async () => {
  const calls = [];
  let saved,
    lostCreate = true,
    lostVerify = true;
  await mount(Panel, {
    isCloud: true,
    candidateId: 'candidate',
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_subject_request_page') return page(saved ? [saved] : []);
      if (name === 'api_subject_request_detail') return { case: saved, events: [], total: 1 };
      if (name === 'api_create_subject_request') {
        saved = { ...record, id: args.p_id, summary: args.p_summary };
        if (lostCreate) {
          lostCreate = false;
          throw new Error('Lost intake receipt');
        }
        return { id: saved.id, version: 1 };
      }
      if (name === 'api_update_subject_request') {
        saved = { ...saved, status: 'verified', version: 2 };
        if (lostVerify) {
          lostVerify = false;
          throw new Error('Lost verification receipt');
        }
        return { id: saved.id, version: 2 };
      }
    },
  });
  await settle();
  fireEvent.change(screen.getByLabelText('Request summary'), {
    target: { value: 'Email request for access review' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Record request case' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Lost intake/);
  fireEvent.click(screen.getByRole('button', { name: 'Record request case' }));
  await settle();
  const creates = calls.filter(([name]) => name === 'api_create_subject_request');
  assert.equal(creates[0][1].p_id, creates[1][1].p_id);
  assert.equal(screen.queryByRole('button', { name: 'Record closure' }), null);
  fireEvent.change(screen.getByLabelText('Review reference or decision'), {
    target: { value: 'Identity verified by existing contact response' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Record identity verification' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Lost verification/);
  fireEvent.click(screen.getByRole('button', { name: 'Record identity verification' }));
  await settle();
  const verifies = calls.filter(([name]) => name === 'api_update_subject_request');
  assert.equal(verifies[0][1].p_operation, verifies[1][1].p_operation);
  assert.equal(verifies[1][1].p_version, 1);
  assert.ok(screen.getByRole('button', { name: 'Start review' }));
});
test('stale cases require refresh and queue/history pages are bounded', async () => {
  const calls = [];
  let stale = false;
  await mount(Panel, {
    isCloud: true,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'api_subject_request_page') return { ...page(), total: 51 };
      if (name === 'api_subject_request_detail')
        return { case: { ...record, version: stale ? 2 : 1 }, events: [], total: 51 };
      stale = true;
      throw new Error('Case changed; refresh before updating');
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Review request case' }));
  await settle();
  fireEvent.change(screen.getByLabelText('Review reference or decision'), {
    target: { value: 'Identity verified by existing contact response' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Record identity verification' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Case changed/);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh request review' }));
  await settle();
  assert.ok(screen.getByText(/version 2 · ANTHRO/));
  fireEvent.click(screen.getByRole('button', { name: 'Next request history' }));
  await settle();
  assert.equal(
    calls.filter(([name]) => name === 'api_subject_request_detail').at(-1)[1].p_offset,
    50,
  );
  fireEvent.change(screen.getByLabelText('Request queue filter'), { target: { value: 'overdue' } });
  await settle();
  assert.equal(
    calls.filter(([name]) => name === 'api_subject_request_page').at(-1)[1].p_filter,
    'overdue',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Next request cases' }));
  await settle();
  assert.equal(
    calls.filter(([name]) => name === 'api_subject_request_page').at(-1)[1].p_offset,
    50,
  );
});
test('missing request migrations stay visible and disable intake', async () => {
  await mount(Panel, {
    isCloud: true,
    candidateId: 'candidate',
    rpc: async () => {
      throw new Error('Request tracking is unavailable');
    },
  });
  await settle();
  assert.match(screen.getByRole('alert').textContent, /unavailable/);
  assert.equal(screen.getByRole('button', { name: 'Record request case' }).disabled, true);
});

test('outbound hold actions retain retry identity and refresh candidate data after confirmation', async () => {
  let active = false,
    version = 3,
    lost = true,
    refreshed = 0;
  const calls = [];
  await mount(Panel, {
    isCloud: true,
    onHoldChange: async () => {
      refreshed++;
    },
    rpc: async (name, args) => {
      if (name === 'api_subject_request_page') return page([{ ...record, kind: 'restriction' }]);
      if (name === 'api_subject_request_detail')
        return {
          case: { ...record, kind: 'restriction', status: 'in_review', version },
          events: [],
          total: 1,
          outboundHold: { active, owned: active },
        };
      calls.push(args);
      active = args.p_enabled;
      version = active ? 4 : 5;
      if (lost) {
        lost = false;
        throw new Error('Lost hold receipt');
      }
      return { id: 'case', version, outboundHold: active };
    },
  });
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Review request case' }));
  await settle();
  fireEvent.change(screen.getByLabelText('Review reference or decision'), {
    target: { value: 'Reviewed outbound restriction reference' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply outbound hold' }));
  await settle();
  assert.match(screen.getByRole('alert').textContent, /Lost hold/);
  fireEvent.click(screen.getByRole('button', { name: 'Apply outbound hold' }));
  await settle();
  assert.equal(calls[0].p_operation, calls[1].p_operation);
  assert.equal(refreshed, 1);
  fireEvent.change(screen.getByLabelText('Review reference or decision'), {
    target: { value: 'Reviewed release decision reference' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Release outbound hold' }));
  await settle();
  assert.equal(calls[2].p_enabled, false);
  assert.equal(refreshed, 2);
});
