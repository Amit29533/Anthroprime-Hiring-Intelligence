import { allCandidateRows, assignAnthroIds } from './anthroId.js';
import { makeSeed } from './seed.js';
import { uid } from './domain.js';
import { CUSTOM_MODULES, validateCustomValues } from './customFields.js';
import { normalizeRow } from './rowDefaults.js';
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_ANON_KEY;
export const cloud = Boolean(url && key);

let supabasePromise = null;
export function getSupabase() {
  if (!cloud) return Promise.resolve(null);
  if (!supabasePromise) {
    supabasePromise = import('@supabase/supabase-js')
      .then(({ createClient }) => createClient(url, key))
      .catch((error) => {
        supabasePromise = null;
        throw error;
      });
  }
  return supabasePromise;
}

let currentRole = cloud ? 'viewer' : 'admin'; // cloud access stays restrictive until membership resolves
export const getRole = () => currentRole;
// The workspace the signed-in account belongs to. The public careers URL needs it as ?ws=, so
// the settings screen can show a link that actually works instead of a placeholder.
let currentWorkspaceId = '';
let currentWorkspaces = [];
let workspaceContextRevision = 0;
export const getWorkspaceId = () => currentWorkspaceId;
export const getWorkspaces = () => currentWorkspaces.map((workspace) => ({ ...workspace }));
export const getWorkspace = () =>
  currentWorkspaces.find((workspace) => workspace.id === currentWorkspaceId) || null;
export const canWriteForRole = (role) => role === 'admin' || role === 'recruiter';
export const canExportForRole = canWriteForRole;

// A new cloud identity must not inherit the previous account's UI permissions while loading.
export function resetRoleForSessionChange() {
  workspaceContextRevision++;
  currentRole = cloud ? 'viewer' : 'admin';
  currentWorkspaceId = '';
  currentWorkspaces = [];
}
export { TABLES, emptyData, normalizeData } from './schema.js';
import { TABLES, emptyData, normalizeData } from './schema.js';
const STORAGE = 'ecod-demo-v1';

function applyWorkspaceContext(workspaces, activeWorkspace) {
  workspaceContextRevision++;
  currentWorkspaces = (workspaces || [])
    .filter((workspace) => workspace?.id)
    .map((workspace) => ({
      id: workspace.id,
      name: String(workspace.name || 'Untitled workspace'),
      role: ['admin', 'recruiter', 'viewer', 'assessor', 'sales'].includes(workspace.role)
        ? workspace.role
        : 'viewer',
    }));
  const active =
    currentWorkspaces.find((workspace) => workspace.id === activeWorkspace) ||
    currentWorkspaces[0] ||
    null;
  currentWorkspaceId = active?.id || '';
  currentRole = active?.role || (cloud ? 'viewer' : 'admin');
  return active;
}

export async function refreshWorkspaceAccess() {
  const revision = workspaceContextRevision;
  const client = await getSupabase();
  const { data, error } = await client.rpc('api_my_workspaces');
  if (revision !== workspaceContextRevision) return getWorkspace();
  if (error || !Array.isArray(data?.workspaces))
    throw new Error(error?.message || 'Workspace access could not be verified.');
  const active = applyWorkspaceContext(data.workspaces, data.activeWorkspace);
  if (!active) throw new Error('Your workspace access has been removed.');
  return active;
}

