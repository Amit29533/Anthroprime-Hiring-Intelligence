// Candidate portal (/portal.html) — cloud mode signs in with Supabase Auth and reads the
// curated api_portal_overview RPC; demo mode opens the same view from the local workspace
// by email. Self-service is limited to availability preferences (see portal.js).
import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {cloud,supabase,loadData} from './repository.js';
import {normalizeData} from './schema.js';
import {portalOverview,applyPortalUpdate} from './portal.js';
import './workspace.css';

const label={pending:'Received — in review',accepted:'Accepted — we will be in touch',dismissed:'Not moving forward',
 'Identified':'In identification','Contacted':'Contacted','Assessed':'Assessed','Enrichment':'Enrichment','Submitted':'Submitted to client','Interview':'Interview stage','Offer':'Offer stage','Deployed':'Deployed','Rejected':'Not selected','Withdrawn':'Withdrawn'};

function Pill({kind,children}){return <span className={`status-pill ${kind||''}`}>{children}</span>;}

function Overview({view,onSave,busy,msg}){
 const p=view.profile;
 const [form,setForm]=useState({notice:p.notice??'',earliestStart:p.earliestStart||'',activeStatus:p.activeStatus||'Active',mode:p.mode||'Flexible',engagement:p.engagement||'',preferredLocations:p.preferredLocations||'',expected:p.expected??''});
 return <main className="careers-main portal-main">
  <section className="careers-status portal-card">
   <h2 style={{margin:'0 0 2px'}}>{p.name}</h2>
   <p style={{margin:0,color:'#a9c3bc'}}>{[p.title,p.location].filter(Boolean).join(' · ')||'Candidate profile'}</p>
   {p.skills?.length>0&&<div className="careers-skills" style={{marginTop:10}}>{p.skills.slice(0,10).map(s=><span key={s}>{s}</span>)}</div>}
  </section>
  <section className="careers-status portal-card">
   <h2>Your availability</h2>
   <p>Update your preferences any time — recruiters see the change immediately.</p>
   <div className="form-grid">
    <label>Notice period (days)<input type="number" min="0" value={form.notice??''} onChange={e=>setForm({...form,notice:e.target.value})}/></label>
    <label>Earliest start<input type="date" value={form.earliestStart||''} onChange={e=>setForm({...form,earliestStart:e.target.value})}/></label>
    <label>Status<select value={form.activeStatus} onChange={e=>setForm({...form,activeStatus:e.target.value})}><option>Active</option><option>Passive</option><option>Unavailable</option></select></label>
    <label>Work mode<select value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})}><option>Flexible</option><option>Remote</option><option>Hybrid</option><option>Onsite</option></select></label>
    <label>Engagement preference<input value={form.engagement} onChange={e=>setForm({...form,engagement:e.target.value})} placeholder="Permanent / Contract / C2H…"/></label>
    <label>Preferred locations<input value={form.preferredLocations} onChange={e=>setForm({...form,preferredLocations:e.target.value})} placeholder="Bengaluru, Remote…"/></label>
   </div>
   <button className="apply-btn" disabled={busy} onClick={()=>onSave(form)}>{busy?'Saving…':'Save preferences'}</button>
   {msg&&<p className="careers-loading" style={{marginTop:8}}>{msg}</p>}
  </section>
  <section className="careers-status portal-card"><h2>Your applications</h2>
   {view.applications.length||view.submissions.length?<div className="status-results">
    {view.applications.map((a,i)=><div key={`a${i}`} className="status-row"><strong>{a.demand}</strong><span>{a.client}</span><Pill>{label[a.stage]||a.stage}</Pill></div>)}
    {view.submissions.map((s,i)=><div key={`s${i}`} className="status-row"><strong>{s.demand}</strong><span>{s.client} · {s.submittedOn}</span><Pill kind={s.status==='accepted'?'accepted':s.status==='dismissed'?'dismissed':''}>{label[s.status]||s.status}</Pill></div>)}
   </div>:<p className="careers-loading">No applications yet.</p>}
  </section>
  {view.interviews.length>0&&<section className="careers-status portal-card"><h2>Your interviews</h2>
   <div className="status-results">{view.interviews.map((iv,i)=><div key={i} className="status-row"><strong>{iv.round} · {iv.mode}</strong><span>{new Date(iv.scheduledAt).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})}</span><Pill>{iv.status}</Pill></div>)}</div>
  </section>}
  {view.offers.length>0&&<section className="careers-status portal-card"><h2>Your offers</h2>
   <div className="status-results">{view.offers.map((o,i)=><div key={i} className="status-row"><strong>{o.role||'Offer'}</strong><span>{o.ctc?`₹${o.ctc} LPA · `:''}{o.joining||''}</span><Pill kind={o.status==='Accepted'?'accepted':o.status==='Rejected'||o.status==='Withdrawn'?'dismissed':''}>{o.status}</Pill></div>)}</div>
  </section>}
  <section className="careers-status portal-card"><h2>Your consents</h2>
   <p>You can withdraw any consent here; required notices stay on record.</p>
   <div className="status-results">{view.consents.map(cn=><div key={cn.id} className="status-row"><strong>{cn.purpose}</strong><span>{String(cn.date).slice(0,10)}</span>{cn.status==='revoked'?<Pill kind="dismissed">Withdrawn</Pill>:<button className="apply-btn" onClick={()=>onSave(null,cn.id)}>Withdraw</button>}</div>)}
   {!view.consents.length&&<p className="careers-loading">No consents recorded.</p>}</div>
  </section>
 </main>;
}

