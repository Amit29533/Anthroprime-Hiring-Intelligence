import React, { useState } from 'react';
import {
  Plus,
  CheckCircle2,
  XCircle,
  Undo2,
  Send,
  ShieldCheck,
  Building,
  Download,
} from 'lucide-react';
import { PanelHeading, Button, Field, Modal, Badge, Empty } from './ui.jsx';
import { uid, today } from './domain.js';
import { canWriteForRole, getRole, getWorkspaceId } from './repository.js';
import { downloadFile } from './Candidates.jsx';
import { publishedRoles, roleUrl, sitemapXml } from './jobPosting.js';
import {
  APPROVAL_TONE,
  approvalsRequired,
  availableActions,
  applyDecision,
  changedTerms,
  blankDepartment,
  validateDepartment,
  departmentSummaries,
  unlinkedDepartmentNames,
  applyDepartmentToDemand,
} from './requisitions.js';

const ACTION_LABEL = {
  request: 'Request approval',
  approve: 'Approve',
  reject: 'Reject',
  withdraw: 'Withdraw request',
  revoke: 'Revoke approval',
};
const ACTION_ICON = {
  request: Send,
  approve: CheckCircle2,
  reject: XCircle,
  withdraw: Undo2,
  revoke: Undo2,
};
const NEEDS_NOTE = new Set(['reject', 'revoke']);

/**
 * The requisition approval strip on a demand. Shown only when the workspace has opted into the
 * approval process, so a team that does not run one never sees it.
 */
