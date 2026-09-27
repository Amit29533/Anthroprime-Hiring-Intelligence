import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeData} from '../src/schema.js';
import {makeSeed} from '../src/seed.js';
import {renderTemplate,mergeContext,documentTemplatesFor,DEFAULT_DOCUMENT_TEMPLATES,MERGE_FIELD_CATALOG,dossierHtml} from '../src/templates.js';

const seed=normalizeData(makeSeed());

test('merge-field templates render recorded facts and surface typos',()=>{
  const offer=seed.offers.find(o=>o.status==='Sent');
  const cand=seed.candidates.find(c=>c.id===offer.candidateId);
  const demand=seed.demands.find(d=>d.id===offer.demandId);
  const letter=renderTemplate(documentTemplatesFor(seed.settings)[0].body,mergeContext({candidate:cand,offer,demand}));
  assert.ok(letter.includes(cand.name));
  assert.ok(letter.includes(offer.role));
  assert.ok(letter.includes('₹31 LPA')||letter.includes(`₹${offer.ctc} LPA`),'ctc formatted through money()');
  assert.ok(/\d{1,2} \w+ 20\d\d/.test(letter),'joining date rendered as a long date');
  assert.ok(!letter.includes('{{'),'all known tokens resolved');
  const typo=renderTemplate('Hi {{Candidate.nam}}',mergeContext({candidate:cand}));
  assert.ok(typo.includes('{{Candidate.nam}}'),'unknown tokens stay visible for fixing');
  assert.ok(MERGE_FIELD_CATALOG.some(([g,f])=>g==='Candidate'&&f==='name'));
});

test('workspace templates override defaults and survive normalizeData',()=>{
  assert.equal(documentTemplatesFor(seed.settings)[0].name,'Offer letter','seeded templates win');
  assert.equal(documentTemplatesFor([])[0].name,DEFAULT_DOCUMENT_TEMPLATES[0].name,'defaults without settings');
  assert.equal(documentTemplatesFor([{id:'workspace',custom:{}}])[0].name,DEFAULT_DOCUMENT_TEMPLATES[0].name,'defaults with empty custom');
  const custom=[{id:'workspace',custom:{documentTemplates:[{id:'x',name:'Custom',body:'Hello {{Candidate.name}}'}]}}];
  assert.equal(documentTemplatesFor(custom)[0].name,'Custom');
});

test('dossier export is a printable, escaped, provenance-stamped document',()=>{
  const c=seed.candidates[0];
  const html=dossierHtml(c,seed,'AnthroPrime');
  assert.ok(html.includes(c.name));
  assert.ok(html.includes('audit trail'),'provenance stamp present');
  assert.ok(html.includes('<!doctype html>'));
  assert.ok(html.includes('Consents')||html.includes('consents'.length? 'Consents':''),'consent section present');
  const sneaky=dossierHtml({...c,name:'<script>alert(1)</script>',summary:'<img src=x onerror=alert(2)>'},seed);
  assert.ok(!sneaky.includes('<script>'),'script tags escaped');
  assert.ok(sneaky.includes('&lt;script&gt;'));
  assert.ok(!dossierHtml(c,seed).includes('undefined'),'no undefined leaking into the document');
});
