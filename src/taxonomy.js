// Blueprint §6 — skills intelligence model: canonical taxonomy with admin-extensible vocabulary,
// proficiency scale, evidence sources. base vocabulary ships in code; the workspace can extend it
// with custom skills and aliases (Settings → Skill taxonomy, persisted per workspace).
export const BASE_SKILLS = ['Databricks', 'Databricks Genie', 'Unity Catalog', 'Apache Spark', 'Python', 'SQL', 'Azure', 'AWS', 'Microsoft Entra', 'IAM', 'Conditional Access', 'Cybersecurity', 'OT Security', 'React', 'TypeScript', 'Node.js', 'Power BI', 'Snowflake', 'dbt', 'Terraform', 'Kubernetes', 'Java', 'SAP', 'Figma'];
const BASE_ALIASES = { 'pyspark': 'Apache Spark', 'spark': 'Apache Spark', 'genie': 'Databricks Genie', 'ai/bi genie': 'Databricks Genie', 'entra': 'Microsoft Entra', 'entra id': 'Microsoft Entra', 'azure ad': 'Microsoft Entra', 'reactjs': 'React', 'react.js': 'React', 'nodejs': 'Node.js', 'node': 'Node.js', 'amazon web services': 'AWS', 'ms azure': 'Azure', 'ts': 'TypeScript' };
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

let custom = { skills:[], aliases:{}, domains:{} };
export function setCustomTaxonomy(t = {}) {
  custom = {
    skills: Array.isArray(t.skills) ? t.skills.filter(Boolean) : [],
    aliases: t.aliases && typeof t.aliases === 'object' ? t.aliases : {},
    domains: t.domains && typeof t.domains === 'object' ? t.domains : {}
  };
}
export const customTaxonomy = () => ({ skills:[...custom.skills], aliases:{...custom.aliases}, domains:{...custom.domains} });
export const allSkills = () => [...BASE_SKILLS, ...custom.skills];
export const allAliases = () => ({ ...BASE_ALIASES, ...custom.aliases });
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const canonical = value => {
  const v = String(value || '').trim();
  const alias = allAliases()[v.toLowerCase()];
  if (alias) return alias;
  const skill = allSkills().find(s => s.toLowerCase() === v.toLowerCase());
  return skill || v;
};
export const skillList = value => [...new Set((Array.isArray(value) ? value : value.split(/[,;|]/)).map(canonical).filter(Boolean))];
// Blueprint §5/§11 — vocabulary scan used by JD extraction and CV parsing.
export function scanSkills(text) {
  const terms = [...allSkills(), ...Object.keys(allAliases())].sort((a,b) => b.length - a.length);
  return skillList(terms.filter(s => new RegExp(`(^|[^a-z0-9])${escapeRe(s)}($|[^a-z0-9])`, 'i').test(text)));
}

// Blueprint §5 — lexical concept expansion: everyday terms that should surface related skills
// without embeddings. Honest scope: keyword concepts, not vector similarity.
export const CONCEPTS = {
  lakehouse:['Databricks','Unity Catalog','Apache Spark'],
  'data platform':['Databricks','Snowflake','Apache Spark','dbt'],
  identity:['Microsoft Entra','IAM','Conditional Access'],
  security:['Cybersecurity','OT Security','IAM','Conditional Access'],
  'cloud':['Azure','AWS','Terraform','Kubernetes'],
  analytics:['Power BI','SQL','dbt','Snowflake'],
  frontend:['React','TypeScript','Figma'],
  backend:['Node.js','Java','Python','SQL'],
  infrastructure:['Terraform','Kubernetes','Azure','AWS'],
  governance:['Unity Catalog','Microsoft Entra','IAM']
};
const conceptIndex = {};
for(const [term,skills] of Object.entries(CONCEPTS)) for(const sk of skills) (conceptIndex[sk] = conceptIndex[sk] || []).push(term);
export const conceptTermsFor = skill => conceptIndex[skill] || [];

export const domainOf = skill => custom.domains[skill] || SKILL_DOMAINS[skill] || 'Other';
export const proficiencyRank = level => { const i = PROFICIENCY_LEVELS.indexOf(level); return i === -1 ? 1 : i; };
export const meetsLevel = (has, need) => proficiencyRank(has) >= proficiencyRank(need || 'Working');
export const blankSkillDetail = skill => ({ skill, proficiency:'Working', years:null, lastUsed:null, evidence:'Unverified', confidence:null, validated:false });
export const skillDetail = c => Array.isArray(c?.skillsDetail) && c.skillsDetail.length
  ? c.skillsDetail
  : (c?.skills || []).map(blankSkillDetail);
export const byDomain = skills => skills.reduce((m,s)=>{ (m[domainOf(s)] = m[domainOf(s)] || []).push(s); return m; }, {});