async function loadWorkspaceContext(supabase) {
  const revision = workspaceContextRevision;
  const { data: payload, error: rpcError } = await supabase.rpc('api_my_workspaces');
  if (revision !== workspaceContextRevision) return getWorkspace();
  if (!rpcError && payload && Array.isArray(payload.workspaces)) {
    if (payload.error) throw new Error(payload.error);
    const active = applyWorkspaceContext(payload.workspaces, payload.activeWorkspace);
    if (!active)
      throw new Error(
        'Your account has not been assigned to a workspace. Ask your administrator to add your workspace membership.',
      );
    return active;
  }

  // Backward-compatible path while migration 031 is being deployed. It keeps existing single-
  // workspace installations usable and gives the administrator time to apply the new migration.
  const { data: membership, error: memberError } = await supabase
    .from('memberships')
    .select('workspace_id,role')
    .maybeSingle();
  if (memberError) throw rpcError || memberError;
  if (!membership)
    throw new Error(
      'Your account has not been assigned to a workspace. Ask your administrator to add your workspace membership.',
    );
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id,name')
    .eq('id', membership.workspace_id)
    .maybeSingle();
  if (revision !== workspaceContextRevision) return getWorkspace();
  return applyWorkspaceContext(
    [
      {
        id: membership.workspace_id,
        name: workspace?.name || 'AnthroPrime',
        role: membership.role,
      },
    ],
    membership.workspace_id,
  );
}

async function workspaceRpc(name, parameters) {
  if (!cloud) throw new Error('Workspace management is available in the shared team workspace.');
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883')
      throw new Error('Apply Supabase migration 031 to enable multiple workspaces.');
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  if (!data?.ok) throw new Error('The workspace operation did not complete.');
  return data;
}

export async function switchWorkspace(workspaceId) {
  if (!workspaceId || workspaceId === currentWorkspaceId) return getWorkspace();
  await workspaceRpc('api_switch_workspace', { p_workspace: workspaceId });
  const supabase = await getSupabase();
  return loadWorkspaceContext(supabase);
}

export async function createWorkspace(name) {
  const clean = String(name || '').trim();
  if (clean.length < 2 || clean.length > 80)
    throw new Error('Workspace name must be between 2 and 80 characters.');
  await workspaceRpc('api_create_workspace', { p_name: clean });
  const supabase = await getSupabase();
  return loadWorkspaceContext(supabase);
}

export async function loadData({ forceFull = false } = {}) {
  if (!cloud) {
    applyWorkspaceContext([{ id: 'demo', name: 'AnthroPrime', role: 'admin' }], 'demo');
    const stored = localStorage.getItem(STORAGE);
    // Normalize the seed too. makeSeed() only produces the tables it has sample data for, so a
    // fresh demo workspace was missing the key for any newer table (reports, referrals) and the
    // first save to one crashed on `current[table]`.
    if (!stored) return normalizeData(makeSeed());
    let parsed;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new Error(
        'Saved demo data is corrupt. Reset demo data from Workspace settings, or clear this site’s browser storage.',
      );
    }
    return normalizeData(parsed);
  }

  const supabase = await getSupabase();
  const data = emptyData();
  await loadWorkspaceContext(supabase);
  if (['assessor', 'sales'].includes(getRole())) return { ...data, assignedOnly: true };
  if (!forceFull) {
    const { data: settings, error } = await supabase
      .from('settings')
      .select('*')
      .eq('id', 'workspace');
    if (error) throw error;
    if (settings?.some((row) => row.custom?.pagedRepository === true)) {
      data.settings = settings;
      const { data: taxonomy, error: taxError } = await supabase
        .from('taxonomy')
        .select('*')
        .eq('id', 'workspace');
      if (taxError) throw taxError;
      data.taxonomy = taxonomy;
      return { ...normalizeData(data, { assignIdentities: false }), repositoryPartial: true };
    }
  }
  await Promise.all(
    TABLES.map(async (table) => {
      let from = 0;
      while (true) {
        const projected = ['candidates', 'history', 'offers', 'submissions'].includes(table);
        const response = projected
          ? await supabase.rpc('api_legacy_rows', { p_table: table, p_offset: from, p_limit: 1000 })
          : await supabase
              .from(table)
              .select('*')
              .order('id')
              .range(from, from + 999);
        const { error } = response;
        const rows = projected ? response.data?.rows : response.data;
        if (error) {
          if (
            ['assessmentTemplates', 'talentPools', 'poolMembers'].includes(table) &&
            ['42P01', 'PGRST205'].includes(error.code)
          )
            throw new Error(
              'Apply Supabase migration 032_repository_structures.sql to enable assessment templates and curated pools.',
            );
          throw error;
        }
        if (!Array.isArray(rows) || rows.length > 1000)
          throw new Error('Workspace returned an invalid projected page.');
        data[table].push(...rows);
        if (rows.length < 1000) break;
        from += 1000;
      }
    }),
  );
  return normalizeData(data, { assignIdentities: false });
}

