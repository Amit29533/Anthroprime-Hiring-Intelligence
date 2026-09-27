// Batch 10 — workflow automation rules (Zoho I-area groundwork).
// Rules are workspace records: when a trigger field on a candidate/demand/offer/interview
// enters a value (or just changes), ECOD applies the rule's actions — a task, a note, a
// tag, a next-action — and writes an audit event. Evaluation is pure and synchronous so
// it can be unit-tested; the App save path applies the resulting drafts.
export const AUTOMATION_TABLES=['candidates','demands','offers','interviews'];
export const TRIGGERS=[
 {table:'candidates',field:'stage',label:'Candidate · stage changes'},
 {table:'candidates',field:'status',label:'Candidate · status changes'},
 {table:'demands',field:'stage',label:'Demand · stage changes'},
 {table:'offers',field:'status',label:'Offer · status changes'},
 {table:'interviews',field:'recommendation',label:'Interview · recommendation recorded'},
];
export function ruleMatches(rule,table,before,after){
 if(!rule||rule.enabled===false||rule.triggerTable!==table)return false;
 const f=rule.triggerField,op=rule.op||'eq';
 const b=before?before[f]:undefined,a=after?after[f]:undefined;
 const changed=(b??null)!==(a??null);
 if(op==='changed')return changed&&a!=null&&a!=='';
 if(op==='eq')return changed&&a===rule.value;
 if(op==='neq')return changed&&a!==rule.value&&a!=null&&a!=='';
 return false;
}
export function actionsFor(rules,table,before,after){
 return (rules||[]).filter(r=>ruleMatches(r,table,before,after));
}
const plusDays=(base,n)=>{const d=new Date(`${base}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+Number(n||0));return d.toISOString().slice(0,10);};
// Turn matched rules into concrete row drafts. Pure: nothing is saved here.
export function buildActions(matched,{candidate=null,demand=null,actor='Automation',base=''}={}){
 const out={tasks:[],notes:[],tagUpdates:[],nextActions:[]};
 for(const rule of matched||[]){
  for(const act of Array.isArray(rule.actions)?rule.actions:[]){
   if(act.type==='task')out.tasks.push({id:crypto.randomUUID(),title:act.title||`Follow up: ${rule.name}`,due:plusDays(base,act.dueDays??1),done:false,owner:'',candidateId:candidate?.id||null,demandId:demand?.id||null,created:base});
   else if(act.type==='note')out.notes.push({id:crypto.randomUUID(),candidateId:candidate?.id||null,text:`${rule.name} — ${act.text||''}`.trim(),date:base,followUp:'',completed:false,author:actor});
   else if(act.type==='tag'&&candidate&&act.tag)out.tagUpdates.push({candidateId:candidate.id,tag:act.tag});
   else if(act.type==='nextAction'&&candidate&&act.text)out.nextActions.push({candidateId:candidate.id,text:act.text});
  }
 }
 return out;
}
export function describeRule(rule){
 const t=TRIGGERS.find(x=>x.table===rule.triggerTable&&x.field===rule.triggerField);
 const cond=rule.op==='changed'?'any change':rule.op==='neq'?`≠ ${rule.value}`:`= ${rule.value}`;
 return `${t?t.label:`${rule.triggerTable}.${rule.triggerField}`} · ${cond}`;
}
export function describeActions(rule){
 return (Array.isArray(rule.actions)?rule.actions:[]).map(a=>a.type==='task'?`Task: ${a.title||'follow-up'}`:a.type==='note'?'Note':a.type==='tag'?`Tag: ${a.tag||''}`:a.type==='nextAction'?`Next action: ${a.text||''}`:a.type).join(' + ');
}
