import { candidateLabel } from './anthroId.js';
import React, { useState, useEffect } from 'react';
import { cloud, canWriteForRole, getRole } from './repository.js';
import { intelligenceRpc, intelligenceRequest, localVector } from './intelligence.js';
import { Button, PanelHeading } from './ui.jsx';

export function HostedIntelligence({
  candidates = [],
  onOpen,
  rpc = intelligenceRpc,
  request = intelligenceRequest,
  isCloud = cloud,
}) {
  const [query, setQuery] = useState(''),
    [matches, setMatches] = useState(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0),
    [candidate, setCandidate] = useState(''),
    [drafts, setDrafts] = useState([]),
    [edits, setEdits] = useState({}),
    [location, setLocation] = useState(''),
    [status, setStatus] = useState(''),
    [experience, setExperience] = useState(0);
  const writable = canWriteForRole(getRole());
  async function run(action) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function loadDrafts() {
    setDrafts(await rpc('api_intelligence_drafts', { p_candidate: candidate || null }));
  }
  if (!isCloud) return null;
  return (
    <section className="panel intelligence-panel">
      <PanelHeading
        title="Hosted talent intelligence"
        subtitle="Search the shared repository. Keep deterministic matching or enable optional AI through workspace settings."
      />
      <div className="settings-body">
        <div className="section-toolbar">
          <label>
            Talent query
            <input
              aria-label="Hosted talent query"
              value={query}
              maxLength={4000}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="React engineer with cloud experience"
            />
          </label>
          <label>
            Location
            <input
              aria-label="Hosted location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Exact location"
            />
          </label>
          <label>
            Status
            <select
              aria-label="Hosted status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Any status</option>
              {['Ready', 'Near-ready', 'Assessing', 'Unavailable'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Minimum experience
            <input
              aria-label="Hosted minimum experience"
              type="number"
              min={0}
              max={60}
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
            />
          </label>
          <Button
            disabled={busy || !query.trim()}
            onClick={() =>
              run(async () =>
                setMatches(
                  await rpc('api_hosted_search', {
                    p_vector: localVector(query),
                    p_location: location,
                    p_status: status,
                    p_min_experience: Number(experience) || 0,
                  }),
                ),
              )
            }
          >
            Search shared index
          </Button>
          {writable && (
            <Button
              variant="secondary"
              disabled={busy || !query.trim() || !!location || !!status || Number(experience) > 0}
              onClick={() =>
                run(async () => setMatches((await request('query', null, query)).matches))
              }
            >
              AI search
            </Button>
          )}
        </div>
        <p>
          Shared-index search uses locally computed text features without an external provider. AI
          search requires AI indexing of candidates with the same provider model; use shared search
          when filters are selected. With the index worker deployed, new and changed profiles are
          indexed automatically. Manual refresh remains available.
        </p>
        {writable && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const rows = await rpc('api_index_candidates', { p_offset: offset });
                for (const row of rows)
                  await rpc('api_index_candidate', {
                    p_id: row.id,
                    p_fingerprint: row.fingerprint,
                    p_vector: localVector(row.text),
                  });
                setOffset(rows.length === 20 ? offset + rows.length : 0);
                setMessage(
                  rows.length === 20
                    ? `Indexed ${rows.length} candidates. Click again for the next batch.`
                    : `Indexed ${rows.length} candidates. Index pass complete.`,
                );
              })
            }
          >
            {offset ? 'Index next 20 candidates' : 'Refresh shared index'}
          </Button>
        )}
        {matches && (
          <div>
            {matches.length === 0 ? (
              <p>No indexed matches. Refresh the index after editing candidates.</p>
            ) : (
              matches.map((row) => (
                <div className="section-toolbar" key={row.id}>
                  <Button variant="secondary" onClick={() => onOpen(row.id)}>
                    {candidateLabel(row)}
                  </Button>
                  <span>
                    {row.title} · {row.location} · Similarity {Math.round(row.similarity * 100)}%
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        {writable && (
          <>
            <hr />
            <label>
              Candidate for AI review
              <select
                aria-label="AI review candidate"
                value={candidate}
                onChange={(e) => {
                  setCandidate(e.target.value);
                  setDrafts([]);
                }}
              >
                <option value="">Choose candidate</option>
                {candidates
                  .filter((c) => !c.mergedInto)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {candidateLabel(c)}
                    </option>
                  ))}
              </select>
            </label>
            <div className="section-toolbar">
              <Button
                variant="secondary"
                disabled={busy || !candidate}
                onClick={() =>
                  run(async () => {
                    await request('embedding', candidate);
                    setMessage('Candidate indexed for AI search.');
                  })
                }
              >
                Index for AI search
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => run(loadDrafts)}>
                Load drafts
              </Button>
            </div>
            <p>
              Create new cited highlights in the Stage 4 controlled workflows panel. Legacy AI
              indexing receives title, skills, experience, location and work mode. Contact details,
              CV files, employer names and notes are excluded. Review facts before approving.
              Approved drafts stay separate from candidate profiles.
            </p>
            {drafts.map((draft) => (
              <div key={draft.id} className="panel settings-body">
                <strong>
                  {draft.name} · {draft.status}
                </strong>
                <p>
                  {draft.model} · {draft.version}
                  {!draft.current && ' · Candidate changed: regenerate before approval'}
                </p>
                <textarea
                  aria-label={`Draft for ${draft.name}`}
                  maxLength={5000}
                  rows={5}
                  value={edits[draft.id] ?? draft.content}
                  readOnly={draft.status !== 'draft'}
                  onChange={(e) => setEdits({ ...edits, [draft.id]: e.target.value })}
                />
                {draft.status === 'draft' && (
                  <div className="section-toolbar">
                    <Button
                      disabled={busy || !draft.current}
                      onClick={() =>
                        run(async () => {
                          await rpc('api_review_intelligence', {
                            p_id: draft.id,
                            p_approve: true,
                            p_content: edits[draft.id] ?? draft.content,
                          });
                          await loadDrafts();
                        })
                      }
                    >
                      Approve reviewed draft
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await rpc('api_review_intelligence', {
                            p_id: draft.id,
                            p_approve: false,
                          });
                          await loadDrafts();
                        })
                      }
                    >
                      Reject draft
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}

export function IntelligenceSettings({ rpc = intelligenceRpc, isCloud = cloud }) {
  const [settings, setSettings] = useState(null),
    [limit, setLimit] = useState(20),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isCloud) return;
    let alive = true;
    rpc('api_intelligence_settings')
      .then((value) => {
        if (alive) {
          setSettings(value);
          setLimit(value.dailyLimit);
        }
      })
      .catch((err) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [rpc, isCloud]);
  async function save(enabled) {
    setBusy(true);
    setError('');
    try {
      setSettings(
        await rpc('api_intelligence_settings', {
          p_operation: 'save',
          p_enabled: enabled,
          p_daily_limit: Number(limit),
        }),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  if (!isCloud) return null;
  return (
    <section className="panel">
      <PanelHeading
        title="Optional AI provider"
        subtitle="External processing is disabled until an administrator enables it."
      />
      <div className="settings-body">
        <p>
          Enabling sends selected professional fields and AI search queries to the configured OpenAI
          API. API charges are separate from hosting. Configure server credentials first. The
          request limit includes failed calls and resets at midnight UTC.
        </p>
        {settings && (
          <>
            <p>
              {settings.enabled ? 'External AI enabled' : 'External AI disabled'} ·{' '}
              {settings.usedToday} requests used today
            </p>
            <label>
              Daily request limit
              <input
                aria-label="Daily AI request limit"
                type="number"
                min={1}
                max={100}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </label>
            <Button
              disabled={busy || Number(limit) < 1 || Number(limit) > 100}
              onClick={() => save(!settings.enabled)}
            >
              {settings.enabled ? 'Disable external AI' : 'Enable external AI'}
            </Button>
            <Button
              variant="secondary"
              disabled={busy || Number(limit) < 1 || Number(limit) > 100}
              onClick={() => save(settings.enabled)}
            >
              Save request limit
            </Button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}

export function IndexHealthPanel({ rpc = intelligenceRpc, isCloud = cloud }) {
  const [health, setHealth] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!isCloud) return;
    let alive = true;
    rpc('api_index_health')
      .then((value) => {
        if (alive) setHealth(value);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [rpc, isCloud]);
  async function refresh(retry = false) {
    setBusy(true);
    setError('');
    try {
      setHealth(await rpc('api_index_health', { p_retry_failed: retry }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  if (!isCloud) return null;
  return (
    <section className="panel">
      <PanelHeading
        title="Automatic search indexing"
        subtitle="Private shared-index maintenance continues when the browser is closed."
      />
      <div className="settings-body">
        <p>
          Candidate changes enter a durable queue. The scheduled worker computes local text
          features, without sending data to an AI provider. Changed or merged profiles cannot appear
          using outdated vectors.
        </p>
        {health && (
          <p>
            {health.indexed} indexed · {health.pending} pending · {health.processing} processing ·{' '}
            {health.failed} failed
          </p>
        )}
        <Button variant="secondary" disabled={busy} onClick={() => refresh()}>
          Refresh index health
        </Button>
        <Button
          variant="secondary"
          disabled={busy || !health?.failed}
          onClick={() => refresh(true)}
        >
          Retry failed indexing
        </Button>
        {health?.failedJobs?.map((job) => (
          <p key={job.candidate_id}>
            {job.name} · {job.attempts} indexing attempts
          </p>
        ))}
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
