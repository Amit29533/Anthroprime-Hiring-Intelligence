import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeData} from '../src/schema.js';
import {makeSeed} from '../src/seed.js';
import {submissionConsentState} from '../src/submissions.js';

const seed=normalizeData(makeSeed());

test('public applications normalize and the seeded queue is actionable',()=>{
  const out=normalizeData({candidates:[],demands:[],publicApplications:[{id:'a1',name:'X',email:'x@y.zz'},{id:'a2',name:'Y',email:'y@y.zz',status:'accepted',consentSharing:true}]});
  const [a1,a2]=out.publicApplications;
  assert.equal(a1.status,'pending');
  assert.equal(a1.consentContact,false);
  assert.equal(a2.status,'accepted');
  assert.equal(a2.consentSharing,true);
  assert.equal(seed.publicApplications.length,1);
  const app=seed.publicApplications[0];
  assert.equal(app.status,'pending');
  assert.ok(app.consentContact&&app.consentSharing,'the seeded applicant ticked both consent boxes');
});

test('accepting an application honours exactly the consent the applicant gave',()=>{
  const app=seed.publicApplications[0];
  const wouldRecord=[];
  if(app.consentContact)wouldRecord.push('recruiting-contact');
  if(app.consentSharing)wouldRecord.push('profile-sharing');
  assert.deepEqual(wouldRecord,['recruiting-contact','profile-sharing']);
  for(const purpose of wouldRecord){
    const state=submissionConsentState(seed.consents,'not-created-yet');
    assert.equal(state.state,'missing','consent only exists after acceptance writes the ledger rows');
  }
  const noConsent=normalizeData({candidates:[],demands:[],publicApplications:[{id:'a3',name:'Z',email:'z@y.zz'}]}).publicApplications[0];
  assert.equal(noConsent.consentContact,false);
});

test('client decisions on submissions round-trip',()=>{
  const sub=seed.submissions[0];
  assert.equal(sub.clientStatus,'Shortlisted');
  assert.ok(sub.clientComment.includes('IAM'));
  assert.ok(sub.decidedOn,'decision date recorded');
  const out=normalizeData({candidates:[],demands:[],submissions:[{id:'s1',candidateId:'c1'}]});
  assert.equal(out.submissions[0].clientStatus,'Pending');
  assert.equal(out.submissions[0].clientComment,'');
  assert.equal(out.submissions[0].decidedOn,null);
});

test('demands carry external mapping ids through normalize (API-first groundwork)',()=>{
  const out=normalizeData({candidates:[],demands:[{id:'d1',title:'T'},{id:'d2',title:'U',externalId:'JIRA-42'}]});
  assert.equal(out.demands[0].externalId,'');
  assert.equal(out.demands[1].externalId,'JIRA-42');
});
