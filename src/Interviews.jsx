import React,{useState} from 'react';
import {CalendarClock,Video,Phone,MapPin,CheckCircle2,XCircle,Clock,MailPlus,Plus} from 'lucide-react';
import {PageHeader,Button,Field,Modal,Badge,Empty,PanelHeading,Stat,Avatar} from './ui.jsx';
import {uid,today,money} from './domain.js';
import {ROUNDS,MODES,INTERVIEW_STATUSES,RECOMMENDATIONS,RECOMMENDATION_TONES,criteriaFor,thresholdFor,overallOf,meetsBar,templatesFor,fillTemplate} from './feedback.js';
import {interviewAnalytics} from './analytics.js';
import {OFFER_STATUSES,OFFER_TONES,offersSummary} from './offers.js';
import {downloadFile} from './Candidates.jsx';
import {icsFor,icsForInterview} from './calendar.js';
import {offerLetterText} from './offerLetter.js';

const fmtDT = iso => { const d=new Date(iso); return isNaN(d)?'—':d.toLocaleString(undefined,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}); };
const fmtDay = iso => { const d=new Date(iso); return isNaN(d)?'—':d.toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'}); };
const fmtTime = iso => { const d=new Date(iso); return isNaN(d)?'—':d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}); };
const STATUS_TONES = {Scheduled:'blue',Completed:'green',Cancelled:'gray','No-show':'red'};

export function InterviewWhen({iv}){
 return <div className="iv-when"><strong>{fmtDay(iv.scheduledAt)}</strong><span>{fmtTime(iv.scheduledAt)} · {iv.durationMins} min</span></div>;
}

export function ScheduleModal({onClose,onSave,interview=null,candidates,demands,preselect={}}){
 const [form,setForm]=useState(interview||{
  candidateId:preselect.candidateId||'',demandId:preselect.demandId||'',round:'Round 1',mode:'Video',
  date:preselect.date||today(),time:preselect.time||'11:00',durationMins:45,interviewers:'',notes:''
 });
 const [error,setError]=useState('');
 async function submit(e){
  e.preventDefault();
  if(!form.candidateId)return setError('Select the candidate being interviewed.');
  if(!form.date||!form.time)return setError('Pick a date and time for the interview.');
  const scheduledAt=new Date(`${form.date}T${form.time}:00`);
  if(isNaN(scheduledAt))return setError('That date or time could not be read. Please pick again.');
  const record={...form,scheduledAt:scheduledAt.toISOString(),date:undefined,time:undefined,id:interview?.id||uid(),status:interview?.status||'Scheduled',recommendation:interview?.recommendation||null,feedback:interview?.feedback||{},created:interview?.created||new Date().toISOString(),interviewers:form.interviewers.split(',').map(s=>s.trim()).filter(Boolean)};
  delete record.date;delete record.time;
  if(await onSave('interviews',[record]))onClose();
 }
 return <Modal title={interview?'Reschedule interview':'Schedule an interview'} subtitle="Candidate × demand × panel. Outcomes are recorded through the feedback form when the interview completes." onClose={onClose}>
  <form onSubmit={submit}><div className="modal-body form-grid">
   <Field label="Candidate *"><select value={form.candidateId} onChange={e=>setForm({...form,candidateId:e.target.value})}><option value="">Select a candidate…</option>{[...candidates].sort((a,b)=>a.name.localeCompare(b.name)).map(c=><option key={c.id} value={c.id}>{c.name} · {c.title}</option>)}</select></Field>
   <Field label="Demand"><select value={form.demandId} onChange={e=>setForm({...form,demandId:e.target.value})}><option value="">Not linked to a demand</option>{demands.map(d=><option key={d.id} value={d.id}>{d.title} · {d.client}</option>)}</select></Field>
   <Field label="Round">{<select value={form.round} onChange={e=>setForm({...form,round:e.target.value})}>{ROUNDS.map(r=><option key={r}>{r}</option>)}</select>}</Field>
   <Field label="Mode">{<select value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})}>{MODES.map(m=><option key={m}>{m}</option>)}</select>}</Field>
   <Field label="Date *"><input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
   <Field label="Time *"><input type="time" value={form.time} onChange={e=>setForm({...form,time:e.target.value})}/></Field>
   <Field label="Duration (minutes)"><input type="number" min="15" max="480" value={form.durationMins} onChange={e=>setForm({...form,durationMins:Number(e.target.value)})}/></Field>
   <Field label="Interviewers" wide hint="Comma-separated. Everyone you need on the panel."><input value={form.interviewers} onChange={e=>setForm({...form,interviewers:e.target.value})} placeholder="Neha Kulkarni, Rohit Verma"/></Field>
   <Field label="Notes" wide><textarea rows={3} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Focus areas, CV links, logistics…"/></Field>
   {error&&<p className="form-error wide">{error}</p>}
  </div><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{interview?'Update interview':'Schedule interview'}</Button></div></form>
 </Modal>;
}

