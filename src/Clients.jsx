import React, { useState } from 'react';
import {
  Plus,
  Building2,
  ArrowLeft,
  Pencil,
  MapPin,
  Globe,
  UserRound,
  Star,
  Link2,
  Mail,
  Phone,
  BriefcaseBusiness,
  CheckCircle2,
} from 'lucide-react';
import {
  PageHeader,
  Button,
  Field,
  Modal,
  Badge,
  SearchBox,
  Empty,
  PanelHeading,
  Stat,
} from './ui.jsx';
import { uid, today } from './domain.js';
import { canWriteForRole, getRole } from './repository.js';
import {
  CLIENT_STATUSES,
  CLIENT_TIERS,
  blankClient,
  blankContact,
  validateClient,
  validateContact,
  clientSummaries,
  clientPortfolio,
  clientRollup,
  contactsFor,
  unlinkedDemandNames,
  linkDemandsByName,
} from './clients.js';

const statusTone = { Active: 'green', Prospect: 'blue', 'On hold': 'amber', Dormant: 'gray' };
const decisionTone = { Hired: 'green', Shortlisted: 'blue', Rejected: 'red' };

export function ClientForm({ client, data, onClose, onSave, onCreated, busy }) {
  const [form, setForm] = useState(client || blankClient());
  const [errors, setErrors] = useState({});
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const editing = Boolean(client);

  async function submit(e) {
    e.preventDefault();
    const found = validateClient(form, data.clients, client?.id || null);
    setErrors(found);
    if (Object.keys(found).length) return;
    const row = {
      ...form,
      name: form.name.trim(),
      id: client?.id || uid(),
      created: client?.created || today(),
      tags: Array.isArray(form.tags) ? form.tags : [],
    };
    if (!(await onSave('clients', [row]))) return;
    // Adopt demands that already name this client in free text, so a new account record starts
    // with its real history instead of an empty page.
    if (!editing) {
      const adopt = linkDemandsByName(data, row);
      if (adopt.length) await onSave('demands', adopt);
    }
    onClose();
    if (!editing) onCreated?.(row.id);
  }

  return (
    <Modal
      title={editing ? `Edit ${client.name}` : 'New client'}
      subtitle="Accounts group every demand, submission and placement for one customer."
      onClose={onClose}
      wide
    >
      <form className="modal-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Client name" wide hint={errors.name}>
            <input value={form.name} onChange={set('name')} required aria-invalid={!!errors.name} />
          </Field>
          <Field label="Industry">
            <input
              value={form.industry}
              onChange={set('industry')}
              placeholder="Banking, Energy…"
            />
          </Field>
          <Field label="Location">
            <input value={form.location} onChange={set('location')} placeholder="Mumbai" />
          </Field>
          <Field label="Website" hint={errors.website}>
            <input
              value={form.website}
              onChange={set('website')}
              placeholder="https://example.com"
              aria-invalid={!!errors.website}
            />
          </Field>
          <Field label="Account owner">
            <input value={form.owner} onChange={set('owner')} placeholder="Amit Singh" />
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={set('status')}>
              {CLIENT_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Tier">
            <select value={form.tier} onChange={set('tier')}>
              {CLIENT_TIERS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Payment terms" hint="Recorded for reference only — no invoicing here.">
            <input value={form.paymentTerms} onChange={set('paymentTerms')} placeholder="Net 30" />
          </Field>
          <Field label="Account notes" wide>
            <textarea rows={3} value={form.notes} onChange={set('notes')} />
          </Field>
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {editing ? 'Save client' : 'Create client'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ContactForm({ contact, clientId, data, onClose, onSave, busy }) {
  const [form, setForm] = useState(contact || blankContact(clientId));
  const [errors, setErrors] = useState({});
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const check = (key) => (e) => setForm({ ...form, [key]: e.target.checked });

  async function submit(e) {
    e.preventDefault();
    const found = validateContact(form, data.clientContacts, contact?.id || null);
    setErrors(found);
    if (Object.keys(found).length) return;
    const row = {
      ...form,
      name: form.name.trim(),
      email: form.email.trim(),
      id: contact?.id || uid(),
      created: contact?.created || today(),
    };
    const rows = [row];
    // The database allows one primary per client; demote the incumbent in the same write so the
    // unique index never rejects the recruiter's edit.
    if (row.isPrimary)
      for (const other of contactsFor(data, row.clientId))
        if (other.id !== row.id && other.isPrimary) rows.push({ ...other, isPrimary: false });
    if (!(await onSave('clientContacts', rows))) return;
    onClose();
  }

  return (
    <Modal
      title={contact ? `Edit ${contact.name}` : 'New contact'}
      subtitle="Client-side people you submit candidates to and collect feedback from."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Contact name" wide hint={errors.name}>
            <input value={form.name} onChange={set('name')} required aria-invalid={!!errors.name} />
          </Field>
          <Field label="Job title">
            <input value={form.title} onChange={set('title')} placeholder="Head of Data" />
          </Field>
          <Field label="Email" hint={errors.email}>
            <input
              type="email"
              value={form.email}
              onChange={set('email')}
              aria-invalid={!!errors.email}
            />
          </Field>
          <Field label="Phone">
            <input value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Notes" wide>
            <textarea rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
        </div>
        <div className="client-checkboxes">
          <label className="checkbox-label">
            <input type="checkbox" checked={!!form.isPrimary} onChange={check('isPrimary')} />
            Primary contact for this client
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={!!form.decisionMaker}
              onChange={check('decisionMaker')}
            />
            Hiring decision maker
          </label>
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {contact ? 'Save contact' : 'Add contact'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function Clients({ data, onNew, onOpen, onSave, busy }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('All');
  const [sort, setSort] = useState('activity');
  const rows = clientSummaries(data, { query, status, sort });
  const totals = clientPortfolio(data);
  const unlinked = unlinkedDemandNames(data);
  const canWrite = canWriteForRole(getRole());

  async function adopt(name) {
    const row = { ...blankClient(), name, id: uid(), created: today() };
    if (!(await onSave('clients', [row]))) return;
    const demands = linkDemandsByName(data, row);
    if (demands.length) await onSave('demands', demands);
  }

  return (
    <>
      <PageHeader
        eyebrow="CLIENTS"
        title="Client accounts"
        description="Every demand, submission, interview and placement rolled up by customer."
      >
        {canWrite && (
          <Button icon={Plus} onClick={onNew}>
            New client
          </Button>
        )}
      </PageHeader>

      <div className="stats-grid">
        <Stat
          label="Accounts"
          value={totals.clients}
          detail={`${totals.active} active`}
          icon={Building2}
        />
        <Stat
          label="Open demands"
          value={totals.openDemands}
          detail={`${totals.openPositions} positions`}
          icon={BriefcaseBusiness}
          tone="blue"
        />
        <Stat
          label="Placements"
          value={totals.placements}
          detail="Deployed to date"
          icon={CheckCircle2}
          tone="green"
        />
        <Stat
          label="Unlinked demands"
          value={totals.unlinked}
          detail={totals.unlinked ? 'Client names without an account' : 'All demands linked'}
          icon={Link2}
          tone={totals.unlinked ? 'amber' : 'teal'}
        />
      </div>

      {unlinked.length > 0 && canWrite && (
        <section className="panel">
          <PanelHeading
            title="Client names without an account record"
            subtitle="These demands carry a free-text client name. Create the account to roll up their history."
          />
          <div className="client-chip-row">
            {unlinked.slice(0, 8).map((u) => (
              <button
                key={u.name}
                className="chip-button"
                onClick={() => adopt(u.name)}
                disabled={busy}
              >
                <Plus size={14} /> {u.name} <b>{u.count}</b>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="table-toolbar">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="Search clients, contacts, owners…"
          />
          <select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option>All</option>
            {CLIENT_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select aria-label="Sort clients" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="activity">Recent activity</option>
            <option value="name">Name</option>
            <option value="open">Open demands</option>
            <option value="placements">Placements</option>
          </select>
        </div>
        {rows.length === 0 ? (
          <Empty
            title="No client accounts match"
            text="Create an account for each customer to group demands, contacts and placements."
            action={
              canWrite ? (
                <Button icon={Plus} onClick={onNew}>
                  New client
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Open demands</th>
                  <th>Submissions</th>
                  <th>Placements</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.client.id}>
                    <td>
                      <button className="person" onClick={() => onOpen(r.client.id)}>
                        <span className="avatar small color-1">
                          <Building2 size={15} />
                        </span>
                        <span>
                          <strong>{r.client.name}</strong>
                          <small>
                            {[r.client.industry, r.client.location].filter(Boolean).join(' · ') ||
                              'No industry recorded'}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td>
                      <Badge tone={statusTone[r.client.status]}>{r.client.status}</Badge>
                    </td>
                    <td>
                      {r.counts.openDemands}
                      {r.counts.openPositions > 0 && <small> · {r.counts.openPositions} pos</small>}
                    </td>
                    <td>{r.counts.submissions}</td>
                    <td>{r.counts.placements}</td>
                    <td>{r.lastActivity || <small>No activity yet</small>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export function ClientDetail({
  client,
  data,
  onBack,
  onEdit,
  onAddContact,
  onEditContact,
  onOpenDemand,
  onOpenCandidate,
}) {
  const roll = clientRollup(data, client);
  const canWrite = canWriteForRole(getRole());
  const candidateName = (id) =>
    data.candidates.find((c) => c.id === id)?.name || 'Unknown candidate';

  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ArrowLeft size={15} /> All clients
      </button>
      <PageHeader
        eyebrow={client.tier.toUpperCase()}
        title={client.name}
        description={
          [client.industry, client.location].filter(Boolean).join(' · ') || 'Client account'
        }
      >
        <Badge tone={statusTone[client.status]}>{client.status}</Badge>
        {canWrite && (
          <Button icon={Pencil} variant="secondary" onClick={() => onEdit(client)}>
            Edit
          </Button>
        )}
      </PageHeader>

      <div className="stats-grid">
        <Stat
          label="Open demands"
          value={roll.counts.openDemands}
          detail={`${roll.counts.demands} all time`}
          icon={BriefcaseBusiness}
        />
        <Stat
          label="Submissions"
          value={roll.counts.submissions}
          detail={
            roll.submissionToInterview === null
              ? 'No submissions yet'
              : `${roll.submissionToInterview}% reached interview`
          }
          icon={UserRound}
          tone="blue"
        />
        <Stat
          label="Offers"
          value={roll.counts.offers}
          detail={
            roll.offerAcceptance === null ? 'No offers yet' : `${roll.offerAcceptance}% accepted`
          }
          icon={Star}
          tone="amber"
        />
        <Stat
          label="Placements"
          value={roll.counts.placements}
          detail="Deployed"
          icon={CheckCircle2}
          tone="green"
        />
      </div>

      <div className="client-columns">
        <section className="panel">
          <PanelHeading
            title="Contacts"
            subtitle="Client-side people for submissions and feedback."
            action={
              canWrite ? (
                <Button icon={Plus} variant="secondary" onClick={() => onAddContact(client.id)}>
                  Add contact
                </Button>
              ) : null
            }
          />
          {roll.contacts.length === 0 ? (
            <p className="supporting-text">No contacts recorded for this client yet.</p>
          ) : (
            <ul className="client-list">
              {roll.contacts.map((c) => (
                <li key={c.id}>
                  <div>
                    <strong>{c.name}</strong> {c.isPrimary && <Badge tone="green">Primary</Badge>}{' '}
                    {c.decisionMaker && <Badge tone="blue">Decision maker</Badge>}
                    <small>{c.title || 'No title recorded'}</small>
                    <small>
                      {c.email && (
                        <a href={`mailto:${c.email}`}>
                          <Mail size={13} /> {c.email}
                        </a>
                      )}
                      {c.phone && (
                        <span>
                          <Phone size={13} /> {c.phone}
                        </span>
                      )}
                    </small>
                  </div>
                  {canWrite && (
                    <Button variant="secondary" onClick={() => onEditContact(c)}>
                      Edit
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <dl className="client-meta">
            {client.owner && (
              <div>
                <dt>Account owner</dt>
                <dd>{client.owner}</dd>
              </div>
            )}
            {client.website && (
              <div>
                <dt>Website</dt>
                <dd>
                  <a href={client.website} target="_blank" rel="noreferrer noopener">
                    <Globe size={13} /> {client.website}
                  </a>
                </dd>
              </div>
            )}
            {client.paymentTerms && (
              <div>
                <dt>Payment terms</dt>
                <dd>{client.paymentTerms}</dd>
              </div>
            )}
          </dl>
          {client.notes && <p className="supporting-text">{client.notes}</p>}
        </section>

        <section className="panel">
          <PanelHeading title="Demands" subtitle="Roles this client has asked us to fill." />
          {roll.demands.length === 0 ? (
            <p className="supporting-text">No demands linked to this client yet.</p>
          ) : (
            <ul className="client-list">
              {roll.demands.map((d) => (
                <li key={d.id}>
                  <div>
                    <strong>{d.title}</strong>
                    <small>
                      <MapPin size={13} /> {d.location} · {d.positions} position
                      {d.positions === 1 ? '' : 's'} · target {d.target}
                      {!d.clientId && ' · matched by name'}
                    </small>
                  </div>
                  <span className="client-row-actions">
                    <Badge tone={d.status === 'Open' ? 'green' : 'gray'}>{d.status}</Badge>
                    <Button variant="secondary" onClick={() => onOpenDemand(d.id)}>
                      Open
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="panel">
        <PanelHeading
          title="Submission activity"
          subtitle="Candidates sent to this client and the decisions recorded against them."
        />
        {roll.submissions.length === 0 ? (
          <p className="supporting-text">Nothing submitted to this client yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Demand</th>
                  <th>Submitted</th>
                  <th>Client decision</th>
                </tr>
              </thead>
              <tbody>
                {roll.submissions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <button className="text-link" onClick={() => onOpenCandidate(s.candidateId)}>
                        {candidateName(s.candidateId)}
                      </button>
                    </td>
                    <td>{data.demands.find((d) => d.id === s.demandId)?.title || '—'}</td>
                    <td>{s.submittedOn}</td>
                    <td>
                      <Badge tone={decisionTone[s.clientStatus] || 'gray'}>
                        {s.clientStatus || 'Pending'}
                      </Badge>
                      {s.clientComment && <small> {s.clientComment}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
