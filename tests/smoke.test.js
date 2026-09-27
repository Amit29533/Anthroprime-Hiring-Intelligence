import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { renderToString } from 'react-dom/server';
import React from 'react';

let server, M, data;
async function init() {
  if (M) return;
  server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
  const W = await server.ssrLoadModule('/src/Workflows.jsx');
  const IV = await server.ssrLoadModule('/src/Interviews.jsx');
  const C = await server.ssrLoadModule('/src/Candidates.jsx');
  const D = await server.ssrLoadModule('/src/Demands.jsx');
  M = {
    Dashboard: (await server.ssrLoadModule('/src/Dashboard.jsx')).default,
    App: (await server.ssrLoadModule('/src/App.jsx')).default,
    makeSeed: (await server.ssrLoadModule('/src/seed.js')).makeSeed,
    Assessments: W.Assessments, Activities: W.Activities, Pools: W.Pools, Analytics: W.Analytics, Settings: W.Settings,
    Interviews: IV.Interviews, ScheduleModal: IV.ScheduleModal, FeedbackModal: IV.FeedbackModal,
    Candidates: C.Candidates, CandidateForm: C.CandidateForm, CandidateProfile: C.CandidateProfile,
    DemandForm: D.DemandForm, Demands: D.Demands, DemandDetail: D.DemandDetail, Pipeline: D.Pipeline,
    PortalApp: (await server.ssrLoadModule('/src/portal.jsx')).PortalApp
  };
  data = M.makeSeed();
}
const render = async (name, props = {}) => { await init(); return renderToString(React.createElement(M[name], { data, ...props })); };
const noop = () => {};
const save = async () => true;

test('Candidate portal renders its gate and, with a profile, the curated view', async () => {
  await init();
  const gate = renderToString(React.createElement(M.PortalApp, {}));
  for (const marker of ['CANDIDATE PORTAL', 'Open my record', 'your applications'])
    assert.ok(gate.includes(marker), `portal gate missing marker: ${marker}`);
  const { portalOverview } = await server.ssrLoadModule('/src/portal.js');
  const view = portalOverview(data.candidates[0], data);
  const html = renderToString(React.createElement(M.PortalApp, {}));
  assert.ok(view.profile.name === data.candidates[0].name);
  assert.ok(!('notes' in view));
});

test.after(async () => { if (server) await server.close(); });

test('Analytics renders quality queues, heatmap, coverage, funnel and audit panels', async () => {
  await init();
  const html = await render('Analytics', { navigate: noop });
  for (const marker of ['Data quality queues', 'Skill gap heatmap', 'Demand coverage', 'Client funnel', 'Velocity &amp; audit', 'Usable profiles'])
    assert.ok(html.includes(marker), `missing marker: ${marker}`);
});

test('Settings renders the admin console, merge tool and taxonomy editor', async () => {
  await init();
  const html = await render('Settings', { session: null, onReload: noop, notify: noop, audit: noop, onSave: save });
  for (const marker of ['Administration', 'Pipeline stage labels', 'Retention policy', 'Audit log', 'Merge duplicates', 'Skill taxonomy', 'Download workspace backup (JSON)', 'Restore from backup', 'Automation rules', 'Offer accepted', 'Document templates', 'Fair-process guardrails'])
    assert.ok(html.includes(marker), `missing marker: ${marker}`);
});

test('Repository renders saved views, column chooser and table', async () => {
  await init();
  const html = await render('Candidates', {
    query: '', setQuery: noop, initialFilter: null, onOpen: noop, onAdd: noop, onImport: noop, notify: noop, audit: noop, onSave: save
  });
  for (const marker of ['Apply a saved view', 'Columns:', 'Talent repository', 'Semantic'])
    assert.ok(html.includes(marker), `missing marker: ${marker}`);
});

test('Candidate profile renders all nine tabs including ECOD and Consent & privacy', async () => {
  await init();
  const html = await render('CandidateProfile', {
    candidate: data.candidates[0], onClose: noop, onEdit: noop, onSave: save, onShortlist: noop, onAssess: noop, busy: false, audit: noop
  });
  for (const marker of ['ECOD', 'Interviews', 'Consent &amp; privacy', 'Employment', 'Documents', 'History', 'Generate letter', 'Dossier', 'Portal invite'])
    assert.ok(html.includes(marker), `missing marker: ${marker}`);
});