export function FeedbackModal({interview,candidate,demand,settings,onClose,onSave,notify,audit}){
 const criteria=criteriaFor(settings),threshold=thresholdFor(settings);
 const [ratings,setRatings]=useState(()=>Object.fromEntries(criteria.map(c=>[c,interview.feedback?.[c]??3])));
 const [recommendation,setRecommendation]=useState(interview.recommendation||'');
 const [notes,setNotes]=useState(interview.notes||'');
 const [error,setError]=useState('');
 const overall=overallOf(ratings),onBar=meetsBar(overall,threshold);
 async function submit(e){
  e.preventDefault();
  if(!recommendation)return setError('Pick a recommendation before submitting feedback.');
  const record={...interview,status:'Completed',recommendation,feedback:{...ratings},notes,completed:new Date().toISOString()};
  if(await onSave('interviews',[record])){notify&&notify(`Feedback saved for ${candidate?.name||'candidate'}.`);audit&&audit({entityType:'interview',entityId:interview.id,action:'updated',detail:`Feedback recorded: ${recommendation} (${overall})`});onClose();}
 }
 return <Modal title={`Feedback — ${candidate?.name||'candidate'}`} subtitle={`${interview.round} · ${interview.mode}${demand?` · ${demand.title}`:''}. Rate 1 (poor) to 5 (excellent). The bar for this workspace is ${threshold}.`} onClose={onClose}>
  <form onSubmit={submit}><div className="modal-body">
   <div className="feedback-grid">{criteria.map(c=><Field key={c} label={c}><select value={ratings[c]} onChange={e=>setRatings({...ratings,[c]:Number(e.target.value)})}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select></Field>)}</div>
   <div className={`feedback-overall ${onBar?'on-bar':'below-bar'}`}><span>Overall {overall ?? '—'} of 5 · {onBar?'meets the bar':'below the bar'}</span><strong>{overall??'—'}</strong></div>
   <Field label="Recommendation *"><select value={recommendation} onChange={e=>setRecommendation(e.target.value)}><option value="">Select…</option>{RECOMMENDATIONS.map(r=><option key={r}>{r}</option>)}</select></Field>
   <Field label="Evidence and notes"><textarea rows={3} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="What justified this recommendation?"/></Field>
   {error&&<p className="form-error">{error}</p>}
  </div><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Discard</Button><Button type="submit">Submit feedback</Button></div></form>
 </Modal>;
}

function InviteLink({iv,candidate,demand,settings,notify}){
 const tpl=templatesFor(settings).find(t=>t.name==='Interview invite')||templatesFor(settings)[0];
 const ctx={name:candidate?.name||'there',demand:demand?`${demand.title} (${demand.client})`:'the role',round:iv.round,mode:iv.mode,date:fmtDay(iv.scheduledAt),time:fmtTime(iv.scheduledAt)};
 const href=`mailto:${candidate?.email||''}?subject=${encodeURIComponent(fillTemplate(tpl.subject,ctx))}&body=${encodeURIComponent(fillTemplate(tpl.body,ctx))}`;
 return <a className="button ghost small" href={href} onClick={()=>notify&&notify('Email draft opened in your mail client.')}><MailPlus size={14}/>Invite</a>;
}

