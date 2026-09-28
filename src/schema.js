// Shared data shape for demo and cloud modes, kept dependency-free so tests can import it.
import { setCustomTaxonomy } from './taxonomy.js';
import { setStageLabels } from './domain.js';
export const TABLES = [
  'candidates',
  'demands',
  'considerations',
  'assessments',
  'notes',
  'enrichment',
  'history',
  'employmentHistory',
  'compensationHistory',
  'availabilityHistory',
  'auditEvents',
  'documents',
  'taxonomy',
  'demandCommercials',
  'settings',
  'consents',
  'interviews',
  'offers',
  'tasks',
  'submissions',
  'publicApplications',
  'workflowRules',
  'clients',
  'clientContacts',
  'departments',
];
export const emptyData = () => Object.fromEntries(TABLES.map((t) => [t, []]));
// Fill in fields/tables added after a stored (or cloud) snapshot was written, apply the saved
// taxonomy extensions, and hide profiles merged into another record.
export function normalizeData(data) {
  const out = emptyData();
  for (const t of TABLES) out[t] = Array.isArray(data?.[t]) ? data[t] : [];
  out.candidates = out.candidates.filter((c) => !c.mergedInto);
  for (const c of out.candidates) {
    c.skills = c.skills || [];
    c.skillsDetail = Array.isArray(c.skillsDetail) ? c.skillsDetail : [];
    c.engagement = c.engagement || '';
    c.earliestStart = c.earliestStart || null;
    c.activeStatus = c.activeStatus || 'Active';
    c.timezone = c.timezone || '';
    c.preferredLocations = c.preferredLocations || '';
    c.nextAction = c.nextAction || '';
    c.externalId = c.externalId || '';
  }
  for (const d of out.demands) {
    d.niceToHave = d.niceToHave || [];
    d.engagementType = d.engagementType || 'Any';
    d.minProficiency = d.minProficiency || 'Working';
    d.skillMinimums = d.skillMinimums || {};
    d.stageSet = Array.isArray(d.stageSet) ? d.stageSet : [];
    d.tags = Array.isArray(d.tags) ? d.tags : [];
    d.custom = d.custom && typeof d.custom === 'object' && !Array.isArray(d.custom) ? d.custom : {};
    d.owner = d.owner || '';
    d.businessUnit = d.businessUnit || '';
    d.externalId = d.externalId || '';
    d.careersVisible = d.careersVisible === true;
    // Demands created before batch 16 carry only the free-text client name; an unlinked demand
    // stays valid and simply does not roll up into an account record.
    d.clientId = d.clientId || null;
    // Batch 18: a requisition that predates the approval workflow is a draft, and an
    // unlinked demand keeps only its free-text business unit.
    d.departmentId = d.departmentId || null;
    d.approvalStatus = d.approvalStatus || 'Draft';
    d.approvalNote = d.approvalNote || '';
    d.approvedBy = d.approvedBy || '';
    d.approvedAt = d.approvedAt || null;
    d.approvedTerms = d.approvedTerms || null;
    d.submittedForApprovalAt = d.submittedForApprovalAt || null;
  }
  out.departments = out.departments || [];
  for (const d of out.departments) {
    d.name = d.name || '';
    d.head = d.head || '';
    d.costCentre = d.costCentre || '';
    d.notes = d.notes || '';
  }
  out.clients = out.clients || [];
  for (const c of out.clients) {
    c.name = c.name || '';
    c.industry = c.industry || '';
    c.location = c.location || '';
    c.website = c.website || '';
    c.owner = c.owner || '';
    c.status = c.status || 'Active';
    c.tier = c.tier || 'Standard';
    c.paymentTerms = c.paymentTerms || '';
    c.notes = c.notes || '';
    c.tags = Array.isArray(c.tags) ? c.tags : [];
  }
  out.clientContacts = out.clientContacts || [];
  for (const c of out.clientContacts) {
    c.clientId = c.clientId || null;
    c.name = c.name || '';
    c.title = c.title || '';
    c.email = c.email || '';
    c.phone = c.phone || '';
    c.notes = c.notes || '';
    c.isPrimary = c.isPrimary === true;
    c.decisionMaker = c.decisionMaker === true;
  }
  for (const c of out.candidates) {
    c.tags = Array.isArray(c.tags) ? c.tags : [];
    c.custom = c.custom && typeof c.custom === 'object' && !Array.isArray(c.custom) ? c.custom : {};
  }
  out.interviews = out.interviews || [];
  out.offers = out.offers || [];
  for (const o of out.offers) {
    o.status = o.status || 'Draft';
    o.role = o.role || '';
    o.location = o.location || '';
    o.notes = o.notes || '';
    o.ctc = o.ctc == null ? null : Number(o.ctc);
    o.approvedAt = o.approvedAt || null;
    o.approvedBy = o.approvedBy || '';
    o.approvedTerms =
      o.approvedTerms && typeof o.approvedTerms === 'object' ? o.approvedTerms : null;
  }
  out.tasks = out.tasks || [];
  out.workflowRules = out.workflowRules || [];
  for (const r of out.workflowRules) {
    r.name = r.name || '';
    r.triggerTable = r.triggerTable || 'candidates';
    r.triggerField = r.triggerField || 'stage';
    r.op = r.op || 'eq';
    r.value = r.value == null ? '' : String(r.value);
    r.actions = Array.isArray(r.actions) ? r.actions : [];
    r.enabled = r.enabled !== false;
  }
  for (const t of out.tasks) {
    t.title = t.title || '';
    t.done = !!t.done;
    t.due = t.due || '';
    t.owner = t.owner || '';
    t.candidateId = t.candidateId || null;
    t.demandId = t.demandId || null;
  }
  out.submissions = out.submissions || [];
  for (const sub of out.submissions) {
    sub.clientContact = sub.clientContact || '';
    sub.method = sub.method || 'Email';
    sub.notes = sub.notes || '';
    sub.pack = sub.pack && typeof sub.pack === 'object' && !Array.isArray(sub.pack) ? sub.pack : {};
    sub.clientStatus = sub.clientStatus || 'Pending';
    sub.clientComment = sub.clientComment || '';
    sub.decidedOn = sub.decidedOn || null;
    sub.contactId = sub.contactId || null;
  }
  out.publicApplications = out.publicApplications || [];
  for (const a of out.publicApplications) {
    a.name = a.name || '';
    a.email = a.email || '';
    a.phone = a.phone || '';
    a.linkedin = a.linkedin || '';
    a.message = a.message || '';
    a.status = a.status || 'pending';
    a.consentContact = !!a.consentContact;
    a.consentSharing = !!a.consentSharing;
  }
  for (const iv of out.interviews) {
    iv.round = iv.round || 'Round 1';
    iv.mode = iv.mode || 'Video';
    iv.status = iv.status || 'Scheduled';
    iv.interviewers = Array.isArray(iv.interviewers) ? iv.interviewers : [];
    iv.feedback =
      iv.feedback && typeof iv.feedback === 'object' && !Array.isArray(iv.feedback)
        ? iv.feedback
        : {};
    iv.notes = iv.notes || '';
    iv.durationMins = iv.durationMins || 45;
  }
  const tax = out.taxonomy.find((r) => r && r.id === 'workspace');
  setCustomTaxonomy((tax && tax.custom) || {});
  const st = out.settings.find((r) => r && r.id === 'workspace');
  setStageLabels((st && st.custom && st.custom.stageLabels) || {});
  return out;
}