test('ECOD and Consent tabs render their full content', async () => {
  await init();
  const ecod = await render('CandidateProfile', { candidate: data.candidates[0], initialTab: 'ECOD', onClose: noop, onEdit: noop, onSave: save, onShortlist: noop, onAssess: noop, busy: false, audit: noop });
  for (const marker of ['Readiness', 'Next action', 'Enrichment'])
    assert.ok(ecod.includes(marker), `ECOD tab missing marker: ${marker}`);
  const consent = await render('CandidateProfile', { candidate: data.candidates[0], initialTab: 'Consent & privacy', onClose: noop, onEdit: noop, onSave: save, onShortlist: noop, onAssess: noop, busy: false, audit: noop });
  for (const marker of ['recruiting-contact', 'Notice version', 'Record consent', "Export this profile"])
    assert.ok(consent.includes(marker), `Consent tab missing marker: ${marker}`);
});

test('Interviews page renders stats, upcoming panel and history; profile tab lists interviews', async () => {
  await init();
  const html = await render('Interviews', { onSave: save, onOpen: noop, busy: false, notify: noop, audit: noop });
  for (const marker of ['Schedule interview', 'Upcoming interviews', 'Past interviews', 'Average rating', 'Neha Kulkarni', 'Offers', 'New offer', 'awaiting response', 'Export calendar (.ics)', 'Letter', 'Import .ics'])
    assert.ok(html.includes(marker), `Interviews page missing marker: ${marker}`);
  const tab = await render('CandidateProfile', {
    candidate: data.candidates[0], initialTab: 'Interviews', onClose: noop, onEdit: noop, onSave: save, onShortlist: noop, onAssess: noop, busy: false, audit: noop
  });
  assert.ok(tab.includes('iv-row'), 'profile interviews tab lists rows');
  const modal = await render('ScheduleModal', { onClose: noop, onSave: save, candidates: data.candidates, demands: data.demands.filter(d => d.status === 'Open') });
  for (const marker of ['Candidate', 'Round', 'Interviewers', 'Schedule interview'])
    assert.ok(modal.includes(marker), `ScheduleModal missing marker: ${marker}`);
  const fb = await render('FeedbackModal', {
    interview: data.interviews.find(i => i.status === 'Scheduled'), candidate: data.candidates[0], demand: data.demands[0], settings: data.settings, onClose: noop, onSave: save
  });
  for (const marker of ['Technical depth', 'Recommendation', 'the bar'])
    assert.ok(fb.includes(marker), `FeedbackModal missing marker: ${marker}`);
});

test('Offers and tasks render; custom fields appear on forms, profiles and demand briefs', async () => {
  await init();
  const acts = await render('Activities', { onOpen: noop, onSave: save, busy: false });
  for (const marker of ['Tasks', 'Add task', 'Call Priya about the Meridian architecture panel'])
    assert.ok(acts.includes(marker), `Activities missing marker: ${marker}`);
  const profile = await render('CandidateProfile', {
    candidate: data.candidates[5], initialTab: 'Applications', onClose: noop, onEdit: noop, onSave: save, onShortlist: noop, onAssess: noop, busy: false, audit: noop
  });
  for (const marker of ['Create offer', 'Offer \u00b7', '31'])
    assert.ok(profile.includes(marker), `profile applications tab missing: ${marker}`);
  const cform = await render('CandidateForm', { candidate: null, onClose: noop, onSave: save, busy: false });
  assert.ok(cform.includes('Background check'), 'candidate form renders admin-defined custom fields');
  const C = await server.ssrLoadModule('/src/Candidates.jsx');
  assert.ok(String(C.exportCandidates).includes('exportedAt'), 'candidate CSV exports carry an exportedAt stamp');
  const dform = await render('DemandForm', { demand: data.demands[0], onClose: noop, onSave: save, onCreated: noop, busy: false });
  assert.ok(dform.includes('Billing rate'), 'demand form renders admin-defined custom fields');
  const detail = await render('DemandDetail', {
    demand: data.demands[0], onBack: noop, onEdit: noop, onOpenCandidate: noop, onShortlist: noop,
    onPipeline: noop, onEnrich: noop, onSave: save, busy: false
  });
  assert.ok(detail.includes('Raise an offer'), 'demand detail has the offers panel');
  assert.ok(detail.includes('Client submissions'), 'demand detail has the submissions panel');
  assert.ok(detail.includes('Demand owner'), 'demand brief shows the owner');
  const overview = await render('CandidateProfile', {
    candidate: data.candidates[0], onClose: noop, onEdit: noop, onSave: save, onShortlist: noop, onAssess: noop, busy: false, audit: noop
  });
  assert.ok(overview.includes('Similar talent in your repository'), 'profile shows similar talent');
});