export function Interviews({data,onSave,onOpen,busy,notify,audit}){
 const [modal,setModal]=useState(null); // {type:'schedule'|'feedback'|'offer', ...}
 const ivs=[...data.interviews].sort((a,b)=>new Date(a.scheduledAt)-new Date(b.scheduledAt));
 const upcoming=ivs.filter(iv=>iv.status==='Scheduled'&&new Date(iv.scheduledAt)>=new Date(Date.now()-12*3600000));
 const past=[...ivs].filter(iv=>iv.status!=='Scheduled').sort((a,b)=>new Date(b.scheduledAt)-new Date(a.scheduledAt));
 const stats=interviewAnalytics(data.interviews,thresholdFor(data.settings));
 const offers=offersSummary(data.offers);
 const person= id => data.candidates.find(c=>c.id===id);
 const demandOf= id => data.demands.find(d=>d.id===id);
 async function setStatus(iv,status){
  if(status!=='Completed'&&!window.confirm(`Mark this interview as ${status}?`))return;
  if(await onSave('interviews',[{...iv,status}])){notify&&notify(`Interview marked ${status}.`);audit&&audit({entityType:'interview',entityId:iv.id,action:'updated',detail:`Status: ${status}`});}
 }
 const row=(iv,upcomingView)=>{
  const c=person(iv.candidateId),d=demandOf(iv.demandId),overall=overallOf(iv.feedback);
  return <article className="iv-row" key={iv.id}>
   <InterviewWhen iv={iv}/>
   <div className="iv-who">
    {c&&<button className="person" onClick={()=>onOpen(c.id)}><Avatar name={c.name} size="small"/><span><strong>{c.name}</strong><small>{c.title}{d?` · ${d.title}`:''}</small></span></button>}
    {!c&&<span className="muted">Candidate removed</span>}
    <span className="iv-meta"><Badge>{iv.round}</Badge><Badge>{iv.mode==='Video'?<Video size={12}/>:iv.mode==='Phone'?<Phone size={12}/>:<MapPin size={12}/>}{iv.mode}</Badge>{iv.interviewers.length>0&&<small>Panel: {iv.interviewers.join(', ')}</small>}</span>
    {iv.notes&&upcomingView&&<small className="iv-notes">{iv.notes}</small>}
   </div>
   <div className="iv-state">
    <Badge tone={STATUS_TONES[iv.status]||'gray'}>{iv.status}</Badge>
    {iv.status==='Completed'&&iv.recommendation&&<Badge tone={RECOMMENDATION_TONES[iv.recommendation]||'gray'}>{iv.recommendation}{overall!=null?` · ${overall}`:''}</Badge>}
    {!upcomingView&&iv.notes&&<small className="iv-notes">{iv.notes}</small>}
   </div>
   <div className="iv-actions">
    {upcomingView?<>
     <InviteLink iv={iv} candidate={c} demand={d} settings={data.settings} notify={notify}/>
     <Button variant="secondary" className="small" disabled={busy} onClick={()=>setModal({type:'schedule',interview:iv})}>Reschedule</Button>
     <Button className="small" disabled={busy} onClick={()=>setModal({type:'feedback',interview:iv})}>Record outcome</Button>
     <Button variant="ghost" className="small" disabled={busy} onClick={()=>{downloadFile(icsForInterview(iv,c,d),`interview-${(c?.name||'candidate').toLowerCase().replace(/\s+/g,'-')}.ics`,'text/calendar');notify&&notify('Calendar file downloaded.');}}>Calendar</Button>
     <Button variant="ghost" className="small" disabled={busy} onClick={()=>setStatus(iv,'No-show')}>No-show</Button>
     <Button variant="ghost" className="small" disabled={busy} onClick={()=>setStatus(iv,'Cancelled')}>Cancel</Button>
    </>:iv.status==='Completed'&&<Button variant="secondary" className="small" disabled={busy} onClick={()=>setModal({type:'feedback',interview:iv})}>Edit feedback</Button>}
   </div>
  </article>;
 };
 return <>
  <PageHeader eyebrow="SCREENING & INTERVIEWS" title="Interviews & offers" description="Schedule panels, keep outcomes structured and comparable, keep the feedback bar honest, and track offers to acceptance.">
   <Button icon={Plus} onClick={()=>setModal({type:'schedule'})}>Schedule interview</Button><Button variant="secondary" onClick={()=>{downloadFile(icsFor(data.interviews,data.candidates,data.demands),'ecod-interviews.ics','text/calendar');notify&&notify('Calendar file downloaded - opens in Google/Outlook/Apple Calendar.');}}>Export calendar (.ics)</Button>
  </PageHeader>
  <div className="stats-grid"><Stat label="Upcoming" value={stats.upcoming} detail="Scheduled interviews ahead of the panel" icon={Clock}/>
  <Stat label="Completed" value={stats.completed} detail={`${stats.recommended} recommended (${stats.recommendRate==null?'—':stats.recommendRate+'%'})`} icon={CheckCircle2}/>
  <Stat label="Average rating" value={stats.avgOverall??'—'} detail={`${stats.aboveBar} above the feedback bar`} icon={CalendarClock}/>
  <Stat label="Cancelled / no-show" value={stats.cancelled+stats.noShow} detail={`${stats.cancelled} cancelled · ${stats.noShow} no-shows`} icon={XCircle}/>
  <Stat label="Open offers" value={offers.open} detail={`${offers.sent} awaiting response · ${offers.drafts} drafts`} icon={CalendarClock}/>
  <Stat label="Accepted offers" value={offers.accepted} detail={offers.acceptRate==null?'No decisions yet':offers.acceptRate+'% acceptance rate'} icon={CheckCircle2}/></div>
  <section className="panel"><PanelHeading title="Upcoming interviews" subtitle="The next panels on the calendar, with invite drafts and outcome capture ready"/><div className="iv-list">{upcoming.map(iv=>row(iv,true))}{!upcoming.length&&<Empty title="Nothing scheduled" text="Schedule an interview to see it here with invite drafts and outcome actions."/>}</div></section>
  <section className="panel"><PanelHeading title="Past interviews" subtitle="Completed, cancelled and no-show interviews with recorded feedback"/><div className="iv-list">{past.map(iv=>row(iv,false))}{!past.length&&<Empty title="No history yet" text="Completed interviews and their feedback will appear here."/>}</div></section>
  <OffersSection data={data} onSave={onSave} onOpen={onOpen} busy={busy} notify={notify} audit={audit} openModal={setModal}/>
  {modal?.type==='schedule'&&<ScheduleModal onClose={()=>setModal(null)} onSave={onSave} interview={modal.interview} candidates={data.candidates} demands={data.demands.filter(d=>d.status==='Open')}/>}
  {modal?.type==='feedback'&&<FeedbackModal interview={modal.interview} candidate={person(modal.interview.candidateId)} demand={demandOf(modal.interview.demandId)} settings={data.settings} onClose={()=>setModal(null)} onSave={onSave} notify={notify} audit={audit}/>}
  {modal?.type==='offer'&&<OfferModal onClose={()=>setModal(null)} onSave={onSave} offer={modal.offer} candidates={data.candidates} demands={data.demands.filter(d=>d.status==='Open')} preselect={modal.preselect||{}} notify={notify} audit={audit}/>}
  {modal?.type==='letter'&&<LetterModal offer={modal.offer} data={data} onClose={()=>setModal(null)} notify={notify}/>}
 </>;
}

