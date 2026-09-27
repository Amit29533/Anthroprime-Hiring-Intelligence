import Papa from 'papaparse';
import {duplicate,skillList,today,uid,validateCandidate} from './domain.js';
export const IMPORT_FIELDS=['name','email','phone','title','company','location','experience','relevantExperience','notice','current','expected','skills','mode','status','source'];
export function readCSV(text){
 const result=Papa.parse(text,{header:true,skipEmptyLines:'greedy',transformHeader:h=>h.trim().replace(/^\uFEFF/,'')});
 if(result.errors.length)throw new Error(`CSV error: ${result.errors[0].message}`);
 if(result.data.length>5000)throw new Error('Import up to 5,000 rows per file. Split larger files into smaller batches.');
 if(!result.meta.fields?.length||!result.data.length)throw new Error('Include a header row and at least one candidate.');
 return {rows:result.data,headers:result.meta.fields};
}
export function previewImport(raw,mapping,existing){
 const accepted=[];
 return raw.map((row,index)=>{
  const c=Object.fromEntries(IMPORT_FIELDS.map(f=>[f,String(row[mapping[f]]??'').trim()]));
  c.id=uid();c.skills=skillList(c.skills);c.created=today();c.verified=today();c.owner='Recruiter';c.summary='';c.linkedin='';c.source=c.source||'CSV import';c.status=c.status||'Assessing';c.mode=c.mode||'Flexible';c.email=c.email.toLowerCase();
  for(const k of ['experience','relevantExperience','notice','current','expected'])c[k]=c[k]===''?null:Number(c[k]);
  let error=validateCandidate(c);
  if(!error&&!['Ready','Near-ready','Assessing','Unavailable'].includes(c.status))error='Status must be Ready, Near-ready, Assessing or Unavailable.';
  if(!error&&!['Remote','Hybrid','Onsite','Flexible'].includes(c.mode))error='Mode must be Remote, Hybrid, Onsite or Flexible.';
  const dupe=duplicate(c,[...existing,...accepted]);
  if(!error&&dupe)error=`Duplicate of ${dupe.name}; skipped.`;
  if(!error)accepted.push(c);
  return {row:index+2,candidate:c,error};
 });
}
