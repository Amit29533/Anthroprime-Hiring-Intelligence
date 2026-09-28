// Client (account) intelligence — Zoho Recruit's "Clients & Contacts" area and the blueprint's
// §4.2 "Client and business unit" field. Everything here is derived from records that already
// exist: no metric is invented, and a client with no activity reports zeros rather than a guess.
//
// Deliberate boundary: nothing in this module reads `demandCommercials`. Internal cost and margin
// stay admin-only (migration 004), so an account rollup can never become a side channel to them.

export const CLIENT_STATUSES = ['Prospect', 'Active', 'On hold', 'Dormant'];
export const CLIENT_TIERS = ['Strategic', 'Key', 'Standard'];

export const blankClient = () => ({
  name: '',
  industry: '',
  location: '',
  website: '',
  owner: '',
  status: 'Active',
  tier: 'Standard',
  paymentTerms: '',
  notes: '',
  tags: [],
});

export const blankContact = (clientId = null) => ({
  clientId,
  name: '',
  title: '',
  email: '',
  phone: '',
  isPrimary: false,
  decisionMaker: false,
  notes: '',
});

const norm = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

/** Validation mirrors the database constraints so the UI fails before the round trip. */
export function validateClient(form, existing = [], id = null) {
  const errors = {};
  const name = String(form?.name || '').trim();
  if (!name) errors.name = 'Client name is required.';
  else if (existing.some((c) => c && c.id !== id && norm(c.name) === norm(name)))
    errors.name = 'A client with this name already exists in the workspace.';
  if (form?.status && !CLIENT_STATUSES.includes(form.status)) errors.status = 'Unknown status.';
  if (form?.tier && !CLIENT_TIERS.includes(form.tier)) errors.tier = 'Unknown tier.';
  const website = String(form?.website || '').trim();
  if (website && !/^https?:\/\//i.test(website))
    errors.website = 'Website must start with http:// or https://.';
  return errors;
}

export function validateContact(form, existing = [], id = null) {
  const errors = {};
  if (!String(form?.name || '').trim()) errors.name = 'Contact name is required.';
  if (!form?.clientId) errors.clientId = 'Select the client this contact belongs to.';
  const email = String(form?.email || '').trim();
  const phone = String(form?.phone || '').trim();
  // Matches the table's `check (email <> '' or phone <> '')`.
  if (!email && !phone) errors.email = 'Give the contact an email address or a phone number.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    errors.email = 'Enter a valid email address.';
  if (
    email &&
    existing.some(
      (c) => c && c.id !== id && c.clientId === form.clientId && norm(c.email) === norm(email),
    )
  )
    errors.email = 'This client already has a contact with that email address.';
  return errors;
}

/** Contacts belonging to one client, primary first then alphabetical. */
export function contactsFor(data, clientId) {
  return (data?.clientContacts || [])
    .filter((c) => c && c.clientId === clientId)
    .sort((a, b) =>
      a.isPrimary === b.isPrimary
        ? String(a.name).localeCompare(String(b.name))
        : a.isPrimary
          ? -1
          : 1,
    );
}

export const primaryContact = (data, clientId) =>
  contactsFor(data, clientId).find((c) => c.isPrimary) || null;

/**
 * Demands belonging to a client. Rows linked by `clientId` are authoritative; rows that predate
 * batch 16 are matched on the free-text client name so an account's history is not silently
 * truncated by the migration. Name matching never overrides an explicit link to another client.
 */
export function demandsFor(data, client) {
  if (!client) return [];
  return (data?.demands || []).filter(
    (d) => d && (d.clientId === client.id || (!d.clientId && norm(d.client) === norm(client.name))),
  );
}

/** Demands with no account record yet — the migration backlog a recruiter should clear. */
export function unlinkedDemandNames(data) {
  const known = new Set((data?.clients || []).map((c) => norm(c.name)));
  const names = new Map();
  for (const d of data?.demands || []) {
    const name = String(d?.client || '').trim();
    if (!name || d.clientId || known.has(norm(name))) continue;
    names.set(norm(name), { name, count: (names.get(norm(name))?.count || 0) + 1 });
  }
  return [...names.values()].sort((a, b) => b.count - a.count);
}

/**
 * The account rollup. Every number is a count of real rows, so an empty client reads as zeros
 * rather than as a fabricated conversion rate — the same honesty rule the analytics module follows.
 */
export function clientRollup(data, client) {
  const demands = demandsFor(data, client);
  const demandIds = new Set(demands.map((d) => d.id));
  const submissions = (data?.submissions || []).filter((s) => s && demandIds.has(s.demandId));
  const interviews = (data?.interviews || []).filter((i) => i && demandIds.has(i.demandId));
  const offers = (data?.offers || []).filter((o) => o && demandIds.has(o.demandId));
  const considerations = (data?.considerations || []).filter((c) => c && demandIds.has(c.demandId));
  const placements = considerations.filter((c) => c.stage === 'Deployed');
  const openDemands = demands.filter((d) => d.status === 'Open');
  const positions = openDemands.reduce((sum, d) => sum + (Number(d.positions) || 0), 0);
  const accepted = offers.filter((o) => o.status === 'Accepted');

  return {
    client,
    demands,
    openDemands,
    submissions,
    interviews,
    offers,
    placements,
    contacts: contactsFor(data, client.id),
    counts: {
      demands: demands.length,
      openDemands: openDemands.length,
      openPositions: positions,
      submissions: submissions.length,
      interviews: interviews.length,
      offers: offers.length,
      accepted: accepted.length,
      placements: placements.length,
      contacts: contactsFor(data, client.id).length,
    },
    // Percentages are reported only where a denominator actually exists.
    submissionToInterview: submissions.length
      ? Math.round((interviews.length / submissions.length) * 100)
      : null,
    offerAcceptance: offers.length ? Math.round((accepted.length / offers.length) * 100) : null,
    lastActivity: lastActivityDate({ demands, submissions, interviews, offers }),
  };
}

function lastActivityDate({ demands, submissions, interviews, offers }) {
  const dates = [
    ...demands.map((d) => d.created),
    ...submissions.map((s) => s.submittedOn),
    ...interviews.map((i) => (i.scheduledAt || '').slice(0, 10)),
    ...offers.map((o) => o.sentDate || (o.created || '').slice(0, 10)),
  ].filter(Boolean);
  return dates.length ? dates.sort().at(-1) : null;
}

/** Ranked account list for the Clients screen. */
export function clientSummaries(data, { query = '', status = 'All', sort = 'activity' } = {}) {
  const q = norm(query);
  let rows = (data?.clients || []).map((client) => clientRollup(data, client));
  if (status !== 'All') rows = rows.filter((r) => r.client.status === status);
  if (q)
    rows = rows.filter((r) =>
      [
        r.client.name,
        r.client.industry,
        r.client.location,
        r.client.owner,
        ...(r.client.tags || []),
      ]
        .concat(r.contacts.map((c) => `${c.name} ${c.email}`))
        .some((field) => norm(field).includes(q)),
    );
  const by = {
    activity: (a, b) => String(b.lastActivity || '').localeCompare(String(a.lastActivity || '')),
    name: (a, b) => String(a.client.name).localeCompare(String(b.client.name)),
    open: (a, b) => b.counts.openDemands - a.counts.openDemands,
    placements: (a, b) => b.counts.placements - a.counts.placements,
  };
  return rows.sort(by[sort] || by.activity);
}

/** Workspace-level totals for the Clients page header. */
export function clientPortfolio(data) {
  const rows = (data?.clients || []).map((c) => clientRollup(data, c));
  return {
    clients: rows.length,
    active: rows.filter((r) => r.client.status === 'Active').length,
    openDemands: rows.reduce((s, r) => s + r.counts.openDemands, 0),
    openPositions: rows.reduce((s, r) => s + r.counts.openPositions, 0),
    placements: rows.reduce((s, r) => s + r.counts.placements, 0),
    unlinked: unlinkedDemandNames(data).length,
  };
}

/**
 * Applying a client to a demand keeps the free-text name in step with the linked record, so the
 * careers portal and every existing screen that reads `demand.client` stay correct.
 */
export function applyClientToDemand(demand, client) {
  if (!client) return { ...demand, clientId: null };
  return { ...demand, clientId: client.id, client: client.name };
}

/** Back-fill: link every demand whose free-text name matches this client. */
export function linkDemandsByName(data, client) {
  return (data?.demands || [])
    .filter((d) => d && !d.clientId && norm(d.client) === norm(client.name))
    .map((d) => ({ ...d, clientId: client.id, client: client.name }));
}

export const contactLabel = (contact) =>
  contact ? `${contact.name}${contact.title ? ` · ${contact.title}` : ''}` : '';
