// Per-table defaults, separate from workspace activation and persistence.
const normalizers = {
  candidates: (row) => {
    row.skills = row.skills || [];
    row.skillsDetail = Array.isArray(row.skillsDetail) ? row.skillsDetail : [];
    row.engagement = row.engagement || '';
    row.earliestStart = row.earliestStart || null;
    row.activeStatus = row.activeStatus || 'Active';
    row.timezone = row.timezone || '';
    row.preferredLocations = row.preferredLocations || '';
    row.nextAction = row.nextAction || '';
    row.externalId = row.externalId || '';

    row.tags = Array.isArray(row.tags) ? row.tags : [];
    row.custom =
      row.custom && typeof row.custom === 'object' && !Array.isArray(row.custom) ? row.custom : {};
  },
  demands: (row) => {
    row.niceToHave = row.niceToHave || [];
    row.engagementType = row.engagementType || 'Any';
    row.minProficiency = row.minProficiency || 'Working';
    row.skillMinimums = row.skillMinimums || {};
    row.stageSet = Array.isArray(row.stageSet) ? row.stageSet : [];
    row.tags = Array.isArray(row.tags) ? row.tags : [];
    row.custom =
      row.custom && typeof row.custom === 'object' && !Array.isArray(row.custom) ? row.custom : {};
    row.owner = row.owner || '';
    row.businessUnit = row.businessUnit || '';
    row.externalId = row.externalId || '';
    row.careersVisible = row.careersVisible === true;
    // Demands created before batch 16 carry only the free-text client name; an unlinked demand
    // stays valid and simply does not roll up into an account record.
    row.clientId = row.clientId || null;
    // Batch 18: a requisition that predates the approval workflow is a draft, and an
    // unlinked demand keeps only its free-text business unit.
    row.departmentId = row.departmentId || null;
    row.approvalStatus = row.approvalStatus || 'Draft';
    row.approvalNote = row.approvalNote || '';
    row.approvedBy = row.approvedBy || '';
    row.approvedAt = row.approvedAt || null;
    row.approvedTerms = row.approvedTerms || null;
    row.submittedForApprovalAt = row.submittedForApprovalAt || null;
  },
  assignmentRules: (row) => {
    row.name = row.name || '';
    row.entity = row.entity || 'candidates';
    row.field = row.field || 'source';
    row.op = row.op || 'eq';
    row.value = row.value || '';
    row.assignTo = row.assignTo || '';
    row.priority = Number(row.priority) || 100;
    row.enabled = row.enabled !== false;
  },
  placements: (row) => {
    row.clientId = row.clientId || null;
    row.considerationId = row.considerationId || null;
    row.offerId = row.offerId || null;
    row.status = row.status || 'Planned';
    row.startDate = row.startDate || null;
    row.endDate = row.endDate || null;
    row.engagementType = row.engagementType || '';
    row.workMode = row.workMode || '';
    row.location = row.location || '';
    row.recruiter = row.recruiter || '';
    row.notes = row.notes || '';
  },
  placementCommercials: (row) => {
    row.billRate = row.billRate == null ? null : Number(row.billRate);
    row.costRate = row.costRate == null ? null : Number(row.costRate);
    row.billedAmount = row.billedAmount == null ? null : Number(row.billedAmount);
    row.collectedAmount = row.collectedAmount == null ? null : Number(row.collectedAmount);
    row.currency = row.currency || 'INR';
    row.basis = row.basis || 'Annual';
    row.notes = row.notes || '';
  },
  interviewSlots: (row) => {
    row.demandId = row.demandId || null;
    row.candidateId = row.candidateId || null;
    row.interviewer = row.interviewer || '';
    row.round = row.round || 'Round 1';
    row.mode = row.mode || 'Video';
    row.location = row.location || '';
    row.durationMins = Number(row.durationMins) || 45;
    row.status = row.status || 'Open';
    row.interviewId = row.interviewId || null;
    row.note = row.note || '';
  },
  referrals: (row) => {
    row.referrerName = row.referrerName || '';
    row.referrerEmail = row.referrerEmail || '';
    row.referrerType = row.referrerType || 'Employee';
    row.refereeName = row.refereeName || '';
    row.refereeEmail = row.refereeEmail || '';
    row.refereePhone = row.refereePhone || '';
    row.refereeLinkedin = row.refereeLinkedin || '';
    row.relationship = row.relationship || '';
    row.note = row.note || '';
    row.demandId = row.demandId || null;
    row.candidateId = row.candidateId || null;
    row.status = row.status || 'New';
    row.outcome = row.outcome || '';
    row.rewardStatus = row.rewardStatus || 'Not eligible';
    row.rewardNote = row.rewardNote || '';
    row.source = row.source || 'In-app';
  },
  skills: (row) => {
    row.name = row.name || '';
    row.domain = row.domain || '';
    row.aliases = Array.isArray(row.aliases) ? row.aliases : [];
    row.notes = row.notes || '';
  },
  personSkills: (row) => {
    row.proficiency = row.proficiency || 'Exposure';
    row.years = row.years == null ? null : Number(row.years);
    row.lastUsed = row.lastUsed || null;
    row.confidence = Number(row.confidence) || 0;
    row.validated = row.validated === true;
    row.evidenceCount = Number(row.evidenceCount) || 0;
    row.lastEvidence = row.lastEvidence || null;
  },
  skillEvidence: (row) => {
    row.evidenceType = row.evidenceType || 'Self-declared';
    row.proficiency = row.proficiency || 'Exposure';
    row.years = row.years == null ? null : Number(row.years);
    row.lastUsed = row.lastUsed || null;
    row.evidenceRef = row.evidenceRef || '';
    row.assessor = row.assessor || '';
    row.note = row.note || '';
  },
  reports: (row) => {
    row.name = row.name || '';
    row.description = row.description || '';
    row.entity = row.entity || 'candidates';
    row.shared = row.shared !== false;
    row.config =
      row.config && typeof row.config === 'object' && !Array.isArray(row.config)
        ? { ...row.config }
        : {};
    row.config.filters = Array.isArray(row.config.filters) ? row.config.filters : [];
    row.config.measure = row.config.measure || 'count';
  },
  departments: (row) => {
    row.name = row.name || '';
    row.head = row.head || '';
    row.costCentre = row.costCentre || '';
    row.notes = row.notes || '';
  },
  clients: (row) => {
    row.name = row.name || '';
    row.industry = row.industry || '';
    row.location = row.location || '';
    row.website = row.website || '';
    row.owner = row.owner || '';
    row.status = row.status || 'Active';
    row.tier = row.tier || 'Standard';
    row.paymentTerms = row.paymentTerms || '';
    row.notes = row.notes || '';
    row.tags = Array.isArray(row.tags) ? row.tags : [];

    row.custom =
      row.custom && typeof row.custom === 'object' && !Array.isArray(row.custom) ? row.custom : {};
  },
  clientContacts: (row) => {
    row.clientId = row.clientId || null;
    row.name = row.name || '';
    row.title = row.title || '';
    row.email = row.email || '';
    row.phone = row.phone || '';
    row.notes = row.notes || '';
    row.isPrimary = row.isPrimary === true;
    row.decisionMaker = row.decisionMaker === true;

    row.custom =
      row.custom && typeof row.custom === 'object' && !Array.isArray(row.custom) ? row.custom : {};
  },
  offers: (row) => {
    row.status = row.status || 'Draft';
    row.role = row.role || '';
    row.location = row.location || '';
    row.notes = row.notes || '';
    row.ctc = row.ctc == null ? null : Number(row.ctc);
    row.approvedAt = row.approvedAt || null;
    row.approvedBy = row.approvedBy || '';
    row.approvedTerms =
      row.approvedTerms && typeof row.approvedTerms === 'object' ? row.approvedTerms : null;
  },
  workflowRules: (row) => {
    row.name = row.name || '';
    row.triggerTable = row.triggerTable || 'candidates';
    row.triggerField = row.triggerField || 'stage';
    row.op = row.op || 'eq';
    row.value = row.value == null ? '' : String(row.value);
    row.actions = Array.isArray(row.actions) ? row.actions : [];
    row.enabled = row.enabled !== false;
  },
  tasks: (row) => {
    row.title = row.title || '';
    row.done = !!row.done;
    row.due = row.due || '';
    row.owner = row.owner || '';
    row.candidateId = row.candidateId || null;
    row.demandId = row.demandId || null;
  },
  submissions: (row) => {
    row.clientContact = row.clientContact || '';
    row.method = row.method || 'Email';
    row.notes = row.notes || '';
    row.pack = row.pack && typeof row.pack === 'object' && !Array.isArray(row.pack) ? row.pack : {};
    row.clientStatus = row.clientStatus || 'Pending';
    row.clientComment = row.clientComment || '';
    row.decidedOn = row.decidedOn || null;
    row.contactId = row.contactId || null;
  },
  publicApplications: (row) => {
    row.name = row.name || '';
    row.email = row.email || '';
    row.phone = row.phone || '';
    row.linkedin = row.linkedin || '';
    row.message = row.message || '';
    row.status = row.status || 'pending';
    row.consentContact = !!row.consentContact;
    row.consentSharing = !!row.consentSharing;
  },
  interviews: (row) => {
    row.round = row.round || 'Round 1';
    row.mode = row.mode || 'Video';
    row.status = row.status || 'Scheduled';
    row.interviewers = Array.isArray(row.interviewers) ? row.interviewers : [];
    row.feedback =
      row.feedback && typeof row.feedback === 'object' && !Array.isArray(row.feedback)
        ? row.feedback
        : {};
    row.notes = row.notes || '';
    row.durationMins = row.durationMins || 45;
  },
};

export function normalizeRow(table, source) {
  const row = { ...source };
  normalizers[table]?.(row);
  return row;
}
