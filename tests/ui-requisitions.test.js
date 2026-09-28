// Requisition approval and departments, driven through the real components. The approval gate is
// opt-in, so most of these tests turn it on first — which is itself the behaviour being checked:
// a workspace that does not run an approval process must see none of this.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, mount, screen, cleanup, stopVite, settle, createHarness } from './ui-harness.js';
import { navTo, press, type, submitVia, allText } from './ui-drivers.js';
import { makeSeed } from '../src/seed.js';
import { normalizeData } from '../src/schema.js';

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

/** A workspace with the approval gate on or off. */
function workspace({ approvals = true, demandOver = {} } = {}) {
  const data = normalizeData(makeSeed());
  data.settings = [
    {
      id: 'workspace',
      custom: { requisitionApprovals: approvals },
      updated: new Date().toISOString(),
    },
  ];
  data.demands = data.demands.map((d, i) => (i === 0 ? { ...d, ...demandOver } : d));
  return data;
}

async function approvalPanel(options, props = {}) {
  const data = workspace(options);
  const harness = createHarness(data);
  await mount(M.ApprovalPanel, {
    demand: data.demands[0],
    data,
    onSave: harness.save,
    notify: (m) => harness.state.toasts.push(m),
    audit: harness.audit,
    busy: false,
    ...props,
  });
  await settle(3);
  return { data, harness };
}

test('the approval panel is hidden until the workspace opts in', async () => {
  await approvalPanel({ approvals: false });
  assert.equal(
    screen.queryByText('Requisition approval'),
    null,
    'a team with no approval process never sees the workflow',
  );
  cleanup();
});

test('a draft requisition can be sent for approval', async () => {
  const { harness } = await approvalPanel({ demandOver: { approvalStatus: 'Draft' } });
  assert.ok(screen.getByText('Requisition approval'), 'the panel is shown once the gate is on');
  assert.ok(screen.getByText('Draft'), 'the state is badged');
  assert.ok(
    allText(/cannot be published to the careers page/i).length,
    'the consequence is stated',
  );
  await press('Request approval');
  const write = harness.state.writes.find((w) => w.table === 'demands');
  assert.ok(write, 'the requisition was saved');
  assert.equal(write.rows[0].approvalStatus, 'Pending approval');
  assert.ok(write.rows[0].submittedForApprovalAt, 'the submission moment is stamped');
  assert.ok(
    harness.state.audits.some((a) => a.action === 'requisition request'),
    'the request is audited',
  );
  cleanup();
});

test('an administrator can approve a pending requisition', async () => {
  const { harness } = await approvalPanel({
    demandOver: { approvalStatus: 'Pending approval', submittedForApprovalAt: '2026-09-20' },
  });
  assert.ok(allText(/Waiting for an administrator since 2026-09-20/).length);
  await press('Approve');
  const write = harness.state.writes.find((w) => w.table === 'demands');
  assert.equal(write.rows[0].approvalStatus, 'Approved');
  assert.ok(write.rows[0].approvedTerms, 'the reviewed terms are snapshotted');
  assert.ok(harness.state.toasts.some((t) => /can now be published/i.test(t)));
  cleanup();
});

test('a recruiter can withdraw a request but cannot decide it', async () => {
  const { harness } = await approvalPanel(
    { demandOver: { approvalStatus: 'Pending approval' } },
    { role: 'recruiter' },
  );
  assert.equal(screen.queryByText('Approve'), null, 'no approve button for a recruiter');
  assert.equal(screen.queryByText('Reject'), null, 'no reject button either');
  assert.ok(allText(/Only an administrator can approve or reject/i).length, 'and it says why');
  await press('Withdraw request');
  assert.equal(
    harness.state.writes.find((w) => w.table === 'demands').rows[0].approvalStatus,
    'Draft',
  );
  cleanup();
});

test('a viewer gets no requisition actions at all', async () => {
  await approvalPanel({ demandOver: { approvalStatus: 'Pending approval' } }, { role: 'viewer' });
  assert.equal(screen.queryByText('Approve'), null);
  assert.equal(screen.queryByText('Withdraw request'), null);
  assert.ok(allText(/Viewers cannot change a requisition/i).length);
  cleanup();
});

