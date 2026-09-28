import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  APPROVAL_STATES,
  MATERIAL_TERMS,
  requisitionTerms,
  changedTerms,
  withdrawsApproval,
  approvalsRequired,
  publishBlockedReason,
  availableActions,
  applyDecision,
  pendingApprovals,
  blankDepartment,
  validateDepartment,
  demandsForDepartment,
  unlinkedDepartmentNames,
  applyDepartmentToDemand,
  departmentSummaries,
} from '../src/requisitions.js';
import { normalizeData, emptyData } from '../src/schema.js';

const demand = (over = {}) => ({
  id: 'd1',
  title: 'Data Engineer',
  client: 'Meridian',
  clientId: 'c1',
  departmentId: null,
  positions: 2,
  budget: 42,
  location: 'Bengaluru',
  mode: 'Hybrid',
  engagementType: 'Any',
  minExperience: 7,
  priority: 'High',
  status: 'Open',
  approvalStatus: 'Draft',
  careersVisible: false,
  businessUnit: '',
  ...over,
});

const withSetting = (on) =>
  normalizeData({
    ...emptyData(),
    settings: [{ id: 'workspace', custom: { requisitionApprovals: on } }],
  });

test('the material terms match the database snapshot exactly', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/022_requisitions_departments.sql', import.meta.url),
    'utf8',
  );
  const body = sql.slice(
    sql.indexOf('function public.demand_requisition_terms'),
    sql.indexOf('create or replace function public.demands_requisition_gate'),
  );
  const inSql = [...body.matchAll(/'([A-Za-z]+)',\s*d\./g)].map((m) => m[1]);
  assert.deepEqual(
    inSql,
    MATERIAL_TERMS,
    'src/requisitions.js and migration 022 must agree on what invalidates an approval',
  );
  assert.deepEqual(APPROVAL_STATES, ['Draft', 'Pending approval', 'Approved', 'Rejected']);
  for (const state of APPROVAL_STATES)
    assert.ok(sql.includes(`'${state}'`), `${state} is a status the database accepts`);
});

test('only material changes withdraw an approval', () => {
  const approved = demand({ approvalStatus: 'Approved' });
  assert.deepEqual(changedTerms(approved, approved), []);
  assert.equal(withdrawsApproval(approved, { ...approved, priority: 'Low' }), false);
  assert.equal(withdrawsApproval(approved, { ...approved, status: 'On hold' }), false);
  assert.equal(withdrawsApproval(approved, { ...approved, positions: 5 }), true);
  assert.equal(withdrawsApproval(approved, { ...approved, budget: 50 }), true);
  assert.equal(withdrawsApproval(approved, { ...approved, location: 'Pune' }), true);
  assert.deepEqual(changedTerms(approved, { ...approved, positions: 5, budget: 50 }), [
    'positions',
    'budget',
  ]);
  assert.equal(
    withdrawsApproval(demand({ approvalStatus: 'Draft' }), demand({ positions: 9 })),
    false,
    'a draft has no approval to withdraw',
  );
  assert.deepEqual(requisitionTerms(approved).positions, 2);
  assert.deepEqual(changedTerms(null, approved), [], 'a missing side is not a change');
});

test('the publish gate is off until the workspace opts in', () => {
  const off = withSetting(false);
  const on = withSetting(true);
  assert.equal(approvalsRequired(off), false);
  assert.equal(approvalsRequired(on), true);
  assert.equal(approvalsRequired(normalizeData(emptyData())), false, 'unset means off');

  assert.equal(publishBlockedReason(demand(), off), '', 'nothing is blocked while the gate is off');
  assert.match(publishBlockedReason(demand(), on), /requires requisition approval/);
  assert.equal(publishBlockedReason(demand({ approvalStatus: 'Approved' }), on), '');
  assert.match(publishBlockedReason(demand({ approvalStatus: 'Rejected' }), on), /requires/);
});

test('available actions depend on the state and on who is asking', () => {
  const both = { isAdmin: true, canEdit: true };
  const rec = { isAdmin: false, canEdit: true };
  assert.deepEqual(availableActions(demand({ approvalStatus: 'Draft' }), rec), ['request']);
  assert.deepEqual(availableActions(demand({ approvalStatus: 'Rejected' }), rec), ['request']);
  assert.deepEqual(availableActions(demand({ approvalStatus: 'Pending approval' }), both), [
    'approve',
    'reject',
  ]);
  assert.deepEqual(
    availableActions(demand({ approvalStatus: 'Pending approval' }), rec),
    ['withdraw'],
    'a recruiter can retract their own request but never decide it',
  );
  assert.deepEqual(availableActions(demand({ approvalStatus: 'Approved' }), both), ['revoke']);
  assert.deepEqual(
    availableActions(demand({ approvalStatus: 'Approved' }), rec),
    [],
    'a recruiter cannot undo an approval',
  );
  assert.deepEqual(
    availableActions(demand(), { isAdmin: true, canEdit: false }),
    [],
    'a viewer gets no actions at all',
  );
});