function offerDraftHref(o,candidate,demand,settings){
 const tpl=templatesFor(settings).find(t=>t.name==='Offer')||templatesFor(settings)[0];
 const ctx={name:candidate?.name||'there',demand:demand?`${demand.title} (${demand.client})`:o.role||'the role',mode:demand?.mode||'',location:o.location||demand?.location||'',ctc:o.ctc?`${money(o.ctc)} LPA`:'the package in your letter',date:o.joining?new Date(o.joining).toLocaleDateString(undefined,{day:'numeric',month:'long',year:'numeric'}):'a date we will confirm'};
 return `mailto:${candidate?.email||''}?subject=${encodeURIComponent(fillTemplate(tpl.subject,ctx))}&body=${encodeURIComponent(fillTemplate(tpl.body,ctx))}`;
}

export function OfferModal({onClose,onSave,offer=null,candidates,demands,preselect={},notify,audit}){
 const [form,setForm]=useState(offer||{
  candidateId:preselect.candidateId||'',demandId:preselect.demandId||'',role:preselect.role||'',location:preselect.location||'',ctc:'',joining:'',notes:''
 });
 const [error,setError]=useState('');
 async function submit(e){
  e.preventDefault();
  if(!form.candidateId)return setError('Select the candidate receiving the offer.');
  if(form.ctc===''||isNaN(Number(form.ctc)))return setError('Enter the annual package in rupee lakh per annum.');
  const record={...form,ctc:Number(form.ctc),id:offer?.id||uid(),status:offer?.status||'Draft',sentDate:offer?.sentDate||null,decidedDate:offer?.decidedDate||null,created:offer?.created||today()};
  if(await onSave('offers',[record])){notify&&notify(offer?'Offer updated.':'Offer drafted.');audit&&audit({entityType:'offer',entityId:record.id,action:'updated',detail:`${offer?'Updated':'Created'} ${record.status} offer`});onClose();}
 }
 return <Modal title={offer?'Edit offer':'Create an offer'} subtitle="Terms live on the offer record; the letter itself follows from your team. E-signature is out of scope for this release." onClose={onClose}>
  <form onSubmit={submit}><div className="modal-body form-grid">
   <Field label="Candidate *"><select value={form.candidateId} onChange={e=>setForm({...form,candidateId:e.target.value})}><option value="">Select a candidate…</option>{[...candidates].sort((a,b)=>a.name.localeCompare(b.name)).map(c=><option key={c.id} value={c.id}>{c.name} · {c.title}</option>)}</select></Field>
   <Field label="Demand"><select value={form.demandId||''} onChange={e=>{const d=demands.find(x=>x.id===e.target.value);setForm({...form,demandId:e.target.value,role:form.role||(d?.title||''),location:form.location||(d?.location||'')});}}><option value="">Not linked to a demand</option>{demands.map(d=><option key={d.id} value={d.id}>{d.title} · {d.client}</option>)}</select></Field>
   <Field label="Role on offer"><input value={form.role} onChange={e=>setForm({...form,role:e.target.value})} placeholder="Defaults to the demand title"/></Field>
   <Field label="Location"><input value={form.location} onChange={e=>setForm({...form,location:e.target.value})} placeholder="Bengaluru"/></Field>
   <Field label="Annual package (₹ LPA) *"><input type="number" min="0" step="0.1" value={form.ctc} onChange={e=>setForm({...form,ctc:e.target.value})} placeholder="31"/></Field>
   <Field label="Joining date"><input type="date" value={form.joining||''} onChange={e=>setForm({...form,joining:e.target.value})}/></Field>
   <Field label="Notes" wide><textarea rows={3} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Terms discussed, conditions, sign-offs…"/></Field>
   {error&&<p className="form-error wide">{error}</p>}
  </div><div className="modal-actions"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">{offer?'Save offer':'Draft offer'}</Button></div></form>
 </Modal>;
}

