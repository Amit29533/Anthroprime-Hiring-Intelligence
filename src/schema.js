// Shared data shape for demo and cloud modes, kept dependency-free so tests can import it.
import { setCustomTaxonomy } from './taxonomy.js';
import { setStageLabels } from './domain.js';
export const TABLES = ['candidates','demands','considerations','assessments','notes','enrichment','history','employmentHistory','compensationHistory','availabilityHistory','auditEvents','documents','taxonomy','demandCommercials','settings','consents','interviews'];
export const emptyData = () => Object.fromEntries(TABLES.map(t=>[t,[]]));
// Fill in fields/tables added after a stored (or cloud) snapshot was written, apply the saved
// taxonomy extensions, and hide profiles merged into another record.
export function normalizeData(data){
 const out = emptyData();
 for(const t of TABLES) out[t] = Array.isArray(data?.[t]) ? data[t] : [];
 out.candidates = out.candidates.filter(c=>!c.mergedInto);
 for(const c of out.candidates){ c.skills = c.skills||[]; c.skillsDetail = Array.isArray(c.skillsDetail)?c.skillsDetail:[]; c.engagement = c.engagement||''; c.earliestStart = c.earliestStart||null; c.activeStatus = c.activeStatus||'Active'; c.timezone = c.timezone||''; c.preferredLocations = c.preferredLocations||''; c.nextAction = c.nextAction||''; c.externalId = c.externalId||''; }
 for(const d of out.demands){ d.niceToHave = d.niceToHave||[]; d.engagementType = d.engagementType||'Any'; d.minProficiency = d.minProficiency||'Working'; d.skillMinimums = d.skillMinimums||{}; d.stageSet = Array.isArray(d.stageSet)?d.stageSet:[]; d.tags = Array.isArray(d.tags)?d.tags:[]; }
 for(const c of out.candidates){ c.tags = Array.isArray(c.tags)?c.tags:[]; }
 out.interviews = out.interviews||[];
 for(const iv of out.interviews){ iv.round = iv.round||'Round 1'; iv.mode = iv.mode||'Video'; iv.status = iv.status||'Scheduled'; iv.interviewers = Array.isArray(iv.interviewers)?iv.interviewers:[]; iv.feedback = iv.feedback&&typeof iv.feedback==='object'&&!Array.isArray(iv.feedback)?iv.feedback:{}; iv.notes = iv.notes||''; iv.durationMins = iv.durationMins||45; }
 const tax = out.taxonomy.find(r=>r&&r.id==='workspace');
 setCustomTaxonomy((tax&&tax.custom)||{});
 const st = out.settings.find(r=>r&&r.id==='workspace');
 setStageLabels((st&&st.custom&&st.custom.stageLabels)||{});
 return out;
}
