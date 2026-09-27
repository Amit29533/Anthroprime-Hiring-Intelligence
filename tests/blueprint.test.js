import test from 'node:test';
import assert from 'node:assert/strict';
import {matchCandidate,duplicate,skillList} from '../src/domain.js';
import {captureChanges} from '../src/history.js';
import {qualityQueues} from '../src/quality.js';
import {meetsLevel,skillDetail,proficiencyRank,PROFICIENCY_LEVELS} from '../src/taxonomy.js';
import {readCSV,previewImport,IMPORT_FIELDS} from '../src/import.js';
import {makeSeed} from '../src/seed.js';
const data=makeSeed(),candidate=data.candidates[0],demand=data.demands[0];

test('proficiency scale orders levels and gates matching',()=>{
 assert.deepEqual(PROFICIENCY_LEVELS,['Exposure','Working','Proficient','Advanced','Expert']);
 assert.equal(proficiencyRank('Working'),1);
 assert.equal(meetsLevel('Working','Working'),true);
 assert.equal(meetsLevel('Exposure','Working'),false);
 assert.equal(meetsLevel('Expert','Proficient'),true);
 assert.equal(meetsLevel(undefined,'Working'),true,'legacy candidates default to Working');
});

test('legacy candidates without skillsDetail derive Working/Unverified rows',()=>{
 const rows=skillDetail({skills:['Python','SQL']});
 assert.deepEqual(rows.map(r=>[r.skill,r.proficiency,r.evidence,r.validated]),[['Python','Working','Unverified',false],['SQL','Working','Unverified',false]]);
 const explicit=skillDetail(candidate);
 assert.equal(explicit[0].validated,true,'explicit seed detail is preserved');
});

test('demand minimum proficiency gates must-have matching',()=>{
 const m=matchCandidate(candidate,{...demand,minProficiency:'Expert'},data.assessments);
 assert.equal(m.matched.length,0);
 assert.equal(m.scores.skills,0);
 assert.ok(m.blockers[0].startsWith('Missing '));
 const ok=matchCandidate(candidate,demand,data.assessments);
 assert.equal(ok.missing.length,0,'default Working minimum keeps baseline matching');
 assert.ok(ok.details.skills.includes('must-have skills'));
});

test('per-skill minimums override the demand default',()=>{
 const m=matchCandidate(candidate,{...demand,minProficiency:'Expert',skillMinimums:{'Databricks':'Advanced'}},[]);
 assert.ok(m.missing.includes('Databricks'));
 assert.ok(m.missing.includes('Unity Catalog'));
 assert.ok(!m.missing.includes('SQL'),'Working-level skill passes the Working default');
});

test('nice-to-have skills are reported but never scored as must-haves',()=>{
 const d={...demand,niceToHave:['Snowflake','Power BI']};
 const m=matchCandidate(candidate,d,data.assessments);
 assert.deepEqual(m.niceCoverage.matched,[]);
 assert.equal(m.niceCoverage.missing.length,2);
 const sneha=matchCandidate(data.candidates[3],d,data.assessments);
 assert.ok(sneha.niceCoverage.matched.includes('Snowflake'));
 assert.equal(sneha.blockers.filter(b=>b.includes('Snowflake')).length,0,'nice-to-have gaps are not hard failures');
});

test('engagement mismatch is a hard constraint; Any and unknown never block',()=>{
 const m=matchCandidate(data.candidates[2],demand,data.assessments);
 assert.ok(m.blockers.some(b=>b.startsWith('Engagement mismatch')),'C2H candidate vs Permanent demand');
 assert.ok(!m.eligible);
 const anyDemand=matchCandidate(data.candidates[2],{...demand,engagementType:'Any'},data.assessments);
 assert.ok(!anyDemand.blockers.some(b=>b.startsWith('Engagement mismatch')));
 const unknownEngagement=matchCandidate({...candidate,engagement:''},demand,data.assessments);
 assert.ok(!unknownEngagement.blockers.some(b=>b.startsWith('Engagement mismatch')));
});

test('duplicate detection now includes LinkedIn URLs (case-insensitive, trailing slash)',()=>{
 assert.equal(duplicate({...candidate,id:'new',linkedin:'HTTPS://WWW.LINKEDIN.COM/IN/AARAV-MEHTA-SAMPLE/'},data.candidates).id,candidate.id);
 assert.equal(duplicate({...candidate,id:'new',email:'other@example.com',linkedin:'https://www.linkedin.com/in/someone-else'},data.candidates),undefined);
});

test('captureChanges appends rows only for genuinely changed volatile facts',()=>{
 const next={...candidate,company:'Newco',expected:44};
 const out=captureChanges(candidate,next);
 assert.equal(out.employmentHistory.length,1);
 assert.equal(out.employmentHistory[0].company,'Newco');
 assert.deepEqual(out.compensationHistory.map(r=>r.kind),['expected']);
 assert.deepEqual(out.availabilityHistory,[]);
 const none=captureChanges(candidate,candidate);
 assert.deepEqual(none.employmentHistory,[]);
 assert.deepEqual(none.compensationHistory,[]);
 assert.deepEqual(none.availabilityHistory,[]);
 const availability=captureChanges(candidate,{...candidate,notice:0,earliestStart:'2026-10-15',activeStatus:'Passive'});
 assert.equal(availability.availabilityHistory.length,1);
 assert.equal(availability.availabilityHistory[0].status,'Passive');
});

test('quality queues classify profiles needing attention',()=>{
 const queues=qualityQueues({candidates:[
  {...candidate,email:'',phone:'',skillsDetail:[]},
  {...candidate,email:'a@b.com',phone:'9876543210',skillsDetail:[]},
  {...candidate,email:'a@b.com',phone:'9876543210',skillsDetail:[{skill:'SQL',validated:true}],expected:null}
 ]});
 const count=id=>queues.find(q=>q.id===id).candidates.length;
 assert.equal(count('no-email'),1);
 assert.equal(count('no-phone'),1);
 assert.equal(count('unverified-skills'),2);
 assert.equal(count('stale-comp'),1);
});

test('CSV import validates engagement types and defaults new fields',()=>{
 const csv=readCSV('name,email,skills,engagement\nGood Row,good@example.com,Python,Contract\nBad Row,bad@example.com,SQL,Freelance');
 const mapping=Object.fromEntries(IMPORT_FIELDS.map(f=>[f,f]));
 const preview=previewImport(csv.rows,mapping,[]);
 assert.equal(preview[0].candidate.engagement,'Contract');
 assert.deepEqual(preview[0].candidate.skillsDetail,[]);
 assert.deepEqual(preview[0].candidate.skills,['Python']);
 assert.ok(preview[1].error.includes('Engagement must be one of'));
});
