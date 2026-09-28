import React from 'react';
import {
  Users,
  BriefcaseBusiness,
  UserCheck,
  Clock,
  Plus,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  CalendarDays,
  Check,
  Database,
  Layers,
  ArrowDownToLine,
} from 'lucide-react';
import { PageHeader, Button, Stat, PanelHeading, Badge, Avatar, TextLink, Empty } from './ui.jsx';
import { freshness, matchCandidate, today } from './domain.js';
import { canWriteForRole, getRole } from './repository.js';
import { identityFor, myQueue, ownerLooksUnmatched } from './worklist.js';
export default function Dashboard({
  data,
  navigate,
  openCandidate,
  openDemand,
  onNewDemand,
  onAdd,
  onImport,
  onComplete,
  user,
  now = Date.now,
}) {
  const viewer = !canWriteForRole(getRole());
  const identity = identityFor(user || {});
  const queue = myQueue(data, identity, { now: now(), isAdmin: getRole() === 'admin' });
  const unmatched = ownerLooksUnmatched(data, identity);
  const ready = data.candidates.filter((c) => c.status === 'Ready').length;
  const open = data.demands.filter((d) => d.status === 'Open');
  const followups = data.notes
    .filter((n) => !n.completed && n.followUp)
    .sort((a, b) => a.followUp.localeCompare(b.followUp));
  const fresh = data.candidates.filter((c) => freshness(c.verified) === 'Fresh').length;
  const aging = data.candidates.filter((c) => freshness(c.verified) === 'Aging').length;
  const stale = data.candidates.length - fresh - aging;
  const stages = ['Identified', 'Contacted', 'Assessed', 'Submitted', 'Interview', 'Offer'];
  return (
    <>
      <PageHeader
        eyebrow="YOUR TALENT, CONNECTED"
        title="Your next great hire is already here."
        description="Turn the people you know into the team your clients need."
      >
        {!viewer && (
          <Button icon={Plus} onClick={onNewDemand}>
            Create demand
          </Button>
        )}
      </PageHeader>
      <div className="stats-grid">
        <Stat
          label="Talent repository"
          value={data.candidates.length.toLocaleString()}
          detail="People, beyond a single application"
          icon={Users}
        />
        <Stat
          label="Open demands"
          value={open.length}
          detail={`${open.reduce((s, d) => s + d.positions, 0)} positions to fill`}
          icon={BriefcaseBusiness}
          tone="blue"
        />
        <Stat
          label="Ready to deploy"
          value={ready}
          detail={`${data.candidates.length ? Math.round((ready / data.candidates.length) * 100) : 0}% of your talent repository`}
          icon={UserCheck}
          tone="green"
        />
        <Stat
          label="Upcoming follow-ups"
          value={followups.length}
          detail={`${followups.filter((n) => n.followUp <= today()).length} due today or earlier`}
          icon={Clock}
          tone="amber"
        />
      </div>
      <section className="panel my-work">
        <PanelHeading
          title="Your work today"
          subtitle={
            unmatched
              ? 'Nothing is owned by a name matching yours — this shows the whole desk instead.'
              : 'Assigned to you, due now.'
          }
        />
        <div className="my-work-grid">
          <button className="my-work-cell" onClick={() => navigate('Activities')}>
            <strong className={queue.overdueTasks.length ? 'text-red' : ''}>
              {queue.overdueTasks.length}
            </strong>
            <span>Overdue</span>
          </button>
          <button className="my-work-cell" onClick={() => navigate('Activities')}>
            <strong>{queue.tasksToday.length}</strong>
            <span>Due today</span>
          </button>
          <button className="my-work-cell" onClick={() => navigate('Interviews')}>
            <strong>{queue.interviewsToday.length}</strong>
            <span>Interviews today</span>
          </button>
          <button className="my-work-cell" onClick={() => navigate('Demands')}>
            <strong>{queue.myDemands.length}</strong>
            <span>My open demands</span>
          </button>
          <button className="my-work-cell" onClick={() => navigate('Candidates')}>
            <strong>{queue.myCandidates.length}</strong>
            <span>My candidates</span>
          </button>
        </div>
        {queue.overdueTasks.length > 0 && (
          <ul className="client-list">
            {queue.overdueTasks.slice(0, 4).map((t) => (
              <li key={t.id}>
                <div>
                  <strong>{t.title}</strong>
                  <small>Due {t.due}</small>
                </div>
                <Badge tone="red">Overdue</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="dashboard-columns">
        <div className="main-column">
          <section className="match-banner">
            <div className="banner-icon">
              <Layers size={25} />
            </div>
            <div>
              <div className="eyebrow">REPOSITORY-FIRST RECRUITING</div>
              <h2>A new requirement. A head start.</h2>
              <p>
                Add a job description. Discover your strongest matches,
                <br className="desktop-break" /> understand the gaps, and build your shortlist.
              </p>
              {!viewer && (
                <button onClick={onNewDemand}>
                  Find matching talent <ArrowRight size={17} />
                </button>
              )}
            </div>
            <div className="orbit" aria-hidden="true">
              <div className="orbit-core">
                <Users size={29} />
              </div>
              <span className="orbit-person one">AM</span>
              <span className="orbit-person two">PS</span>
              <span className="orbit-person three">RI</span>
              <span className="orbit-check">
                <Check size={17} />
              </span>
            </div>
          </section>
          <section className="panel">
            <PanelHeading
              title="Active demands"
              subtitle="The right people for your next opportunity."
              action={<TextLink onClick={() => navigate('Demands')}>View all</TextLink>}
            />
            <div className="demand-list">
              {open.slice(0, 4).map((d, i) => {
                const matches = data.candidates.filter(
                  (c) => matchCandidate(c, d, data.assessments).score >= 70,
                ).length;
                return (
                  <button className="demand-row" key={d.id} onClick={() => openDemand(d.id)}>
                    <span className={`company-icon company-${i % 4}`}>
                      {d.client
                        .split(' ')
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join('')}
                    </span>
                    <span className="demand-info">
                      <strong>{d.title}</strong>
                      <small>
                        {d.client} <span>·</span> {d.location}
                      </small>
                    </span>
                    <span className="demand-meta">
                      <Badge>{d.priority}</Badge>
                      <small>
                        {d.positions} open {d.positions === 1 ? 'position' : 'positions'}
                      </small>
                    </span>
                    <span className="match-count">
                      <strong>{matches}</strong>
                      <small>70%+ matches</small>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                );
              })}
              {!open.length && (
                <Empty
                  title="Your first demand starts here"
                  text="Create a role to discover candidates in your repository."
                />
              )}
            </div>
          </section>
          <section className="panel pipeline-overview">
            <PanelHeading
              title="Hiring at a glance"
              subtitle="Active considerations across your demands"
              action={<TextLink onClick={() => navigate('Pipeline')}>Open pipeline</TextLink>}
            />
            <div className="funnel">
              {stages.map((s, i) => (
                <button key={s} onClick={() => navigate('Pipeline')}>
                  <span className="funnel-label">
                    <i
                      style={{
                        background: [
                          '#8098a0',
                          '#61a5a0',
                          '#42a992',
                          '#2a9686',
                          '#228373',
                          '#166759',
                        ][i],
                      }}
                    />
                    {s}
                  </span>
                  <strong>{data.considerations.filter((c) => c.stage === s).length}</strong>
                  <div
                    className="funnel-bar"
                    style={{
                      background: [
                        '#eaf0f2',
                        '#dcefea',
                        '#cae8dd',
                        '#afe0ce',
                        '#8bd0ba',
                        '#69bba0',
                      ][i],
                    }}
                  />
                </button>
              ))}
            </div>
          </section>
        </div>
        <aside className="right-column">
          <section className="panel followups">
            <PanelHeading title="On your radar" subtitle="Small actions. Stronger relationships." />
            <div className="radar-date">
              <CalendarDays size={15} />
              {new Date().toLocaleDateString('en-IN', {
                weekday: 'long',
                day: 'numeric',
                month: 'short',
              })}
            </div>
            {followups.slice(0, 3).map((n, i) => {
              const c = data.candidates.find((c) => c.id === n.candidateId);
              if (!c) return null;
              return (
                <div className="followup" key={n.id}>
                  <div className="followup-top">
                    <button className="person-compact" onClick={() => openCandidate(c.id)}>
                      <Avatar name={c.name} size="small" index={i} />
                      <strong>{c.name}</strong>
                    </button>
                    {!viewer && (
                      <button
                        className="complete-note"
                        aria-label={`Complete follow-up for ${c.name}`}
                        onClick={() => onComplete(n)}
                      >
                        <Check size={14} />
                      </button>
                    )}
                  </div>
                  <p>{n.text}</p>
                  <span className={`followup-due ${n.followUp <= today() ? 'due' : ''}`}>
                    <Clock size={12} />
                    {n.followUp === today()
                      ? 'Today'
                      : new Date(n.followUp + 'T00:00:00').toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                        })}
                  </span>
                </div>
              );
            })}
            {!followups.length && (
              <Empty
                title="All caught up"
                text="Follow-ups added to candidate profiles appear here."
              />
            )}
            <button className="panel-footer" onClick={() => navigate('Activities')}>
              View all activities <ArrowRight size={15} />
            </button>
          </section>
          <section className="panel health">
            <PanelHeading
              title="Repository health"
              action={
                <span className="tiny-icon">
                  <Database size={17} />
                </span>
              }
            />
            <div className="health-value">
              <strong>
                {data.candidates.length ? Math.round((fresh / data.candidates.length) * 100) : 0}
                <span>%</span>
              </strong>
              <span>
                profiles are
                <br />
                up to date
              </span>
            </div>
            <div className="health-bar">
              <i style={{ flex: fresh, background: '#269d83' }} />
              <i style={{ flex: aging, background: '#e8bc59' }} />
              <i style={{ flex: stale, background: '#e49c86' }} />
            </div>
            <div className="health-legend">
              {[
                ['Fresh', fresh, '#269d83'],
                ['Aging', aging, '#e8bc59'],
                ['Stale', stale, '#e49c86'],
              ].map(([l, v, c]) => (
                <div key={l}>
                  <span>
                    <i style={{ background: c }} />
                    {l}
                  </span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
            <button
              className="health-action"
              onClick={() => navigate('Candidates', { status: 'Stale' })}
            >
              Review stale profiles
              <ArrowUpRight size={14} />
            </button>
          </section>
          <div className="import-card">
            <div>
              <ArrowDownToLine size={21} />
              <h3>Grow your talent network</h3>
              <p>Bring your candidate spreadsheet into one searchable home.</p>
            </div>
            {!viewer && (
              <Button variant="secondary" onClick={onImport}>
                Import candidates <ArrowRight size={15} />
              </Button>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
