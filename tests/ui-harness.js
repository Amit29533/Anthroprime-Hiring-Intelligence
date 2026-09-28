// Mounts real React components in the jsdom environment and drives them with user events.
import './ui-env.js';
import { createServer } from 'vite';
import { teardownDom } from './ui-env.js';
export { downloaded, resetDownloads, blobText } from './ui-env.js';
import React from 'react';
import { act } from 'react';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { makeSeed } from '../src/seed.js';

let server;
const modules = new Map();

export async function startVite() {
  if (server) return server;
  server = await createServer({
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
    logLevel: 'error',
  });
  return server;
}

export async function stopVite() {
  if (server) {
    const s = server;
    server = null;
    modules.clear();
    // Guarded: a wedged close() must not hang the whole suite.
    await Promise.race([s.close().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
  }
  teardownDom();
}

export async function load(path) {
  await startVite();
  if (!modules.has(path)) modules.set(path, await server.ssrLoadModule(path));
  return modules.get(path);
}

/** Every component the workspace shell can render, keyed for convenience. */
export async function loadApp() {
  const [A, C, D, W, IV, DB, CA, PO, CL, ME] = await Promise.all([
    load('/src/App.jsx'),
    load('/src/Candidates.jsx'),
    load('/src/Demands.jsx'),
    load('/src/Workflows.jsx'),
    load('/src/Interviews.jsx'),
    load('/src/Dashboard.jsx'),
    load('/src/careers.jsx'),
    load('/src/portal.jsx'),
    load('/src/Clients.jsx'),
    load('/src/Members.jsx'),
  ]);
  return {
    App: A.default,
    Dashboard: DB.default,
    Candidates: C.Candidates,
    CandidateForm: C.CandidateForm,
    CandidateProfile: C.CandidateProfile,
    exportCandidates: C.exportCandidates,
    downloadFile: C.downloadFile,
    Demands: D.Demands,
    DemandForm: D.DemandForm,
    DemandDetail: D.DemandDetail,
    Pipeline: D.Pipeline,
    SubmissionModal: D.SubmissionModal,
    ImportModal: W.ImportModal,
    AssessmentForm: W.AssessmentForm,
    EnrichmentForm: W.EnrichmentForm,
    Assessments: W.Assessments,
    Activities: W.Activities,
    Pools: W.Pools,
    Analytics: W.Analytics,
    Settings: W.Settings,
    Login: W.Login,
    DispositionModal: W.DispositionModal,
    Members: ME.Members,
    Clients: CL.Clients,
    ClientForm: CL.ClientForm,
    ClientDetail: CL.ClientDetail,
    ContactForm: CL.ContactForm,
    Interviews: IV.Interviews,
    ScheduleModal: IV.ScheduleModal,
    FeedbackModal: IV.FeedbackModal,
    OfferModal: IV.OfferModal,
    OffersSection: IV.OffersSection,
    // The two public-facing surfaces: the careers page (anonymous applicants) and the
    // candidate portal (self-service). Both read and write the same workspace store.
    CareersApp: CA.CareersApp,
    PortalApp: PO.PortalApp,
    normalizePortalPayload: PO.normalizePortalPayload,
  };
}

/**
 * A tiny in-memory workspace: `save` records every write so tests can assert what the UI
 * actually persisted, mirroring App.jsx's save pipeline (including its automation hook).
 */
export function createHarness(seed = makeSeed()) {
  const state = { data: seed, writes: [], toasts: [], audits: [] };
  const save = async (table, rows) => {
    state.writes.push({ table, rows });
    const next = {
      ...state.data,
      [table]: [...rows, ...state.data[table].filter((r) => !rows.some((n) => n.id === r.id))],
    };
    state.data = next;
    return true;
  };
  const notify = (msg) => state.toasts.push(msg);
  const audit = (ev) => state.audits.push(ev);
  return { state, save, notify, audit, noop: () => {} };
}

export async function mount(Component, props = {}) {
  let result;
  await act(async () => {
    result = render(React.createElement(Component, props));
  });
  return result;
}

/** Run an event and flush React's async effects/state so handlers complete. */
export async function fire(element, ...args) {
  await act(async () => {
    fireEvent[element === undefined ? 'click' : 'click'](element, ...args);
  });
}
export async function click(element) {
  await act(async () => {
    fireEvent.click(element);
  });
}
export async function change(element, value) {
  await act(async () => {
    fireEvent.change(element, { target: { value } });
  });
}
export async function submit(element) {
  await act(async () => {
    fireEvent.submit(element);
  });
}
export async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

export { React, act, render, screen, fireEvent, cleanup, within, makeSeed };

// --- query helpers tuned to this app's own primitives ----------------------------------
// ui.jsx renders <label><span>Label</span><control/><small>hint</small></label>, so the
// accessible label text includes the hint. Match on the leading words instead.
// Accepts a plain string (anchored, escaped) or a ready-made RegExp.
const labelMatcher = (text) =>
  text instanceof RegExp
    ? text
    : new RegExp(`^${String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
export const byLabel = (text) => screen.getByLabelText(labelMatcher(text));
export const queryByLabel = (text) => screen.queryByLabelText(labelMatcher(text));
export const allByLabel = (text) => screen.queryAllByLabelText(labelMatcher(text));
/** The <form> a given button belongs to (buttons are nested inside modal-actions divs). */
export const formOf = (buttonText) => screen.getByText(buttonText).closest('form');
/** Let pending promises, effects and act() work drain. */
export async function settle(times = 3) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
}

/**
 * Assert a user-visible action did not blow up. React logs handler exceptions to
 * console.error; capturing them turns "silently broken button" into a test failure.
 */
export function captureErrors() {
  const errors = [];
  const realError = console.error;
  const realWarn = console.warn;
  console.error = (...a) => {
    errors.push(a.map(String).join(' '));
  };
  console.warn = (...a) => {
    if (/React|act\(/.test(String(a[0]))) errors.push(a.map(String).join(' '));
  };
  const restore = () => {
    console.error = realError;
    console.warn = realWarn;
  };
  return { errors, restore };
}
