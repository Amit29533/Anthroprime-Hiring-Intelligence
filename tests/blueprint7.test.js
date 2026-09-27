import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeData} from '../src/schema.js';
import {makeSeed} from '../src/seed.js';
import {buildSubmissionPack,submissionConsentState,submissionMailHref,SUBMISSION_METHODS} from '../src/submissions.js';
import {tokenize,buildVectors,cosine,similarCandidates,sharedSkills,rankByRelevance} from '../src/semantic.js';

const seed=normalizeData(makeSeed());

test('semantic: TF-IDF vectors rank same-domain talent above unrelated profiles',()=>{
  const a=seed.candidates.find(c=>c.skills.includes('Databricks'));
  const sim=similarCandidates(a,seed.candidates,seed.documents,5);
  assert.ok(sim.length>=3,'similar candidates exist');
  assert.ok(sim[0].score>sim[sim.length-1].score,'scores are ordered');
  const databricksish=sim.filter(r=>r.candidate.skills.includes('Databricks')).length;
  assert.ok(databricksish>=1,'same-skill profiles surface as similar');
  const unrelated=seed.candidates.find(c=>!c.skills.includes('Databricks')&&!c.skills.includes('Apache Spark'));
  const direct=similarCandidates(a,[a,unrelated],seed.documents,5);
  if(direct.length===2)assert.ok(direct[0].score>=direct[1].score,'related outranks unrelated');
  assert.equal(similarCandidates(null,seed.candidates,[],3).length,0);
  const assertShared=sharedSkills(a,sim[0].candidate);
  assert.ok(Array.isArray(assertShared));
});

test('semantic: query ranking orders repository rows by cosine to the query',()=>{
  const rows=seed.candidates.slice(0,10);
  const ranked=rankByRelevance('databricks lakehouse unity catalog',rows,seed.documents);
  assert.equal(ranked.length,rows.length,'ranking preserves the filtered set');
  const withSkill=ranked.findIndex(c=>c.skills.includes('Databricks'));
  assert.equal(withSkill,0,'a Databricks profile ranks first for a Databricks query');
  assert.deepEqual(rankByRelevance('',rows,seed.documents),rows,'empty query keeps order');
  assert.ok(tokenize('The Databricks-and-SQL expert, 5 years').includes('databricks'));
  const {vec,idf}=buildVectors(rows,seed.documents);
  const self=vec.get(rows[0].id);
  assert.equal(Math.round(cosine(self,self)*100),100,'self-similarity is 100%');
  assert.ok(idf.size>10);
});

test('submissions: pack compiles honest facts, never internal data, gated on consent',()=>{
  const candidate=seed.candidates.find(c=>c.email&&c.current);
  const demand=seed.demands.find(d=>d.status==='Open');
  const pack=buildSubmissionPack(candidate,demand,seed);
  assert.ok(pack.packText.includes(candidate.name)&&pack.packText.includes(demand.title));
  assert.ok(pack.packText.toLowerCase().includes('expected'),'expected CTC is client-facing');
  assert.ok(!pack.packText.includes('Current CTC'),'current CTC label never appears in the pack');
  assert.ok(!pack.packText.includes('\u20B9'+candidate.current+' '),'current CTC value never appears in the pack');
  assert.ok(!pack.packText.includes(candidate.email||'~~~')&&!pack.packText.includes(candidate.phone||'~~~'),'contact details stay internal');
  assert.ok(pack.packText.includes('Consent:'));
  assert.deepEqual(SUBMISSION_METHODS,['Email','Portal','Manual']);
  const href=submissionMailHref(pack,candidate,demand,'client@example.com');
  assert.ok(href.startsWith('mailto:client@example.com'));
});

test('submissions: consent states drive the gate',()=>{
  const shared=seed.candidates[4]; // seeded profile-sharing granted
  const ok=submissionConsentState(seed.consents,shared.id);
  assert.equal(ok.ok,true);
  assert.equal(ok.state,'granted');
  const nobody=submissionConsentState(seed.consents,'no-such-candidate');
  assert.equal(nobody.ok,false);
  assert.equal(nobody.state,'missing');
  // a revoked MARKETING consent must not block profile sharing — the ledger is purpose-scoped
  const marketingRevoked=seed.consents.find(c=>c.status==='revoked'&&c.purpose==='marketing');
  assert.equal(submissionConsentState(seed.consents,marketingRevoked.candidateId).state,'missing');
  // a revoked profile-sharing consent does block
  const blocked=submissionConsentState([{candidateId:'cx',purpose:'profile-sharing',status:'revoked',date:'2026-09-01'}],'cx');
  assert.equal(blocked.ok,false);
  assert.equal(blocked.state,'revoked');
});

test('demands carry owner and business unit; seed submissions exist',()=>{
  const out=normalizeData({candidates:[],demands:[{id:'d1',title:'T'},{id:'d2',title:'U',owner:'Priya',businessUnit:'Cybersecurity'}]});
  assert.equal(out.demands[0].owner,'');
  assert.equal(out.demands[1].owner,'Priya');
  assert.equal(out.demands[1].businessUnit,'Cybersecurity');
  assert.ok(seed.demands[0].owner&&seed.demands[0].businessUnit,'seed demands have owners');
  assert.equal(seed.submissions.length,1);
  assert.equal(seed.submissions[0].method,'Email');
});
