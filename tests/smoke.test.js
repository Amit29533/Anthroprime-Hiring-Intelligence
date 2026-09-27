import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { renderToString } from 'react-dom/server';
import React from 'react';

let server, M, data;
async function init() {
  if (M) return;
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const W = await server.ssrLoadModule('/src/Workflows.jsx');
  const C = await server.ssrLoadModule('/src/Candidates.jsx');
  const D = await server.ssrLoadModule('/src/Demands.jsx');
  M = {
    Dashboard: (await server.ssrLoadModule('/src/Dashboard.jsx')).default,
    App: (await server.ssrLoadModule('/src/App.jsx')).default,
    makeSeed: (await server.ssrLoadModule('/src/seed.js')).makeSeed,
    Assessments: W.Assessments, Activities: W.Activities, Pools: W.Pools, Analytics: W.Analytics, Settings: W.Settings,
    Candidates: C.Candidates, CandidateForm: C.CandidateForm, CandidateProfile: C.CandidateProfile,
    DemandForm: D.DemandForm, Demands: D.Demands, DemandDetail: D.DemandDetail, Pipeline: D.Pipeline
  };
  data = M.makeSeed();
}
const render = async (name, props = {}) => { await init(); return renderToString(React.createElement(M[name], { data, ...props })); };
const noop = () => {};
const save = async () => true;

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
  for (const marker of ['Administration', 'Pipeline stage labels', 'Retention policy', 'Audit log', 'Merge duplicates', 'Skill taxonomy'])
    assert.ok(html.includes(marker), `missing marker: ${marker}`);
});

test('Repository renders saved views, column chooser and table', async () => {
  await init();
  const html = await render('Candidates', {
    query: '', setQuery: noop, initialFilter: null, onOpen: noop, onAdd: noop, onImport: noop, notify: noop, audit: noop, onSave: save
  });
  for (const marker of ['Apply a saved view', 'Columns:', 'Talent repository'])
    assert.ok(html.includes(marker), `missing marker: ${marker}`);
});

test('Candidate profile renders all nine tabs including ECOD and Consent & privacy', async () => {
  await init();
  const html = await render('CandidateProfile', {
    candidate: data.candidates[0], onClose: noop, onEdit: noop, onSave: save, onShortlist: noop, onAssess: noop, busy: false, audit: noop
  });
  for (const marker of ['ECOD', 'Consent &amp; privacy', 'Employment', 'Documents', 'History'])
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