test('a decision produces the same shape the database trigger will write', () => {
  const d = demand();
  const requested = applyDecision(d, 'request', { note: 'Signed SOW attached' });
  assert.equal(requested.approvalStatus, 'Pending approval');
  assert.equal(requested.approvalNote, 'Signed SOW attached');
  assert.ok(requested.submittedForApprovalAt, 'the submission moment is stamped');

  const approved = applyDecision(requested, 'approve', { actor: 'amit@x.example' });
  assert.equal(approved.approvalStatus, 'Approved');
  assert.equal(approved.approvedBy, 'amit@x.example');
  assert.deepEqual(approved.approvedTerms, requisitionTerms(d), 'the terms are snapshotted');

  const rejected = applyDecision(requested, 'reject', { note: 'No budget' });
  assert.equal(rejected.approvalStatus, 'Rejected');
  assert.equal(rejected.approvedAt, null, 'a rejection is not a stamp');
  assert.equal(rejected.approvalNote, 'No budget');

  const revoked = applyDecision({ ...approved, careersVisible: true }, 'revoke');
  assert.equal(revoked.approvalStatus, 'Draft');
  assert.equal(revoked.approvedBy, '');
  assert.equal(revoked.approvedTerms, null);
  assert.equal(revoked.careersVisible, false, 'revoking also pulls the role off the careers page');

  assert.equal(applyDecision(requested, 'withdraw').approvalStatus, 'Draft');
  assert.equal(applyDecision(d, 'nonsense').approvalStatus, 'Draft', 'an unknown action is inert');
});

test('the approval queue is oldest-first so nobody is left waiting', () => {
  const data = normalizeData({
    ...emptyData(),
    demands: [
      demand({ id: 'a', approvalStatus: 'Pending approval', submittedForApprovalAt: '2026-03-05' }),
      demand({ id: 'b', approvalStatus: 'Approved' }),
      demand({ id: 'c', approvalStatus: 'Pending approval', submittedForApprovalAt: '2026-03-01' }),
      demand({ id: 'd', approvalStatus: 'Draft' }),
    ],
  });
  assert.deepEqual(
    pendingApprovals(data).map((d) => d.id),
    ['c', 'a'],
  );
  assert.deepEqual(pendingApprovals(normalizeData(emptyData())), []);
});

test('department validation mirrors the unique index', () => {
  const list = [{ id: 'x1', name: 'Data Platform' }];
  assert.deepEqual(validateDepartment({ ...blankDepartment(), name: 'Risk' }, list), {});
  assert.match(validateDepartment({ ...blankDepartment(), name: ' ' }, list).name, /needs a name/);
  assert.match(
    validateDepartment({ ...blankDepartment(), name: '  data PLATFORM ' }, list).name,
    /already exists/,
  );
  assert.deepEqual(
    validateDepartment({ ...blankDepartment(), name: 'Data Platform' }, list, 'x1'),
    {},
    'renaming a department does not clash with itself',
  );
});

test('departments roll up demands by link and by legacy business-unit name', () => {
  const data = normalizeData({
    ...emptyData(),
    departments: [
      { id: 'x1', name: 'Data Platform' },
      { id: 'x2', name: 'Risk' },
    ],
    demands: [
      demand({ id: 'd1', departmentId: 'x1', status: 'Open', positions: 2 }),
      demand({ id: 'd2', departmentId: null, businessUnit: 'data platform', status: 'Closed' }),
      demand({
        id: 'd3',
        departmentId: null,
        businessUnit: 'Treasury',
        status: 'Open',
        positions: 3,
        approvalStatus: 'Pending approval',
      }),
    ],
  });
  assert.deepEqual(
    demandsForDepartment(data, data.departments[0]).map((d) => d.id),
    ['d1', 'd2'],
    'a pre-migration business-unit name still rolls up',
  );
  assert.deepEqual(
    demandsForDepartment(data, data.departments[1]).map((d) => d.id),
    [],
  );
  assert.deepEqual(demandsForDepartment(data, null), []);
  assert.deepEqual(
    unlinkedDepartmentNames(data).map((u) => u.name),
    ['Treasury'],
    'only genuinely unknown business units are offered for adoption',
  );

  const summaries = departmentSummaries(data);
  assert.equal(summaries[0].department.name, 'Data Platform');
  assert.equal(summaries[0].counts.demands, 2);
  assert.equal(summaries[0].counts.open, 1);
  assert.equal(summaries[0].counts.positions, 2);
  assert.equal(summaries[1].counts.demands, 0, 'an empty department still appears');
});

test('linking a demand keeps the business-unit text in step', () => {
  const linked = applyDepartmentToDemand(demand(), { id: 'x1', name: 'Data Platform' });
  assert.equal(linked.departmentId, 'x1');
  assert.equal(linked.businessUnit, 'Data Platform');
  assert.equal(applyDepartmentToDemand(demand(), null).departmentId, null);
});
