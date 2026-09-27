// Public careers portal (blueprint D1 + D3): open roles and an application form whose
// consent checkboxes feed the §12 consent ledger when the application is accepted.
// Demo mode renders the seed workspace and stores applications in this browser;
// cloud mode reads open demands anonymously and posts through api_public_apply.
import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {BriefcaseBusiness,MapPin,Clock,Send,CheckCircle2,ShieldCheck} from 'lucide-react';
import {cloud,supabase} from './repository.js';
import {makeSeed} from './seed.js';
import {normalizeData} from './schema.js';

const APPS_KEY='ecod-careers-applications';
const WS_KEY='ecod-careers-workspace';

function statusLabel(d){return d.status==='Open';}

function demoRoles(){return normalizeData(makeSeed()).demands.filter(statusLabel);}
function useOpenRoles(){
 const [state,setState]=useState(()=>cloud?{loading:true,roles:[],error:''}:{loading:false,roles:demoRoles(),error:''});
 useEffect(()=>{
  if(!cloud)return;
  (async()=>{
   try{
     const ws=localStorage.getItem(WS_KEY)||new URLSearchParams(location.search).get('ws')||'';
     if(ws)localStorage.setItem(WS_KEY,ws);
     const {data,error}=await supabase.from('demands').select('id,title,client,location,mode,engagementType,positions,priority,description,skills,target,created').eq('status','Open').order('created',{ascending:false});
     if(error)throw error;
     setState({loading:false,roles:data||[],error:''});
   }catch(e){setState({loading:false,roles:[],error:e.message||'Could not load open roles. Please try again later.'});}
  })();
 },[]);
 return state;
}

function ApplyForm({role,onDone}){
 const [form,setForm]=useState({name:'',email:'',phone:'',linkedin:'',message:'',consentContact:false,consentSharing:false});
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [done,setDone]=useState(false);
 async function submit(e){
  e.preventDefault();
  if(!form.name.trim()||!form.email.trim())return setError('Name and email are required.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))return setError('Enter a valid email address.');
  if(!form.consentContact)return setError('We need your consent to contact you about this application.');
  setBusy(true);setError('');
  try{
   if(cloud){
    const ws=localStorage.getItem(WS_KEY)||'';
    const {error:rpcError}=await supabase.rpc('api_public_apply',{ws:ws||null,payload:{...form,demandId:role?.id||null}});
    if(rpcError)throw rpcError;
   }else{
    const list=JSON.parse(localStorage.getItem(APPS_KEY)||'[]');
    list.push({...form,demandId:role?.id||null,demandTitle:role?.title||'',status:'pending',created:new Date().toISOString()});
    localStorage.setItem(APPS_KEY,JSON.stringify(list));
   }
   setDone(true);onDone&&onDone();
  }catch(err){setError(err.message||'Could not send the application. Please try again.');}
  setBusy(false);
 }
 if(done)return <div className="apply-done"><CheckCircle2 size={22}/><div><strong>Application received.</strong><p>Thank you — our talent team will review your profile and reach out. Your consent choices were recorded and can be changed at any time.</p></div></div>;
 return <form className="apply-form" onSubmit={submit}>
  <h3>Apply — {role.title}</h3>
  <div className="apply-grid">
   <label>Full name *<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
   <label>Email *<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
   <label>Phone<input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+91…"/></label>
   <label>LinkedIn<input value={form.linkedin} onChange={e=>setForm({...form,linkedin:e.target.value})} placeholder="https://www.linkedin.com/in/…"/></label>
   <label className="wide">A few words about your fit<textarea rows={3} value={form.message} onChange={e=>setForm({...form,message:e.target.value})}/></label>
  </div>
  <label className="consent-check"><input type="checkbox" checked={form.consentContact} onChange={e=>setForm({...form,consentContact:e.target.checked})}/>I consent to AnthroPrime contacting me about this application and future matching roles (recruiting contact).</label>
  <label className="consent-check"><input type="checkbox" checked={form.consentSharing} onChange={e=>setForm({...form,consentSharing:e.target.checked})}/>I consent to my profile being shared with the hiring client for this role (profile sharing).</label>
  {error&&<p className="form-error">{error}</p>}
  <button className="apply-send" disabled={busy}>{busy?'Sending…':'Submit application'}<Send size={15}/></button>
  <p className="apply-fineprint"><ShieldCheck size={13}/> Your details are used only for recruitment. You can request access, correction or erasure at any time.</p>
 </form>;
}

export function CareersApp(){
 const {loading,roles,error}=useOpenRoles();
 const [applying,setApplying]=useState(null);
 return <div className="careers-page">
  <header className="careers-hero"><span className="careers-brand">AnthroPrime<small>ECOD · TALENT INTELLIGENCE</small></span>
   <h1>Open roles</h1>
   <p>Every role below is live with our client partners. Apply directly — a recruiter reviews every application, and your consent choices are recorded and respected.</p>
  </header>
  <main className="careers-main">
   {loading&&<p className="careers-loading">Loading open roles…</p>}
   {error&&<p className="form-error">{error}</p>}
   {!loading&&!roles.length&&!error&&<p className="careers-loading">No open roles right now — check back soon.</p>}
   <div className="careers-list">{roles.map(r=><section className="careers-role" key={r.id}>
    <div className="careers-role-head"><h2>{r.title}</h2>
     <button className="apply-btn" onClick={()=>setApplying(applying===r.id?null:r.id)}>{applying===r.id?'Close':'Apply'}</button></div>
    <p className="careers-meta"><span><BriefcaseBusiness size={14}/>{r.client}</span><span><MapPin size={14}/>{r.location} · {r.mode}</span><span><Clock size={14}/>{r.engagementType||'Engagement flexible'} · {r.positions} position{r.positions===1?'':'s'}</span></p>
    {r.skills&&<div className="careers-skills">{r.skills.map(s=><span key={s}>{s}</span>)}</div>}
    {r.description&&<p className="careers-desc">{r.description}</p>}
    {applying===r.id&&<ApplyForm role={r}/>}
   </section>)}</div>
  </main>
  <footer className="careers-footer"><span>AnthroPrime · ECOD Talent Intelligence</span><span>Applications are handled by people, not algorithms.</span></footer>
 </div>;
}

if(typeof document!=='undefined'&&document.getElementById('careers-root')){
 createRoot(document.getElementById('careers-root')).render(<CareersApp/>);
}