test('rejecting asks for a reason before it is recorded', async () => {
  const { harness } = await approvalPanel({
    demandOver: { approvalStatus: 'Pending approval' },
  });
  await press('Reject');
  // First click only opens the reason box — nothing is saved yet.
  assert.equal(harness.state.writes.length, 0, 'a rejection is not recorded without a reason');
  assert.ok(screen.getByLabelText(/Reason for rejection/i), 'the reason field appeared');
  await type('Reason for rejection', 'Headcount not funded this quarter');
  await press('Confirm');
  const write = harness.state.writes.find((w) => w.table === 'demands');
  assert.equal(write.rows[0].approvalStatus, 'Rejected');
  assert.equal(write.rows[0].approvalNote, 'Headcount not funded this quarter');
  cleanup();
});

test('an approved requisition shows who signed it off and can be revoked', async () => {
  const { harness } = await approvalPanel({
    demandOver: {
      approvalStatus: 'Approved',
      approvedBy: 'amit@anthroprime.example',
      approvedAt: '2026-09-21T10:00:00Z',
      careersVisible: true,
    },
  });
  assert.ok(screen.getByText('amit@anthroprime.example'), 'the approver is named');
  assert.ok(allText(/on 2026-09-21/).length, 'with the date');
  assert.ok(allText(/withdraws this approval/i).length, 'the invalidation rule is explained');
  await press('Revoke approval');
  await type('Why is this being revoked?', 'Budget pulled');
  await press('Confirm');
  const row = harness.state.writes.find((w) => w.table === 'demands').rows[0];
  assert.equal(row.approvalStatus, 'Draft');
  assert.equal(row.careersVisible, false, 'revoking also pulls the role off the careers page');
  cleanup();
});

test('the demand form blocks publishing until the requisition is approved', async () => {
  const data = workspace({ demandOver: { approvalStatus: 'Draft' } });
  const harness = createHarness(data);
  await mount(M.DemandForm, {
    demand: data.demands[0],
    data,
    onClose: harness.noop,
    onSave: harness.save,
    onCreated: harness.noop,
    busy: false,
  });
  await settle(2);
  const checkbox = [...document.querySelectorAll('input[type=checkbox]')].find((c) =>
    c.closest('label')?.textContent.includes('Publish this role'),
  );
  assert.ok(checkbox, 'the publish control is on screen');
  assert.equal(checkbox.disabled, true, 'it is disabled while the requisition is unapproved');
  assert.ok(
    allText(/requires requisition approval before a role can be published/i).length,
    'and the form says why rather than letting the database raise',
  );
  cleanup();
});

test('the demand form warns when an edit would withdraw an approval', async () => {
  const data = workspace({
    demandOver: { approvalStatus: 'Approved', approvedBy: 'amit@x.example' },
  });
  const harness = createHarness(data);
  await mount(M.DemandForm, {
    demand: data.demands[0],
    data,
    onClose: harness.noop,
    onSave: harness.save,
    onCreated: harness.noop,
    busy: false,
  });
  await settle(2);
  assert.equal(
    allText(/withdraws the approval/i).length,
    0,
    'no warning before anything has changed',
  );
  await type('Open positions', '9');
  await settle(2);
  assert.ok(allText(/This change withdraws the approval/i).length, 'the warning appears');
  assert.ok(allText(/positions/).length, 'and names the term that caused it');

  // A cosmetic change does not trigger it.
  cleanup();
});

test('the departments panel lists rollups and can adopt a loose business unit', async () => {
  const data = workspace({ approvals: false });
  data.demands = [
    ...data.demands,
    { ...data.demands[0], id: 'd-loose', departmentId: null, businessUnit: 'Treasury Tech' },
  ];
  const harness = createHarness(data);
  await mount(M.DepartmentsPanel, {
    data,
    onSave: harness.save,
    onNew: () => {},
    onEdit: () => {},
    notify: (m) => harness.state.toasts.push(m),
    busy: false,
  });
  await settle(2);
  assert.ok(screen.getByText('Data & AI'), 'seeded departments are listed');
  assert.ok(screen.getByText('Digital Engineering'));
  assert.ok(allText(/Business units without a department record/i).length);

  const chip = [...document.querySelectorAll('.chip-button')].find((b) =>
    b.textContent.includes('Treasury Tech'),
  );
  assert.ok(chip, 'the loose business unit is offered for adoption');
  chip.click();
  await settle(4);
  const created = harness.state.writes
    .find((w) => w.table === 'departments')
    ?.rows.find((r) => r.name === 'Treasury Tech');
  assert.ok(created, 'the department record was created');
  const adopted = harness.state.writes.find((w) => w.table === 'demands')?.rows[0];
  assert.equal(adopted.departmentId, created.id, 'and the loose demand was adopted');
  cleanup();
});

