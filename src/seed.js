import { WEIGHTS } from './domain.js';
const dateAgo = days => new Date(Date.now() - days * 86400000).toISOString().slice(0,10);
const people = [
 ['Aarav Mehta','Senior Data Architect','Deloitte','Bengaluru',9,8,15,34,40,['Databricks','Databricks Genie','Unity Catalog','Apache Spark','Python','SQL','Azure'],'Ready',8,'Referral','Hybrid'],
 ['Priya Sharma','Databricks Consultant','Accenture','Pune',7,6,30,26,32,['Databricks','Unity Catalog','Apache Spark','Python','SQL','Azure'],'Ready',14,'LinkedIn','Flexible'],
 ['Rohan Iyer','Lead Data Engineer','Infosys','Bengaluru',8,7,30,28,36,['Databricks','Databricks Genie','Apache Spark','Python','SQL','AWS'],'Near-ready',32,'Referral','Hybrid'],
 ['Sneha Kapoor','Cloud Data Architect','Capgemini','Hyderabad',10,8,60,36,46,['Databricks','Unity Catalog','Azure','Python','SQL','Snowflake'],'Ready',78,'Career page','Remote'],
 ['Vikram Rao','IAM Security Engineer','Wipro','Bengaluru',6,5,15,20,26,['Microsoft Entra','IAM','Conditional Access','Azure','Cybersecurity'],'Ready',12,'LinkedIn','Hybrid'],
 ['Ananya Das','Frontend Engineer','Razorpay','Bengaluru',5,4,30,22,28,['React','TypeScript','Node.js','Figma'],'Ready',24,'Referral','Remote'],
 ['Karthik Nair','Senior Data Engineer','TCS','Chennai',6,5,60,18,26,['Apache Spark','Python','SQL','AWS','Databricks'],'Assessing',142,'CSV import','Flexible'],
 ['Neha Gupta','Analytics Engineer','Fractal','Mumbai',4,4,0,16,22,['SQL','dbt','Snowflake','Power BI','Python'],'Ready',4,'Community','Remote'],
 ['Aditya Sen','OT Security Consultant','Siemens','Pune',9,7,30,30,38,['OT Security','Cybersecurity','IAM'],'Near-ready',38,'LinkedIn','Onsite'],
 ['Meera Krishnan','Cloud Platform Engineer','IBM','Hyderabad',7,6,15,24,31,['Azure','AWS','Terraform','Kubernetes','Python'],'Ready',17,'Referral','Flexible'],
 ['Rahul Verma','Data Platform Lead','Cognizant','Bengaluru',11,9,90,38,48,['Databricks','Databricks Genie','Unity Catalog','Apache Spark','SQL','Azure'],'Ready',162,'CSV import','Hybrid'],
 ['Ishita Roy','Identity Solutions Architect','EY','Pune',8,7,30,27,35,['Microsoft Entra','IAM','Conditional Access','Azure','Terraform'],'Near-ready',42,'Community','Flexible'],
 ['Arjun Patel','Full Stack Developer','Freshworks','Chennai',6,5,30,24,30,['React','TypeScript','Node.js','SQL','AWS'],'Ready',9,'Career page','Remote'],
 ['Divya Menon','Data Engineer','LTIMindtree','Bengaluru',5,4,0,19,24,['Databricks','Python','SQL','Azure','Power BI'],'Assessing',66,'LinkedIn','Hybrid'],
 ['Siddharth Jain','Security Analyst','HCLTech','Noida',4,3,60,14,20,['Cybersecurity','IAM','Microsoft Entra'],'Assessing',130,'CSV import','Onsite'],
 ['Pooja Reddy','Senior Analytics Consultant','Microsoft','Hyderabad',8,6,30,29,37,['Databricks','Databricks Genie','Unity Catalog','SQL','Power BI','Azure'],'Ready',20,'Referral','Flexible'],
 ['Kabir Sethi','Backend Engineer','PhonePe','Bengaluru',7,6,45,30,38,['Java','Node.js','SQL','AWS','Kubernetes'],'Near-ready',51,'LinkedIn','Hybrid'],
 ['Tara Joshi','BI Developer','Persistent','Pune',3,3,15,12,17,['Power BI','SQL','Python','Azure'],'Ready',6,'Community','Remote']
];
export function makeSeed() {
 const candidates = people.map((p,i) => ({ id:`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`, name:p[0],title:p[1],company:p[2],location:p[3],experience:p[4],relevantExperience:p[5],notice:p[6],current:p[7],expected:p[8],skills:p[9],status:p[10],verified:dateAgo(p[11]),source:p[12],mode:p[13],email:p[0].toLowerCase().replace(' ','.')+'@example.com',phone:'',summary:`${p[1]} with ${p[4]} years of experience. Focused on ${p[9].slice(0,3).join(', ')} and enterprise delivery.`,created:dateAgo(100+i),owner:'Amit Singh',linkedin:'' }));
 const demands = [
  {id:'20000000-0000-4000-8000-000000000001',title:'Senior Databricks Architect',client:'Meridian Technologies',skills:['Databricks','Databricks Genie','Unity Catalog','Azure'],minExperience:7,maxNotice:30,budget:42,location:'Bengaluru',mode:'Hybrid',positions:2,priority:'High',status:'Open',target:dateAgo(-30),description:'Design enterprise lakehouse solutions with Databricks, Genie, Unity Catalog and Azure. 7+ years of relevant experience. Join within 30 days.',weights:WEIGHTS,created:dateAgo(4)},
  {id:'20000000-0000-4000-8000-000000000002',title:'IAM Solutions Engineer',client:'Northstar Financial',skills:['Microsoft Entra','IAM','Conditional Access','Azure'],minExperience:5,maxNotice:30,budget:36,location:'Bengaluru',mode:'Remote',positions:3,priority:'High',status:'Open',target:dateAgo(-24),description:'Build identity solutions with Microsoft Entra, IAM and Conditional Access on Azure.',weights:WEIGHTS,created:dateAgo(7)},
  {id:'20000000-0000-4000-8000-000000000003',title:'Senior Frontend Engineer',client:'Aster Digital',skills:['React','TypeScript','Node.js'],minExperience:4,maxNotice:45,budget:32,location:'Bengaluru',mode:'Remote',positions:1,priority:'Medium',status:'Open',target:dateAgo(-40),description:'Build thoughtful web experiences using React and TypeScript.',weights:WEIGHTS,created:dateAgo(12)},
  {id:'20000000-0000-4000-8000-000000000004',title:'Cloud Platform Engineer',client:'Meridian Technologies',skills:['Azure','Terraform','Kubernetes'],minExperience:5,maxNotice:30,budget:35,location:'Hyderabad',mode:'Hybrid',positions:2,priority:'Medium',status:'Open',target:dateAgo(-35),description:'Own cloud infrastructure, delivery automation and platform reliability.',weights:WEIGHTS,created:dateAgo(9)}
 ];
 const considerations = [[0,0,'Interview'],[1,0,'Assessed'],[2,0,'Enrichment'],[15,0,'Identified'],[4,1,'Submitted'],[11,1,'Contacted'],[5,2,'Offer'],[12,2,'Interview'],[9,3,'Contacted']].map(([c,d,stage],i)=>({id:`30000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,candidateId:candidates[c].id,demandId:demands[d].id,stage,created:dateAgo(i+1),updated:dateAgo(1),reason:''}));
 const assessments = candidates.filter(c=>c.status!=='Assessing').map((c,i)=>({id:`40000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,candidateId:c.id,demandId:null,title:'Technical readiness review',score:c.status==='Ready'?90+i%8:68+i%8,assessor:'ECOD assessment team',date:dateAgo(20+i),evidence:`Structured technical discussion covering ${c.skills.slice(0,3).join(', ')}. Sample assessment evidence for this fictional profile.`,gap:c.status==='Near-ready'?'Validate architecture depth through a practical exercise.':''}));
 const notes = [0,4,1].map((c,i)=>({id:`50000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,candidateId:candidates[c].id,text:['Confirm availability for the client architecture interview.','Discuss the identity engineering opportunity and remote preference.','Follow up on Unity Catalog assessment evidence.'][i],date:dateAgo(2),followUp:dateAgo(-i),completed:false,author:'Amit Singh'}));
 const enrichment = [{id:'60000000-0000-4000-8000-000000000001',candidateId:candidates[2].id,title:'Unity Catalog governance lab',description:'Complete a catalog access-control exercise and submit evidence for reassessment.',due:dateAgo(-5),owner:'Amit Singh',status:'In progress',created:dateAgo(3)}];
 return { candidates, demands, considerations, assessments, notes, enrichment, history:[] };
}
