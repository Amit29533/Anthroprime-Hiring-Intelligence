import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeData,TABLES} from '../src/schema.js';
import {makeSeed} from '../src/seed.js';
import {criteriaFor,thresholdFor,overallOf,meetsBar,templatesFor,fillTemplate,DEFAULT_CRITERIA,DEFAULT_THRESHOLD,RECOMMENDATIONS} from '../src/feedback.js';
import {interviewAnalytics} from '../src/analytics.js';

const seed=normalizeData(makeSeed());

test('interviews are a first-class table with normalize defaults',()=>{
  assert.ok(TABLES.includes('interviews'),'TABLES includes interviews');
  const out=normalizeData({candidates:[],demands:[],interviews:[{id:'i1',candidateId:'c1',scheduledAt:'2026-10-01T10:00:00Z',interviewers:'not-an-array',feedback:'broken'},{id:'i2',candidateId:'c1',scheduledAt:'2026-10-02T10:00:00Z',round:'Final',mode:'Onsite',status:'Completed',durationMins:90,interviewers:['A'],feedback:{X:4},notes:'n'}]});
  const [a,b]=out.interviews;
  assert.equal(a.round,'Round 1');assert.equal(a.mode,'Video');assert.equal(a.status,'Scheduled');
  assert.deepEqual(a.interviewers,[]);assert.deepEqual(a.feedback,{});assert.equal(a.durationMins,45);
  assert.equal(b.round,'Final');assert.deepEqual(b.feedback,{X:4});
});

test('feedback model: criteria, bar, overall and template substitution',()=>{
  assert.deepEqual(criteriaFor([]),DEFAULT_CRITERIA,'defaults without settings');
  assert.deepEqual(criteriaFor([{id:'workspace',custom:{feedbackCriteria:['Craft','Delivery']}}]),['Craft','Delivery']);
  assert.equal(thresholdFor([]),DEFAULT_THRESHOLD);
  assert.equal(thresholdFor([{id:'workspace',custom:{feedbackThreshold:4}}]),4);
  assert.equal(overallOf({'Technical depth':4,Communication:4,'Problem solving':5,'Culture add':4}),4.3);
  assert.equal(overallOf({}),null);
  assert.equal(meetsBar(4.3,3.5),true);
  assert.equal(meetsBar(3.2,3.5),false);
  assert.ok(RECOMMENDATIONS.includes('Strong hire')&&RECOMMENDATIONS.includes('No hire'));
  assert.equal(templatesFor([]).length,3,'three seeded templates');
  const ctx={name:'Aarav',demand:'Senior Databricks Architect (Meridian)',round:'Round 2',mode:'Video',date:'Mon 29 Sep',time:'11:00'};
  assert.equal(fillTemplate('Hi {name}, {round} for {demand} on {date} at {time}. {missing} stays.',ctx),
    'Hi Aarav, Round 2 for Senior Databricks Architect (Meridian) on Mon 29 Sep at 11:00.  stays.');
});

test('interview analytics summarise the seeded panel history',()=>{
  const s=interviewAnalytics(seed.interviews,thresholdFor(seed.settings));
  assert.equal(s.upcoming,1);
  assert.equal(s.completed,2);
  assert.equal(s.cancelled,1);
  assert.equal(s.noShow,1);
  assert.equal(s.recommended,1);
  assert.equal(s.recommendRate,50);
  assert.equal(s.avgOverall,3.8);
  assert.equal(s.aboveBar,1);
  assert.deepEqual(s.byRec,{Hire:1,Hold:1});
});

test('candidates and demands carry tags through normalize and the seed',()=>{
  const out=normalizeData({candidates:[{id:'c1',name:'A',skills:[]}],demands:[{id:'d1',title:'T',tags:'broken'}]});
  assert.deepEqual(out.candidates[0].tags,[]);
  assert.deepEqual(out.demands[0].tags,[]);
  assert.deepEqual(seed.candidates[0].tags,['Client favourite','Architecture']);
  assert.deepEqual(seed.demands[0].tags,['Data platform','High priority']);
  const tagged=seed.candidates.filter(c=>(c.tags||[]).includes('Client favourite'));
  assert.equal(tagged.length,2,'two seeded client favourites');
});
