// Shared data shape for demo and cloud modes, kept dependency-free so tests can import it.
import { setCustomTaxonomy } from './taxonomy.js';
export const TABLES = ['candidates','demands','considerations','assessments','notes','enrichment','history','employmentHistory','compensationHistory','availabilityHistory','auditEvents','documents','taxonomy'];
export const emptyData = () => Object.fromEntries(TABLES.map(t=>[t,[]]));
// Fill in fields/tables added after a stored (or cloud) snapshot was written, apply the saved
// taxonomy extensions, and hide profiles merged into another record.
export function normalizeData(data){
 const out = emptyData();
 for(const t of TABLES) out[t] = Array.isArray(data?.[t]) ? data[t] : [];
 out.candidates = out.candidates.filter(c=>!c.mergedInto);
 for(const c of out.candidates){ c.skills = c.skills||[]; c.skillsDetail = Array.isArray(c.skillsDetail)?c.skillsDetail:[]; c.engagement = c.engagement||''; c.earliestStart = c.earliestStart||null; c.activeStatus = c.activeStatus||'Active'; }
 for(const d of out.demands){ d.niceToHave = d.niceToHave||[]; d.engagementType = d.engagementType||'Any'; d.minProficiency = d.minProficiency||'Working'; d.skillMinimums = d.skillMinimums||{}; }
 const tax = out.taxonomy.find(r=>r&&r.id==='workspace');
 setCustomTaxonomy((tax&&tax.custom)||{});
 return out;
}