export function OffersSection({data,onSave,onOpen,busy,notify,audit,openModal}){
 const offers=[...data.offers].sort((a,b)=>(a.status===b.status?0:a.status==='Sent'?-1:b.status==='Sent'?1:(a.created||'').localeCompare(b.created||'')));
 const summary=offersSummary(data.offers);
 const person=id=>data.candidates.find(c=>c.id===id);
 const demandOf=id=>data.demands.find(d=>d.id===id);
 async function setStatus(o,status){
  if(status!=='Accepted'&&!window.confirm(`Mark this offer as ${status}?`))return;
  const patch={...o,status};
  if(status==='Sent')patch.sentDate=today();
  if(['Accepted','Rejected','Withdrawn'].includes(status))patch.decidedDate=today();
  if(await onSave('offers',[patch])){notify&&notify(`Offer marked ${status}.`);audit&&audit({entityType:'offer',entityId:o.id,action:'updated',detail:`Offer ${status}`});}
 }
 const row=o=>{
  const c=person(o.candidateId),d=demandOf(o.demandId);
  return <article className="iv-row offer-row" key={o.id}>
   <div className="iv-who">{c&&<button className="person" onClick={()=>onOpen(c.id)}><Avatar name={c.name} size="small"/><span><strong>{c.name}</strong><small>{o.role||d?.title||'Offer'}{d?` · ${d.client}`:''}</small></span></button>}{!c&&<span className="muted">Candidate removed</span>}
    <small className="iv-notes">{o.ctc!=null?`${money(o.ctc)} LPA`:'Package in letter'}{o.joining?` · joining ${new Date(o.joining).toLocaleDateString(undefined,{day:'numeric',month:'short'})}`:''}{o.notes?` · ${o.notes}`:''}</small></div>
   <div className="iv-state"><Badge tone={OFFER_TONES[o.status]||'gray'}>{o.status}</Badge>{o.sentDate&&o.status!=='Draft'&&<small className="iv-notes">sent {o.sentDate}</small>}{o.decidedDate&&<small className="iv-notes">decided {o.decidedDate}</small>}</div>
   <div className="iv-actions">
    {c&&<a className="button ghost small" href={offerDraftHref(o,c,d,data.settings)} onClick={()=>notify&&notify('Offer draft opened in your mail client.')}><MailPlus size={14}/>Draft email</a>}
    {o.status==='Draft'&&<Button className="small" disabled={busy} onClick={()=>setStatus(o,'Sent')}>Mark sent</Button>}
    {o.status==='Sent'&&<Button className="small" disabled={busy} onClick={()=>setStatus(o,'Accepted')}>Accepted</Button>}
    {o.status==='Sent'&&<Button variant="secondary" className="small" disabled={busy} onClick={()=>setStatus(o,'Rejected')}>Rejected</Button>}
    {o.status==='Sent'&&<Button variant="ghost" className="small" disabled={busy} onClick={()=>setStatus(o,'Withdrawn')}>Withdraw</Button>}
    <Button variant="secondary" className="small" disabled={busy} onClick={()=>openModal&&openModal({type:'offer',offer:o})}>Edit</Button><Button variant="ghost" className="small" onClick={()=>openModal&&openModal({type:'letter',offer:o})}>Letter</Button>
   </div>
  </article>;
 };
 return <section className="panel"><PanelHeading title="Offers" subtitle="Draft, send and track offers to acceptance" action={<Button icon={Plus} className="small" onClick={()=>openModal&&openModal({type:'offer'})}>New offer</Button>}/>
  <div className="iv-list">{offers.map(row)}{!offers.length&&<Empty title="No offers yet" text="Draft an offer once the panel says hire — terms, status and acceptance live on the record."/>}</div>
  {(summary.drafts>0||summary.sent>0)&&<p className="supporting-text" style={{padding:'0 24px 18px',margin:0}}>{summary.drafts} draft{summary.drafts===1?'':'s'} · {summary.sent} awaiting response{summary.acceptRate!=null?` · ${summary.acceptRate}% accepted so far`:''}</p>}
 </section>;
}