// Structured repository filtering is evaluated by PostgreSQL in cloud mode. Return IDs only;
// existing profile projection and local CV/semantic ranking remain authoritative for display.
export async function queryRepositoryIds(filters) {
  const supabase = await getSupabase();
  const ids = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.rpc('api_filter_candidates', {
      p_employer: filters.employer.trim(),
      p_engagement: filters.engagement,
      p_max_expected: filters.maxExpected === '' ? null : Number(filters.maxExpected),
      p_limit: 1000,
      p_offset: offset,
    });
    if (error)
      throw new Error(
        ['42883', 'PGRST202'].includes(error.code)
          ? 'Apply migration 033_client_documents_filters.sql to enable server-side repository filters.'
          : error.message,
      );
    if (data?.error) throw new Error(data.error);
    const page = data?.ids || [];
    ids.push(...page);
    if (page.length < 1000) return ids;
    offset += page.length;
  }
}

export function mergeHistory(currentRows = [], recentRows = []) {
  const byId = new Map();
  for (const row of currentRows) if (row?.id) byId.set(row.id, row);
  for (const row of recentRows) if (row?.id) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')),
  );
}

export function historyRefreshLimit(rowCount) {
  return Math.max(1000, rowCount);
}

let demoCandidateQueue = Promise.resolve();
export async function saveRows(table, rows, current, { identityLocked = false } = {}) {
  if (current?.repositoryPartial) throw new Error('Load the full workspace before saving records.');
  if (!cloud && table === 'candidates' && !identityLocked) {
    const commit = () => saveRows(table, rows, current, { identityLocked: true });
    const operation = demoCandidateQueue.then(() =>
      globalThis.navigator?.locks?.request
        ? globalThis.navigator.locks.request('ecod-demo-candidate-save', commit)
        : commit(),
    );
    demoCandidateQueue = operation.catch(() => {});
    return operation;
  }
  if (table === 'candidates') {
    if (!cloud) {
      // Under the browser lock, include allocations saved by another tab since
      // this screen loaded. Do not overwrite or reuse its newly allocated IDs.
      const stored = localStorage.getItem(STORAGE);
      if (stored) {
        // The draft rows below are the requested edit; every other record must
        // come from the latest committed workspace, including notes/history.
        current = normalizeData(JSON.parse(stored), { activatePreferences: false });
      }
      const existing = allCandidateRows(current);
      const byId = new Map(existing.map((c) => [c.id, c]));
      const combined = assignAnthroIds([
        ...existing.filter((c) => !rows.some((r) => r.id === c.id)),
        ...rows.map((row) =>
          byId.has(row.id)
            ? {
                ...row,
                anthroNumber: byId.get(row.id).anthroNumber,
                anthroId: byId.get(row.id).anthroId,
              }
            : row,
        ),
      ]);
      rows = combined.filter((c) => rows.some((r) => r.id === c.id));
    }
    rows = rows.map((row) => normalizeRow(table, row));
  }
  if (Object.hasOwn(CUSTOM_MODULES, table)) {
    for (const row of rows) {
      const problem = validateCustomValues(current, table, row.custom || {});
      if (problem) throw new Error(problem);
    }
  }
  if (cloud) {
    const supabase = await getSupabase();
    // Mode is changed only through its dedicated admin RPC. A stale settings
    // snapshot (branding, rules or restore) must not silently flip execution.
    const writableRows =
      table === 'settings'
        ? rows.map((row) => {
            const saved = { ...row };
            delete saved.serverAutomation;
            return saved;
          })
        : table === 'candidates'
          ? rows.map((row) => {
              const saved = { ...row };
              // PostgreSQL owns the allocated number and generated label; aliases are derived from tombstones.
              delete saved.anthroId;
              delete saved.anthroNumber;
              delete saved.anthroAliases;
              delete saved.processingRestricted;
              delete saved.mergedInto;
              if (getRole() !== 'admin') {
                delete saved.current;
                delete saved.expected;
                delete saved.currency;
              }
              return saved;
            })
          : table === 'offers'
            ? rows.map((row) => {
                const saved = { ...row };
                delete saved.termsApproved;
                if (getRole() !== 'admin')
                  for (const key of ['ctc', 'approvedTerms', 'approvedAt', 'approvedBy'])
                    delete saved[key];
                return saved;
              })
            : rows;
    const response = ['candidates', 'offers'].includes(table)
      ? await supabase.rpc(table === 'candidates' ? 'api_save_candidates' : 'api_save_offers', {
          p_rows: writableRows,
        })
      : await supabase.from(table).upsert(writableRows).select();
    const { error } = response;
    const data = ['candidates', 'offers'].includes(table) ? response.data?.rows : response.data;
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Workspace returned an invalid save response.');
    const { data: historyResponse, error: historyError } = await supabase.rpc('api_legacy_rows', {
      p_table: 'history',
      p_offset: 0,
      p_limit: 1000,
    });
    if (historyError) throw historyError;
    const recentHistory = historyResponse?.rows;
    return {
      rows: table === 'candidates' ? data.map((row) => normalizeRow(table, row)) : data,
      history: mergeHistory(current.history || [], recentHistory || []),
    };
  }
  const history = rows.map((row) => ({
    id: uid(),
    entityId: row.id,
    entityType: table,
    action: current[table].some((r) => r.id === row.id)
      ? `${table === 'candidates' ? 'Profile' : table} updated`
      : `${table === 'candidates' ? 'Profile' : table} created`,
    date: new Date().toISOString(),
    actor: 'Demo recruiter',
    snapshot: current[table].find((r) => r.id === row.id) || null,
  }));
  let next = {
    ...current,
    [table]: [...rows, ...current[table].filter((r) => !rows.some((n) => n.id === r.id))],
    history: [...history, ...current.history],
  };
  if (table === 'candidates') next = normalizeData(next);
  localStorage.setItem(STORAGE, JSON.stringify(next));
  return { rows, history: next.history };
}

