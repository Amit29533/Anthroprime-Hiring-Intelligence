import test from 'node:test';
import assert from 'node:assert/strict';
import {stageLabel,setStageLabels,stageLabelsMap,candidateSearchText} from '../src/domain.js';
import {retentionDue,anonymizeCandidate} from '../src/quality.js';
import {timeToReady,sourceConversion,rediscoveryRate,marginPct} from '../src/analytics.js';
import {normalizeData} from '../src/schema.js';
import {makeSeed} from '../src/seed.js';

test('stage labels default to canonical names and honour workspace overrides',()=>{
 setStageLabels({});
 assert.equal(stageLabel('Identified'),'Identified');
 setStageLabels({Identified:'Sourced','Interview':'Client interview'});
 assert.equal(stageLabel('Identified'),'Sourced');
 assert.equal(stageLabel('Offer'),'Offer','unmapped stages pass through');
 assert.deepEqual(Object.keys(stageLabelsMap()).sort(),['Identified','Interview']);
 setStageLabels({});
});

test('normalizeData applies saved stage labels from the settings row',()=>{
 const base=makeSeed();
 const data=normalizeData({...base,settings:[{id:'workspace',custom:{stageLabels:{Contacted:'Reached'},retentionMonths:9}}]});
 assert.equal(stageLabel('Contacted'),'Reached');
 assert.equal(stageLabel('Assessed'),'Assessed');
 setStageLabels({});
 const plain=normalizeData(base);
 assert.equal(stageLabel('Contacted'),'Contacted','seeds without labels reset overrides');
});

test('repository search text includes summary, skills and extracted CV text',()=>{
 const c={name:'Ada',title:'Engineer',company:'Corp',location:'Pune',email:'ada@x.com',summary:'Kafka streams specialist',skills:['Python'],id:'c1'};
 const docs=[{candidateId:'c1',removed:false,extracted:'Built Genie spaces on Databricks lakehouse'},{candidateId:'c1',removed:true,extracted:'should be ignored'},{candidateId:'other',removed:false,extracted:'not this candidate'}];
 const text=candidateSearchText(c,docs);
 assert.ok(text.includes('kafka streams specialist'),'summary searchable');
 assert.ok(text.includes('genie spaces'),'extracted CV text searchable');
 assert.ok(!text.includes('should be ignored'),'removed documents excluded');
 assert.ok(!text.includes('not this candidate'),"other candidates' documents excluded");
 const bare=candidateSearchText(c,[]);
 assert.ok(bare.includes('ada@x.com'));
});

test('retention review queue respects the policy window and skips anonymized profiles',()=>{
 const todayStr='2026-09-27';
 const cands=[
  {id:'1',name:'Old',verified:'2024-06-01'},
  {id:'2',name:'Recent',verified:'2026-09-01'},
  {id:'3',name:'Already anonymized',verified:'2024-01-01',anonymized:true},
  {id:'4',name:'Boundary',verified:'2026-09-27'}
 ];
 const due12=retentionDue(cands,12,todayStr);
 assert.deepEqual(due12.map(c=>c.id),['1']);
 const due3=retentionDue(cands,3,todayStr);
 assert.deepEqual(due3.map(c=>c.id),['1']);
});

test('anonymization strips identity and contact while keeping the record usable',()=>{
 const c={id:'x',name:'Rahul Verma',email:'rahul@x.com',phone:'98765',summary:'notes',linkedin:'https://linkedin.com/in/rv',title:'Lead',company:'Cognizant',status:'Ready',skills:['Databricks'],experience:11};
 const a=anonymizeCandidate(c);
 assert.equal(a.name,'Anonymized');
 assert.equal(a.email,'');
 assert.equal(a.phone,'');
 assert.equal(a.summary,'');
 assert.equal(a.linkedin,'');
 assert.equal(a.status,'Unavailable');
 assert.equal(a.anonymized,true);
 assert.deepEqual(a.skills,['Databricks'],'aggregate value retained');
 assert.equal(a.experience,11);
});

test('conversion metrics compute from existing records only',()=>{
 const candidates=[
  {id:'1',status:'Ready',created:'2026-01-01',source:'Referral'},
  {id:'2',status:'Ready',created:'2026-02-01',source:'Referral'},
  {id:'3',status:'Assessing',created:'2026-03-01',source:'LinkedIn'}
 ];
 const assessments=[{candidateId:'1',date:'2026-02-11'},{candidateId:'2',date:'2026-02-20'},{candidateId:'3',date:'2026-03-05'}];
 assert.equal(timeToReady(candidates,assessments),30,'(41 days + 19 days) / 2');
 const conv=sourceConversion(candidates);
 const referral=conv.find(x=>x.source==='Referral');
 assert.equal(referral.total,2);
 assert.equal(referral.ready,2);
 assert.equal(referral.pct,100);
 const redisc=rediscoveryRate([
  {candidateId:'1',demandId:'d1'},{candidateId:'1',demandId:'d2'},{candidateId:'2',demandId:'d1'}
 ]);
 assert.deepEqual(redisc,{multi:1,total:2,pct:50});
 assert.equal(rediscoveryRate([]).pct,0);
});

test('commercial margin is computed against the client budget',()=>{
 assert.equal(marginPct(40,30),25);
 assert.equal(marginPct(40,null),null);
 assert.equal(marginPct(0,10),null);
 assert.equal(marginPct(35,50),-43,'over-cost is visible, never hidden');
});

test('seed ships settings and admin-only commercials for the demo',()=>{
 const data=makeSeed();
 assert.equal(data.settings[0].id,'workspace');
 assert.equal(data.settings[0].custom.retentionMonths,12);
 assert.equal(data.demandCommercials.length,1);
 assert.ok(data.demandCommercials[0].internalCost<data.demands[0].budget);
 const normalized=normalizeData(data);
 assert.equal(normalized.settings.length,1);
 assert.equal(normalized.demandCommercials.length,1);
});