function LetterModal({offer,data,onClose,notify}){
 const candidate=data.candidates.find(c=>c.id===offer.candidateId);
 const demand=data.demands.find(d=>d.id===offer.demandId);
 const letter=offerLetterText(offer,candidate,demand);
 return <Modal title={`Offer letter — ${candidate?.name||'candidate'}`} subtitle="Generated from the offer record's terms. Print, attach or paste into your signing workflow — e-signature execution remains a server-side integration." onClose={onClose} wide>
  <div className="modal-body"><div className="submission-preview wide"><span>Letter preview</span><pre>{letter}</pre></div></div>
  <div className="modal-actions">
   <Button variant="ghost" onClick={()=>{downloadFile(letter,`offer-letter-${(candidate?.name||'candidate').toLowerCase().replace(/\s+/g,'-')}.txt`,'text/plain');notify&&notify('Letter downloaded.');}}>Download letter</Button>
   <a className="button ghost" href={`mailto:${candidate?.email||''}?subject=${encodeURIComponent(`Your offer from AnthroPrime — ${offer.role||'the role'}`)}&body=${encodeURIComponent(letter)}`} onClick={()=>notify&&notify('Email draft opened in your mail client.')}>Open email draft</a>
   <Button variant="secondary" onClick={onClose}>Close</Button>
  </div>
 </Modal>;
}
