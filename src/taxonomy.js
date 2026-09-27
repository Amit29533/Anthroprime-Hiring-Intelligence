// Blueprint §6 — skills intelligence model: canonical taxonomy, proficiency scale, evidence sources.
// A candidate's `skillsDetail` rows carry {skill, proficiency, years, lastUsed, evidence, confidence, validated}.
// Candidates without detail rows are treated as legacy: every flat skill counts as Working / Unverified.
export const SKILL_DOMAINS = {
  'Databricks':'Data platform','Databricks Genie':'Data platform','Unity Catalog':'Data platform','Apache Spark':'Data platform',
  'Snowflake':'Data platform','dbt':'Data platform','Power BI':'Analytics',
  'Python':'Programming','SQL':'Programming','TypeScript':'Programming','Node.js':'Programming','Java':'Programming','React':'Programming',
  'Azure':'Cloud','AWS':'Cloud','Terraform':'Cloud','Kubernetes':'Cloud',
  'Microsoft Entra':'Identity & security','IAM':'Identity & security','Conditional Access':'Identity & security','Cybersecurity':'Identity & security','OT Security':'Identity & security',
  'SAP':'Enterprise','Figma':'Design'
};
export const PROFICIENCY_LEVELS = ['Exposure','Working','Proficient','Advanced','Expert'];
export const EVIDENCE_SOURCES = ['Unverified','Self-declared','CV','Recruiter-verified','Assessment','Certification','Client interview','Project'];
export const ENGAGEMENT_TYPES = ['Permanent','Contract','C2H','Subcontract'];
export const proficiencyRank = level => { const i = PROFICIENCY_LEVELS.indexOf(level); return i === -1 ? 1 : i; };
export const meetsLevel = (has, need) => proficiencyRank(has) >= proficiencyRank(need || 'Working');
export const domainOf = skill => SKILL_DOMAINS[skill] || 'Other';
export const blankSkillDetail = skill => ({ skill, proficiency:'Working', years:null, lastUsed:null, evidence:'Unverified', confidence:null, validated:false });
export const skillDetail = c => Array.isArray(c?.skillsDetail) && c.skillsDetail.length
  ? c.skillsDetail
  : (c?.skills || []).map(blankSkillDetail);
export const byDomain = skills => skills.reduce((m,s)=>{ (m[domainOf(s)] = m[domainOf(s)] || []).push(s); return m; }, {});
