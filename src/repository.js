import { makeSeed } from './seed.js';
import { uid } from './domain.js';
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
export const getWorkspaceId = () => currentWorkspaceId;
export const canWriteForRole = (role) => role === 'admin' || role === 'recruiter';
export const canExportForRole = canWriteForRole;

// A new cloud identity must not inherit the previous account's UI permissions while loading.
export function resetRoleForSessionChange() {
  currentRole = cloud ? 'viewer' : 'admin';
  currentWorkspaceId = '';
}
export { TABLES, emptyData, normalizeData } from './schema.js';
import { TABLES, emptyData, normalizeData } from './schema.js';
const STORAGE = 'ecod-demo-v1';

export async function loadData() {
  if (!cloud) {
    currentRole = 'admin';
    const stored = localStorage.getItem(STORAGE);
    if (!stored) return makeSeed();
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

  currentRole = 'viewer';
  const supabase = await getSupabase();
  const data = emptyData();
  const { data: membership, error: memberError } = await supabase
    .from('memberships')
    .select('workspace_id,role')
    .maybeSingle();
  if (memberError) throw memberError;
  if (!membership)
    throw new Error(
      'Your account has not been assigned to a workspace. Ask your administrator to add your workspace membership.',
    );
  currentRole = ['admin', 'recruiter', 'viewer'].includes(membership.role)
    ? membership.role
    : 'viewer';
  currentWorkspaceId = membership.workspace_id || '';
  await Promise.all(
    TABLES.map(async (table) => {
      let from = 0;
      while (true) {
        const { data: rows, error } = await supabase
          .from(table)
          .select('*')
          .order('id')
          .range(from, from + 999);
        if (error) throw error;
        data[table].push(...rows);
        if (rows.length < 1000) break;
        from += 1000;
      }
    }),
  );
  return normalizeData(data);
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

export async function saveRows(table, rows, current) {
  if (cloud) {
    const supabase = await getSupabase();
    const { data, error } = await supabase.from(table).upsert(rows).select();
    if (error) throw error;
    const { data: recentHistory } = await supabase
      .from('history')
      .select('*')
      .order('date', { ascending: false })
      .limit(historyRefreshLimit(data.length));
    return {
      rows: data,
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
  const next = {
    ...current,
    [table]: [...rows, ...current[table].filter((r) => !rows.some((n) => n.id === r.id))],
    history: [...history, ...current.history],
  };
  localStorage.setItem(STORAGE, JSON.stringify(next));
  return { rows, history: next.history };
}

/**
 * Delete rows. Only tables whose DELETE policy grants editors the right are permitted here —
 * repository records are never deletable from the product, because history and audit depend on
 * them existing. A saved report is disposable metadata, so it is.
 */
export const DELETABLE_TABLES = ['reports'];

export async function deleteRows(table, ids, current) {
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
  return makeSeed();
}
