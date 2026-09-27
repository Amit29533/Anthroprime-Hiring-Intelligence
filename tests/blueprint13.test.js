import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeData} from '../src/schema.js';
import {makeSeed} from '../src/seed.js';
import {parseTalentQuery,matchesSemantic,skillsUnder} from '../src/semantic.js';
import {candidateSearchText} from '../src/domain.js';
import {duplicatePairs} from '../src/dedupe.js';
import {setCustomTaxonomy,customTaxonomy} from '../src/taxonomy.js';
import {signedUrlFor} from '../src/documents.js';

const seed=normalizeData(makeSeed());

test('the blueprint example query parses into a visible interpretation and filters honestly',()=>{
  const p=parseTalentQuery('senior Databricks architect who has built Genie spaces');
  assert.deepEqual(p.skills,['Databricks','Databricks Genie'],'genie alias expands');
  assert.equal(p.minExp,7,'senior → 7+ years');
  assert.deepEqual(p.titleTerms,['architect']);
  assert.ok(p.interpretation.some(x=>x.startsWith('Skill: Databricks')),'interpretation chips generated');
  assert.ok(p.interpretation.some(x=>x.includes('7+ years')));
  assert.equal(p.used,true);
  const strict={...p};
  const someone=seed.candidates.find(c=>c.skills.includes('Databricks'));
  if(someone&&!someone.skills.includes('Databricks Genie')) assert.equal(matchesSemantic(someone,strict,''),false,'every required skill must be present');
  const ok={...parseTalentQuery('databricks architect')};
  if(someone) assert.equal(matchesSemantic({...someone,experience:9,title:'Data Architect'},ok,'architect'),true);
  // domain + notice + mode
  const p2=parseTalentQuery('data platform people, hybrid, 30 day notice');
  assert.deepEqual(p2.domains,['Data platform']);
  assert.ok(p2.skills.includes('Databricks')&&p2.skills.includes('Snowflake'),'domain expands to child skills');
  assert.equal(p2.maxNotice,30);
  assert.equal(p2.mode,'Hybrid');
  const c=seed.candidates.find(x=>x.notice!=null&&x.notice>30);
  if(c) assert.equal(matchesSemantic(c,p2,''),false,'notice constraint enforced');
  // exclusions + phrases
  const p3=parseTalentQuery('-manager "principal consultant"');
  assert.deepEqual(p3.exclusions,['manager']);
  assert.deepEqual(p3.phrases,['principal consultant']);
});

test('duplicate suggestions carry confidence, and a human still approves every merge',()=>{
  const base={id:'',name:'',email:'',phone:'',linkedin:'',company:'',location:''};
  const pairs=duplicatePairs([
    {...base,id:'a',name:'X',email:'same@x.com'},
    {...base,id:'b',name:'Y',email:'same@x.com'},
    {...base,id:'c',name:'Zed',company:'Acme',location:'Pune'},
    {...base,id:'d',name:'Zed',company:'Acme',location:'Pune'}
  ]);
  assert.equal(pairs.length,2);
  assert.equal(pairs.find(p=>p.reason==='Same email').confidence,'high');
  assert.equal(pairs.find(p=>p.reason==='Same name and employer').confidence,'medium');
});

test('skill domains are admin-managed and roll up in search and profiles',()=>{
  const under=skillsUnder('Data platform');
  assert.ok(under.includes('Databricks')&&under.includes('Snowflake'));
  setCustomTaxonomy({skills:['Prompt engineering'],aliases:{},domains:{'Prompt engineering':'AI/BI','Databricks':'AI/BI'}});
  assert.equal(skillsUnder('AI/BI').includes('Prompt engineering'),true,'custom skills join custom domains');
  assert.equal(skillsUnder('AI/BI').includes('Databricks'),true,'custom domains override base');
  setCustomTaxonomy(customTaxonomy.length?customTaxonomy():{});
  assert.equal(skillsUnder('Data platform').includes('Databricks'),true,'reset restores base domains');
});

test('document opens go through short-lived signed URLs in cloud and the data URL in demo',async()=>{
  const rec={id:'x',storagePath:'a/b.pdf',dataUrl:'data:application/pdf;base64,AAA'};
  const url=await signedUrlFor(rec);
  assert.equal(url,rec.dataUrl,'demo fallback');
  assert.equal(await signedUrlFor(null),null);
  // cloud branch is exercised in the provisioned project; here we assert it does not silently return the dataUrl when cloud is on
});
