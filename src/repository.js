import { createClient } from '@supabase/supabase-js';
import { makeSeed } from './seed.js';
import {uid} from './domain.js';
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const cloud = Boolean(url && key);
export const supabase = cloud ? createClient(url, key) : null;
export const TABLES = ['candidates','demands','considerations','assessments','notes','enrichment','history'];
export const emptyData = () => Object.fromEntries(TABLES.map(t=>[t,[]]));
const STORAGE = 'ecod-demo-v1';
export async function loadData() {
 if (!cloud) {
  const stored = localStorage.getItem(STORAGE);
  if (!stored) return makeSeed();
  const parsed = JSON.parse(stored);
  if (!TABLES.every(t=>Array.isArray(parsed[t]))) throw new Error('Saved demo data is invalid. Export or clear this site’s browser storage before restarting.');
  return parsed;
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
 return data;
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
export async function resetDemo(){ localStorage.removeItem(STORAGE); return makeSeed(); }