/**
 * Delete rows. Only tables whose DELETE policy grants editors the right are permitted here —
 * repository records are never deletable from the product, because history and audit depend on
 * them existing. A saved report is disposable metadata, so it is.
 */
export const DELETABLE_TABLES = ['reports', 'assignmentRules'];

export async function deleteRows(table, ids, current) {
  if (current?.repositoryPartial)
    throw new Error('Load the full workspace before deleting records.');
  if (!DELETABLE_TABLES.includes(table))
    throw new Error(`${table} records cannot be deleted from the product.`);
  if (cloud) {
    const supabase = await getSupabase();
    const { error } = await supabase.from(table).delete().in('id', ids);
    if (error) throw error;
  }
  const next = { ...current, [table]: current[table].filter((r) => !ids.includes(r.id)) };
  if (!cloud) localStorage.setItem(STORAGE, JSON.stringify(next));
  return next;
}

// Blueprint §12 — view/export audit trail. Silent: no toast, errors swallowed by the caller.
export async function logAuditEvent(event, current) {
  const row = {
    id: uid(),
    entityType: event.entityType || '',
    entityId: event.entityId || null,
    action: event.action || '',
    detail: event.detail || '',
    actor: cloud ? 'Team member' : 'Demo recruiter',
    date: new Date().toISOString(),
  };
  if (cloud) {
    const supabase = await getSupabase();
    const { error } = await supabase.from('auditEvents').insert(row);
    if (error) throw error;
  }
  const next = { ...current, auditEvents: [row, ...current.auditEvents].slice(0, 500) };
  if (!cloud) localStorage.setItem(STORAGE, JSON.stringify(next));
  return { row, data: next };
}

export async function resetDemo() {
  localStorage.removeItem(STORAGE);
  return normalizeData(makeSeed());
}