export function PortalApp(){
 const [view,setView]=useState(null);
 const [email,setEmail]=useState(''),[pw,setPw]=useState(''),[demoEmail,setDemoEmail]=useState('');
 const [msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 const portalData=cloud?null:typeof localStorage==='undefined'?null:normalizeData(loadData());
 useEffect(()=>{if(!cloud)return;supabase.auth.getSession().then(({data})=>{if(data.session)refresh();});const {data:sub}=supabase.auth.onAuthStateChange((_e,s)=>{if(s)refresh();});return()=>sub.subscription.unsubscribe();},[]);
 async function refresh(){
  const {data,error}=await supabase.rpc('api_portal_overview');
  if(error)setMsg(error.message);else if(data.error)setMsg(data.error);else setView(data);
 }
 function openDemo(e){
  e.preventDefault();
  const c=(portalData?.candidates||[]).find(x=>String(x.email||'').toLowerCase()===demoEmail.trim().toLowerCase());
  if(!c)return setMsg('No profile with that email in the demo workspace.');
  setMsg('');setView(portalOverview(c,portalData));
 }
 async function save(form,revokeId){
  setBusy(true);
  if(cloud){
   if(revokeId){await supabase.rpc('api_portal_revoke_consent',{p_id:revokeId});}
   else await supabase.rpc('api_portal_update',{payload:{...form,notice:String(form.notice??''),expected:String(form.expected??'')}});
   await refresh();
  }else{
   setMsg(revokeId?'Consent withdrawn (demo).':'Preferences saved (demo workspace).');
  }
  setBusy(false);
 }
 return <div className="careers-page">
  <header className="careers-hero" style={{padding:'40px 8vw 32px'}}><span className="careers-brand">AnthroPrime<small>ECOD · CANDIDATE PORTAL</small></span>
   <h1>{view?`Welcome, ${view.profile.name.split(' ')[0]}`:'Your profile, your data'}</h1>
   <p>{view?'Everything below is your own record — applications, interviews, offers and consents.':'Sign in with the email on your profile to see your applications, interviews and offers, and keep your availability up to date.'}</p>
  </header>
  {!view&&<main className="careers-main"><section className="careers-status portal-card">
   {cloud?<><h2>Sign in</h2>
    <form className="status-form" onSubmit={async e=>{e.preventDefault();setBusy(true);const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password:pw});setMsg(error?error.message:'');setBusy(false);}}>
     <input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email"/>
     <input type="password" required value={pw} onChange={e=>setPw(e.target.value)} placeholder="Password" aria-label="Password"/>
     <button className="apply-btn" disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
    </form>
    <p className="careers-loading">New here? Create an account with the email on your profile and this portal links to it automatically.</p>
    {msg&&<p className="form-error">{msg}</p>}
   </>:<><h2>Open your record</h2>
    <p>Demo mode — enter the email of any profile in the local workspace.</p>
    <form className="status-form" onSubmit={openDemo}>
     <input type="email" required value={demoEmail} onChange={e=>setDemoEmail(e.target.value)} placeholder="you@example.com" aria-label="Your email"/>
     <button className="apply-btn" disabled={busy}>Open my record</button>
    </form>
    {msg&&<p className="form-error">{msg}</p>}
   </>}
  </section></main>}
  {view&&<Overview view={view} onSave={save} busy={busy} msg={msg}/>}
  <footer className="careers-footer"><span>AnthroPrime · ECOD Talent Intelligence</span><span>You can request access, correction or erasure of your data at any time.</span></footer>
 </div>;
}
if(typeof document!=='undefined'&&document.getElementById('portal-root')){
 createRoot(document.getElementById('portal-root')).render(<PortalApp/>);
}