test('Careers portal renders open roles with the consent-gated application form; review queue lists applications', async () => {
  await init();
  const CAREERS = await server.ssrLoadModule('/src/careers.jsx');
  const html = renderToString(React.createElement(CAREERS.CareersApp, {}));
  for (const marker of ['Open roles', 'Senior Databricks Architect', 'Apply', 'Check your application status'])
    assert.ok(html.includes(marker), `careers page missing marker: ${marker}`);
  const acts = await render('Activities', { onOpen: noop, onSave: save, busy: false, notify: noop, audit: noop });
  for (const marker of ['Career applications', 'Devika Nair', 'contact consent', 'sharing consent', 'Accept into repository'])
    assert.ok(acts.includes(marker), `activities missing application queue marker: ${marker}`);
  const detail = await render('DemandDetail', {
    demand: data.demands[1], onBack: noop, onEdit: noop, onOpenCandidate: noop, onShortlist: noop,
    onPipeline: noop, onEnrich: noop, onSave: save, busy: false
  });
  assert.ok(detail.includes('Client decision'), 'submission rows expose client decision controls');
});

test('Submission modal compiles the pack with a consent gate', async () => {
  await init();
  const sm = await server.ssrLoadModule('/src/Demands.jsx');
  const modal = renderToString(React.createElement(sm.SubmissionModal, {
    demand: data.demands[1], data, onClose: noop, onSave: save, busy: false, audit: noop
  }));
  for (const marker of ['Prepare client submission', 'Client contact', 'Pack preview', 'Profile-sharing consent', 'Log submission'])
    assert.ok(modal.includes(marker), `SubmissionModal missing marker: ${marker}`);
  const pre = modal.slice(modal.indexOf('<pre'), modal.indexOf('</pre>'));
  assert.ok(pre.length > 200 && !pre.includes('Current CTC') && !pre.includes('\u20B9' + data.candidates[4].current + ' '), 'pack preview never shows current CTC');
});

test('Demand form renders per-skill minimums and stage-set picker for an existing demand', async () => {
  await init();
  const html = await render('DemandForm', { demand: data.demands[0], onClose: noop, onSave: save, onCreated: noop, busy: false });
  for (const marker of ['Minimum proficiency per must-have skill', 'per-skill-grid', 'Pipeline stages for this demand', 'stage-set-grid'])
    assert.ok(html.includes(marker), `DemandForm missing marker: ${marker}`);
});

test('Demand detail shows commercials; pipeline honours per-demand stage sets', async () => {
  await init();
  const html = await render('DemandDetail', {
    demand: data.demands[0], onBack: noop, onEdit: noop, onOpenCandidate: noop, onShortlist: noop,
    onPipeline: noop, onEnrich: noop, onSave: save, busy: false
  });
  assert.ok(html.includes('Internal commercials'), 'commercials panel missing');
  const staged = await render('Pipeline', {
    data: { ...data, demands: [{ ...data.demands[0], stageSet: ['Identified', 'Interview'] }] },
    selectedDemand: data.demands[0].id, setSelectedDemand: noop, onOpen: noop, onNew: noop, onMove: noop, busy: false
  });
  assert.ok(staged.includes('kanban-column'), 'pipeline rendered');
  assert.ok(!staged.includes('Interview Scheduled'), 'stage set filters kanban columns');
});

test('Remaining pages render without throwing', async () => {
  await init();
  await render('Dashboard', { navigate: noop, openCandidate: noop, openDemand: noop, onNewDemand: noop, onAdd: noop, onImport: noop, onComplete: noop });
  await render('CandidateForm', { candidate: null, onClose: noop, onSave: save, busy: false });
  await render('DemandForm', { demand: null, onClose: noop, onSave: save, onCreated: noop, busy: false });
  await render('Demands', { onNew: noop, onOpen: noop });
  await render('Assessments', { onNew: noop, onEnrich: noop, onOpen: noop, onSave: save, busy: false });
  await render('Activities', { onOpen: noop, onSave: save, busy: false });
  await render('Pools', { onOpen: noop });
  await render('App', {});
});