export function ApprovalPanel({ demand, data, onSave, notify, audit, busy, role = getRole() }) {
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState('');
  if (!approvalsRequired(data)) return null;

  const isAdmin = role === 'admin';
  const canEdit = canWriteForRole(role);
  const actions = availableActions(demand, { isAdmin, canEdit });
  const status = demand.approvalStatus || 'Draft';

  async function decide(action) {
    if (NEEDS_NOTE.has(action) && !asking) {
      setAsking(action);
      return;
    }
    const row = applyDecision(demand, action, { note: note.trim() });
    if (!(await onSave('demands', [row]))) return;
    audit?.({
      entityType: 'demands',
      entityId: demand.id,
      action: `requisition ${action}`,
      detail: `${demand.title}${note.trim() ? ` — ${note.trim()}` : ''}`,
    });
    notify?.(
      action === 'approve'
        ? 'Requisition approved. The role can now be published.'
        : action === 'reject'
          ? 'Requisition rejected. The recruiter can revise and resubmit.'
          : action === 'request'
            ? 'Sent for approval.'
            : 'Approval withdrawn.',
    );
    setNote('');
    setAsking('');
  }

  return (
    <section className="panel requisition-panel">
      <PanelHeading
        title="Requisition approval"
        subtitle="Headcount, budget, seniority and location are signed off before this role is published."
        action={<Badge tone={APPROVAL_TONE[status]}>{status}</Badge>}
      />
      <div className="settings-body">
        {status === 'Approved' && (
          <p className="supporting-text">
            <ShieldCheck size={13} /> Approved by <strong>{demand.approvedBy || 'an admin'}</strong>
            {demand.approvedAt ? ` on ${String(demand.approvedAt).slice(0, 10)}` : ''}. Changing the
            headcount, budget, seniority, client, department or location withdraws this approval.
          </p>
        )}
        {status === 'Pending approval' && (
          <p className="supporting-text">
            Waiting for an administrator
            {demand.submittedForApprovalAt
              ? ` since ${String(demand.submittedForApprovalAt).slice(0, 10)}`
              : ''}
            .
          </p>
        )}
        {status === 'Rejected' && (
          <p className="supporting-text">
            Rejected. Revise the requisition and request approval again.
          </p>
        )}
        {status === 'Draft' && (
          <p className="supporting-text">
            This requisition has not been approved, so it cannot be published to the careers page.
          </p>
        )}
        {demand.approvalNote && <p className="approval-note">“{demand.approvalNote}”</p>}

        {asking && (
          <Field
            label={asking === 'reject' ? 'Reason for rejection' : 'Why is this being revoked?'}
          >
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
          </Field>
        )}
        {actions.length > 0 && (
          <div className="approval-actions">
            {actions.map((a) => (
              <Button
                key={a}
                icon={ACTION_ICON[a]}
                variant={a === 'approve' ? '' : 'secondary'}
                disabled={busy}
                onClick={() => decide(a)}
              >
                {asking === a ? 'Confirm' : ACTION_LABEL[a]}
              </Button>
            ))}
            {asking && (
              <Button
                variant="ghost"
                onClick={() => {
                  setAsking('');
                  setNote('');
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        )}
        {!canEdit && <p className="supporting-text">Viewers cannot change a requisition.</p>}
        {status === 'Pending approval' && !isAdmin && canEdit && (
          <p className="supporting-text">Only an administrator can approve or reject this.</p>
        )}
      </div>
    </section>
  );
}

/** Warning shown in the demand form when the pending edit would withdraw an existing approval. */
export function ApprovalWarning({ before, after, data }) {
  if (!approvalsRequired(data)) return null;
  if (before?.approvalStatus !== 'Approved') return null;
  const changed = changedTerms(before, after);
  if (!changed.length) return null;
  return (
    <div className="constraint-warning wide">
      <strong>This change withdraws the approval.</strong> {changed.join(', ')}{' '}
      {changed.length === 1 ? 'is a material term' : 'are material terms'}, so saving returns the
      requisition to draft and unpublishes the role. It will need approving again.
    </div>
  );
}

export function DepartmentForm({ department, data, onClose, onSave, busy }) {
  const [form, setForm] = useState(department || blankDepartment());
  const [errors, setErrors] = useState({});
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    const found = validateDepartment(form, data.departments, department?.id || null);
    setErrors(found);
    if (Object.keys(found).length) return;
    const row = {
      ...form,
      name: form.name.trim(),
      id: department?.id || uid(),
      created: department?.created || today(),
    };
    if (!(await onSave('departments', [row]))) return;
    onClose();
  }

  return (
    <Modal
      title={department ? `Edit ${department.name}` : 'New department'}
      subtitle="Reusable business units, so requisitions roll up somewhere meaningful."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Department name" wide hint={errors.name}>
            <input value={form.name} onChange={set('name')} required aria-invalid={!!errors.name} />
          </Field>
          <Field label="Department head">
            <input value={form.head} onChange={set('head')} placeholder="Priya Raman" />
          </Field>
          <Field label="Cost centre">
            <input value={form.costCentre} onChange={set('costCentre')} placeholder="CC-2201" />
          </Field>
          <Field label="Notes" wide>
            <textarea rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {department ? 'Save department' : 'Create department'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Departments and the approval switch, both administered from Workspace settings. */
export function DepartmentsPanel({ data, onSave, onNew, onEdit, notify, busy, role = getRole() }) {
  const rows = departmentSummaries(data);
  const unlinked = unlinkedDepartmentNames(data);
  const isAdmin = role === 'admin';
  const canEdit = canWriteForRole(role);
  const required = approvalsRequired(data);

  async function toggleApprovals(on) {
    const existing = data.settings.find((s) => s.id === 'workspace');
    const row = {
      ...(existing || { id: 'workspace' }),
      custom: { ...(existing?.custom || {}), requisitionApprovals: on },
    };
    if (!(await onSave('settings', [row]))) return;
    notify?.(
      on
        ? 'Requisition approval is now required before a role can be published.'
        : 'Requisition approval is no longer required.',
    );
  }

  async function adopt(name) {
    const row = { ...blankDepartment(), name, id: uid(), created: today() };
    if (!(await onSave('departments', [row]))) return;
    const demands = (data.demands || [])
      .filter(
        (d) =>
          !d.departmentId &&
          String(d.businessUnit || '')
            .trim()
            .toLowerCase() === name.trim().toLowerCase(),
      )
      .map((d) => applyDepartmentToDemand(d, row));
    if (demands.length) await onSave('demands', demands);
  }

  return (
    <section className="panel">
      <PanelHeading
        title="Departments & requisitions"
        subtitle="Business units that requisitions belong to, and whether approval is required."
        action={
          canEdit ? (
            <Button variant="secondary" icon={Plus} onClick={onNew}>
              New department
            </Button>
          ) : null
        }
      />
      <div className="settings-body">
        <label className="careers-publish-label">
          <input
            type="checkbox"
            checked={required}
            disabled={!isAdmin || busy}
            onChange={(e) => toggleApprovals(e.target.checked)}
          />
          Require requisition approval before a role can be published
        </label>
        <p className="careers-publish-hint">
          When this is on, a demand must be approved by an administrator before it can appear on the
          public careers page — and changing the headcount, budget, seniority, client, department or
          location withdraws that approval. The rule is enforced by the database, not only by this
          screen. {!isAdmin && 'Only an administrator can change this setting.'}
        </p>

        {rows.length === 0 ? (
          <Empty
            title="No departments yet"
            text="Create departments to group requisitions by the business unit that asked for them."
          />
        ) : (
          <ul className="client-list">
            {rows.map((r) => (
              <li key={r.department.id}>
                <div>
                  <strong>{r.department.name}</strong>
                  <small>
                    <Building size={13} />
                    {r.department.head || 'No head recorded'}
                    {r.department.costCentre ? ` · ${r.department.costCentre}` : ''} ·{' '}
                    {r.counts.open} open · {r.counts.positions} positions
                    {r.counts.pending > 0 ? ` · ${r.counts.pending} awaiting approval` : ''}
                  </small>
                </div>
                {canEdit && (
                  <Button variant="secondary" onClick={() => onEdit(r.department)}>
                    Edit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {unlinked.length > 0 && canEdit && (
          <>
            <h3 className="member-subheading">Business units without a department record</h3>
            <div className="client-chip-row">
              {unlinked.slice(0, 8).map((u) => (
                <button
                  key={u.name}
                  className="chip-button"
                  disabled={busy}
                  onClick={() => adopt(u.name)}
                >
                  <Plus size={14} /> {u.name} <b>{u.count}</b>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * Careers-page discoverability (Zoho B6). Shows the public URL, what search engines will see,
 * and produces a sitemap for the roles that are actually published right now.
 */
export function CareersSeoPanel({
  data,
  notify,
  download = downloadFile,
  origin,
  workspace = getWorkspaceId(),
}) {
  const roles = publishedRoles(data);
  const base =
    origin || (typeof location === 'undefined' ? 'https://your-site.example' : location.origin);
  const options = { origin: base, path: '/careers.html', workspace };
  const listing = workspace ? `${base}/careers.html?ws=${workspace}` : `${base}/careers.html`;

  return (
    <section className="panel">
      <PanelHeading
        title="Careers page & search visibility"
        subtitle="What job seekers and search engines see when a role is published."
      />
      <div className="settings-body">
        <dl>
          <div>
            <dt>Public careers URL</dt>
            <dd className="seo-url">{listing}</dd>
          </div>
          <div>
            <dt>Roles currently published</dt>
            <dd>{roles.length}</dd>
          </div>
          <div>
            <dt>Structured data</dt>
            <dd>schema.org JobPosting per role</dd>
          </div>
        </dl>
        {roles.length === 0 ? (
          <p className="supporting-text">
            No roles are published yet. Tick{' '}
            <strong>Publish this role on the public careers page</strong> on a demand to list it.
          </p>
        ) : (
          <ul className="client-list">
            {roles.slice(0, 6).map((r) => (
              <li key={r.id}>
                <div>
                  <strong>{r.title}</strong>
                  <small>{roleUrl(r, options)}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="approval-actions">
          <Button
            variant="secondary"
            icon={Download}
            disabled={!roles.length}
            onClick={() => {
              download(sitemapXml(roles, options), 'sitemap.xml', 'application/xml;charset=utf-8');
              notify?.(`Sitemap generated for ${roles.length} published role(s).`);
            }}
          >
            Download sitemap.xml
          </Button>
        </div>
        <p className="careers-publish-hint">
          Each role has its own address, and the page publishes schema.org JobPosting markup so it
          is eligible for a Google Jobs result. That markup is added by JavaScript: Google does
          render it, but server-rendered or prerendered pages are indexed faster and more reliably.
          Upload the sitemap to your host and submit it in Google Search Console — nothing here
          submits it for you.
        </p>
      </div>
    </section>
  );
}