test('only an administrator can switch the approval requirement on', async () => {
  const harness = createHarness(workspace({ approvals: false }));
  await mount(M.DepartmentsPanel, {
    role: 'recruiter',
    data: harness.state.data,
    onSave: harness.save,
    onNew: () => {},
    onEdit: () => {},
    notify: () => {},
    busy: false,
  });
  await settle(2);
  const toggle = [...document.querySelectorAll('input[type=checkbox]')].find((c) =>
    c.closest('label')?.textContent.includes('Require requisition approval'),
  );
  assert.ok(toggle, 'the setting is visible to everyone');
  assert.equal(toggle.disabled, true, 'but only an admin can change it');
  assert.ok(allText(/Only an administrator can change this setting/i).length);
  cleanup();
});

test('a department can be created from the form and is validated', async () => {
  const harness = createHarness(normalizeData(makeSeed()));
  await mount(M.DepartmentForm, {
    data: harness.state.data,
    onClose: harness.noop,
    onSave: harness.save,
    busy: false,
  });
  await type('Department name', '  data & ai ');
  await submitVia('Create department');
  await settle(2);
  assert.ok(allText(/already exists/i).length, 'a duplicate name is refused');
  assert.equal(harness.state.writes.length, 0);

  await type('Department name', 'Treasury Tech');
  await type('Department head', 'Nisha Iyer');
  await type('Cost centre', 'CC-3310');
  await submitVia('Create department');
  await settle(2);
  const row = harness.state.writes.find((w) => w.table === 'departments').rows[0];
  assert.equal(row.name, 'Treasury Tech');
  assert.equal(row.head, 'Nisha Iyer');
  assert.equal(row.costCentre, 'CC-3310');
  cleanup();
});

test('typing a known department name on a demand links the requisition to it', async () => {
  localStorage.removeItem('ecod-demo-v1');
  await mount(M.App, {});
  await settle(6);
  await navTo('Demands');
  await press('Create demand');
  await type('Role title', 'Streaming Engineer');
  await type('Client', 'Meridian Technologies');
  await type('Business unit', 'Digital Engineering');
  await type('Must-have skills', 'Kafka');
  await type('Target start date', '2026-12-01');
  await submitVia('Create & find matches');
  await settle(4);

  const created = store().demands.find((d) => d.title === 'Streaming Engineer');
  assert.ok(created, 'the demand was saved');
  const dept = store().departments.find((d) => d.name === 'Digital Engineering');
  assert.equal(created.departmentId, dept.id, 'the requisition is linked to the department');
  assert.equal(created.approvalStatus, 'Draft', 'and starts as a draft');
  cleanup();
});

test('an unknown business unit leaves the requisition unlinked rather than inventing a department', async () => {
  const harness = createHarness(normalizeData(makeSeed()));
  await mount(M.DemandForm, {
    data: harness.state.data,
    onClose: harness.noop,
    onSave: harness.save,
    onCreated: harness.noop,
    busy: false,
  });
  await type('Role title', 'Site Reliability Engineer');
  await type('Client', 'Northstar Financial');
  await type('Business unit', 'Somewhere Else');
  await type('Must-have skills', 'Kubernetes');
  await type('Target start date', '2026-12-01');
  await submitVia('Create & find matches');
  await settle(3);
  const row = harness.state.writes.find((w) => w.table === 'demands').rows[0];
  assert.equal(row.businessUnit, 'Somewhere Else', 'the free text is kept');
  assert.equal(row.departmentId, null, 'no department record is silently created');
  cleanup();
});
