import { createClient } from '@supabase/supabase-js';
import { makeSeed } from './seed.js';
import {uid} from './domain.js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const cloud = Boolean(url && key);
export const supabase = cloud ? createClient(url, key) : null;
export const TABLES = ['candidates','demands','considerations','assessments','notes','enrichment','history','employmentHistory','compensationHistory','availabilityHistory','auditEvents'];
export const emptyData = () => Object.fromEntries(TABLES.map(t=>[t,[]]));
const STORAGE = 'ecod-demo-v1';
// Fill in fields/tables added after a stored (or cloud) snapshot was written, so old data keeps loading.
export function normalizeData(data){
 const out = emptyData();
 for(const t of TABLES) out[t] = Array.isArray(data?.[t]) ? data[t] : [];
 for(const c of out.candidates){ c.skills = c.skills||[]; c.skillsDetail = Array.isArray(c.skillsDetail)?c.skillsDetail:[]; c.engagement = c.engagement||''; c.earliestStart = c.earliestStart||null; c.activeStatus = c.activeStatus||'Active'; }
 for(const d of out.demands){ d.niceToHave = d.niceToHave||[]; d.engagementType = d.engagementType||'Any'; d.minProficiency = d.minProficiency||'Working'; d.skillMinimums = d.skillMinimums||{}; }
 return out;
}
export async function loadData() {
 if (!cloud) {
  const stored = localStorage.getItem(STORAGE);
  if (!stored) return makeSeed();
  let parsed;
  try { parsed = JSON.parse(stored); } catch { throw new Error('Saved demo data is corrupt. Reset demo data from Workspace settings, or clear this site’s browser storage.'); }
  return normalizeData(parsed);
 }
 const data = emptyData();
 const {data: membership,error:memberError}=await supabase.from('memberships').select('workspace_id,role').maybeSingle();
 if(memberError)throw memberError;
 if(!membership)throw new Error('Your account has not been assigned to a workspace. Ask your administrator to add your workspace membership.');
 await Promise.all(TABLES.map(async t=>{
  let from=0;
  while(true){
   const {data: rows,error}=await supabase.from(t).select('*').order('id').range(from,from+999);
   if(error) throw error;
   data[t].push(...rows);
   if(rows.length<1000)break;
   from+=1000;
  }
 }));
 return normalizeData(data);
}
export async function saveRows(table, rows, current) {
 if(cloud) {
  const {data,error}=await supabase.from(table).upsert(rows).select();
  if(error)throw error;
  const {data:history}=await supabase.from('history').select('*').order('date',{ascending:false}).limit(1000);
  return {rows:data,history:history||current.history};
 }
 const history=rows.map(row=>({id:uid(),entityId:row.id,entityType:table,action:current[table].some(r=>r.id===row.id)?`${table==='candidates'?'Profile':table} updated`:`${table==='candidates'?'Profile':table} created`,date:new Date().toISOString(),actor:'Demo recruiter',snapshot:current[table].find(r=>r.id===row.id)||null}));
 const next={...current,[table]:[...rows,...current[table].filter(r=>!rows.some(n=>n.id===r.id))],history:[...history,...current.history]};
 localStorage.setItem(STORAGE,JSON.stringify(next));
 return {rows,history:next.history};
}
// Blueprint §12 — view/export audit trail. Silent: no toast, errors swallowed by the caller.
export async function logAuditEvent(event, current) {
 const row={id:uid(),entityType:event.entityType||'',entityId:event.entityId||null,action:event.action||'',detail:event.detail||'',actor:cloud?'Team member':'Demo recruiter',date:new Date().toISOString()};
 if(cloud){const{error}=await supabase.from('auditEvents').insert(row);if(error)throw error;}
 const next={...current,auditEvents:[row,...current.auditEvents].slice(0,500)};
 if(!cloud)localStorage.setItem(STORAGE,JSON.stringify(next));
 return {row,data:next};
}
export async function resetDemo(){ localStorage.removeItem(STORAGE); return makeSeed(); }
