// Requisition approval and departments — Zoho Recruit B2/B3, blueprint §4.2.
//
// The rules here mirror the database triggers in migration 022 exactly. The database is the
// boundary; this module exists so the UI can explain a decision before making the round trip,
// and so the approval state can be summarised without re-querying.

export const APPROVAL_STATES = ['Draft', 'Pending approval', 'Approved', 'Rejected'];

export const APPROVAL_TONE = {
  Draft: 'gray',
  'Pending approval': 'amber',
  Approved: 'green',
  Rejected: 'red',
};

/**
 * The material terms of a requisition: headcount, money, seniority and where the work happens.
 * Must stay in step with `public.demand_requisition_terms` in migration 022 — there is a test
 * that fails if the two lists drift apart.
 */
export const MATERIAL_TERMS = [
  'title',
  'client',
  'clientId',
  'departmentId',
  'positions',
  'budget',
  'location',
  'mode',
  'engagementType',
  'minExperience',
];

export const requisitionTerms = (demand) =>
  Object.fromEntries(MATERIAL_TERMS.map((k) => [k, demand?.[k] ?? null]));

/** Which material terms differ between two versions of a requisition. */
export function changedTerms(before, after) {
  if (!before || !after) return [];
  const a = requisitionTerms(before);
  const b = requisitionTerms(after);
  return MATERIAL_TERMS.filter((k) => String(a[k] ?? '') !== String(b[k] ?? ''));
}

/** True when saving `after` would cause the database to withdraw an existing approval. */
export const withdrawsApproval = (before, after) =>
  before?.approvalStatus === 'Approved' && changedTerms(before, after).length > 0;

export const approvalsRequired = (data) =>
  !!data?.settings?.find((s) => s.id === 'workspace')?.custom?.requisitionApprovals;

/**
 * Can this role be published to the public careers page? Returns a reason when it cannot, so the
 * form can disable the checkbox and say why rather than letting the database raise.
 */
export function publishBlockedReason(demand, data) {
  if (!approvalsRequired(data)) return '';
  if (demand?.approvalStatus === 'Approved') return '';
  return 'This workspace requires requisition approval before a role can be published.';
}

/** What the current user may do next with this requisition. */
export function availableActions(demand, { isAdmin, canEdit }) {
  if (!demand || !canEdit) return [];
  const status = demand.approvalStatus || 'Draft';
  const actions = [];
  if (status === 'Draft' || status === 'Rejected') actions.push('request');
  if (status === 'Pending approval' && isAdmin) actions.push('approve', 'reject');
  if (status === 'Pending approval' && !isAdmin) actions.push('withdraw');
  if (status === 'Approved' && isAdmin) actions.push('revoke');
  return actions;
}

/** Apply a decision locally in the same shape the trigger will produce, for an optimistic save. */
export function applyDecision(demand, action, { note = '', actor = '' } = {}) {
  const base = { ...demand, approvalNote: note };
  if (action === 'request')
    return {
      ...base,
      approvalStatus: 'Pending approval',
      submittedForApprovalAt: new Date().toISOString(),
    };
  if (action === 'withdraw') return { ...base, approvalStatus: 'Draft' };
  if (action === 'reject')
    return { ...base, approvalStatus: 'Rejected', approvedAt: null, approvedTerms: null };
  if (action === 'revoke')
    return {
      ...base,
      approvalStatus: 'Draft',
      approvedAt: null,
      approvedBy: '',
      approvedTerms: null,
      careersVisible: false,
    };
  if (action === 'approve')
    return {
      ...base,
      approvalStatus: 'Approved',
      // The server overwrites these; setting them keeps the optimistic UI honest in the meantime.
      approvedAt: new Date().toISOString(),
      approvedBy: actor || 'Admin',
      approvedTerms: requisitionTerms(demand),
    };
  return base;
}

/** Requisitions waiting on an admin, oldest first — the approver's queue. */
export const pendingApprovals = (data) =>
  (data?.demands || [])
    .filter((d) => d.approvalStatus === 'Pending approval')
    .sort((a, b) =>
      String(a.submittedForApprovalAt || '').localeCompare(String(b.submittedForApprovalAt || '')),
    );

// ---------------------------------------------------------------------------- departments

export const blankDepartment = () => ({
  name: '',
  head: '',
  costCentre: '',
  notes: '',
});

export function validateDepartment(form, departments = [], id = null) {
  const errors = {};
  const name = String(form.name || '').trim();
  if (!name) errors.name = 'A department needs a name.';
  else if (
    departments.some(
      (d) =>
        d.id !== id &&
        String(d.name || '')
          .trim()
          .toLowerCase() === name.toLowerCase(),
    )
  )
    errors.name = 'A department with that name already exists.';
  return errors;
}

export const departmentName = (data, id) =>
  (data?.departments || []).find((d) => d.id === id)?.name || '';

/** Demands belonging to a department, by link or — for pre-migration rows — by business-unit name. */
export function demandsForDepartment(data, department) {
  if (!department) return [];
  const name = String(department.name || '')
    .trim()
    .toLowerCase();
  return (data?.demands || []).filter(
    (d) =>
      d.departmentId === department.id ||
      (!d.departmentId &&
        String(d.businessUnit || '')
          .trim()
          .toLowerCase() === name &&
        name),
  );
}

/** Business-unit names in use that have no department record yet. */
export function unlinkedDepartmentNames(data) {
  const known = new Set(
    (data?.departments || []).map((d) =>
      String(d.name || '')
        .trim()
        .toLowerCase(),
    ),
  );
  const counts = new Map();
  for (const d of data?.demands || []) {
    const name = String(d.businessUnit || '').trim();
    if (!name || d.departmentId || known.has(name.toLowerCase())) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Keep the free-text business unit in step with the link, as clients.js does for accounts. */
export function applyDepartmentToDemand(demand, department) {
  if (!department) return { ...demand, departmentId: null };
  return { ...demand, departmentId: department.id, businessUnit: department.name };
}

export function departmentSummaries(data) {
  return (data?.departments || [])
    .map((department) => {
      const demands = demandsForDepartment(data, department);
      const open = demands.filter((d) => d.status === 'Open');
      return {
        department,
        counts: {
          demands: demands.length,
          open: open.length,
          positions: open.reduce((n, d) => n + (Number(d.positions) || 0), 0),
          pending: demands.filter((d) => d.approvalStatus === 'Pending approval').length,
        },
      };
    })
    .sort(
      (a, b) => b.counts.open - a.counts.open || a.department.name.localeCompare(b.department.name),
    );
}
