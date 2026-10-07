import React, { useEffect, useState } from 'react';
import { Button, Field } from './ui.jsx';
import { repositoryRead } from './pagedRepository.js';
import { getRole } from './repository.js';

const QUEUES = {
  'missing-email': 'Primary email missing',
  'missing-phone': 'Primary phone missing',
  'missing-availability': 'Notice period unknown',
  'stale-profile': 'Profile date older than 120 days or unknown',
  'future-profile-date': 'Profile date in the future',
  'missing-current-skill-evidence': 'No current validated skill evidence',
};

export function RepositoryQuality({ rpc = repositoryRead, onOpen, admin = getRole() === 'admin' }) {
  const [kind, setKind] = useState('stale-profile'),
    [cursors, setCursors] = useState([null]);
  const [page, setPage] = useState(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const [capacity, setCapacity] = useState(null),
    [capacityError, setCapacityError] = useState('');
  const cursor = cursors.at(-1);
  useEffect(() => {
    let active = true;
    setPage(null);
    setError('');
    rpc('api_repository_quality', { p_kind: kind, p_cursor: cursor })
      .then((value) => {
        if (
          !Array.isArray(value?.rows) ||
          value.rows.length > 25 ||
          !value.counts ||
          Array.isArray(value.counts) ||
          Object.values(value.counts).some((n) => !Number.isInteger(n) || n < 0) ||
          !Number.isInteger(value.affectedCandidates) ||
          value.affectedCandidates < 0 ||
          value.rows.some(
            (row) =>
              !row ||
              typeof row.id !== 'string' ||
              !Array.isArray(row.flags) ||
              row.flags.some((flag) => !QUEUES[flag]),
          )
        )
          throw new Error('Quality review returned an invalid response.');
        if (active) setPage(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [rpc, kind, cursor, revision]);
  useEffect(() => {
    let active = true;
    setCapacity(null);
    setCapacityError('');
    if (admin)
      rpc('api_anthro_id_capacity')
        .then((value) => {
          if (
            !['healthy', 'warning', 'critical', 'exhausted'].includes(value?.level) ||
            value.limit !== 99999 ||
            !Number.isInteger(value.remaining) ||
            value.remaining < 0 ||
            value.remaining > 99999 ||
            !Number.isInteger(value.consumed) ||
            value.consumed + value.remaining !== 99999
          )
            throw new Error('Anthro-ID capacity returned an invalid response.');
          if (active) setCapacity(value);
        })
        .catch((err) => {
          if (active) setCapacityError(err.message);
        });
    return () => {
      active = false;
    };
  }, [rpc, admin, revision]);
  const refresh = () => {
    setCursors([null]);
    setRevision((n) => n + 1);
  };
  return (
    <section className="panel" aria-label="Repository quality review">
      <div className="settings-body">
        <h2>Repository quality review</h2>
        <p>
          Review recorded facts without loading the complete workspace. Findings do not establish
          readiness or verify a candidate automatically.
        </p>
        <Field label="Quality queue">
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setCursors([null]);
            }}
          >
            {Object.entries(QUEUES).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Button variant="secondary" onClick={refresh}>
          Refresh quality review
        </Button>
        {error && <p role="alert">{error}</p>}
        {!page && !error && <p role="status">Loading quality findings…</p>}
        {page && (
          <>
            <p>
              {page.affectedCandidates} candidates have at least one finding. Queue counts overlap.
            </p>
            <ul>
              {Object.entries(QUEUES).map(([id, label]) => (
                <li key={id}>
                  {label}: {page.counts[id] || 0}
                </li>
              ))}
            </ul>
            <p>
              Dates use UTC. Current skill evidence means an observation weighted at least 70, dated
              within the past 365 days and no later than now. A recent self-declaration does not
              renew old validated evidence.
            </p>
            <p>
              Missing primary contacts remain findings even when an alternate contact exists.
              Profile dates do not prove that every fact is verified.
            </p>
            {!page.rows.length && <p>No matching findings on this page.</p>}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Recorded profile date</th>
                    <th>Findings</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.name}
                        <small className="block anthro-id">{row.anthroId}</small>
                      </td>
                      <td>{row.verified || 'Unknown'}</td>
                      <td>{row.flags.map((flag) => QUEUES[flag]).join('; ')}</td>
                      <td>
                        <Button variant="secondary" onClick={() => onOpen?.(row.id)}>
                          Review candidate {row.anthroId}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              variant="secondary"
              disabled={cursors.length === 1}
              onClick={() => setCursors((stack) => stack.slice(0, -1))}
            >
              Previous quality page
            </Button>
            <Button
              variant="secondary"
              disabled={!page.nextCursor}
              onClick={() => setCursors((stack) => [...stack, page.nextCursor])}
            >
              Next quality page
            </Button>
          </>
        )}
        {admin && (
          <>
            <h3>Anthro-ID capacity</h3>
            {capacityError && <p role="alert">{capacityError}</p>}
            {!capacity && !capacityError && <p role="status">Loading identity capacity…</p>}
            {capacity && (
              <div role={capacity.level === 'healthy' ? undefined : 'alert'}>
                <p>
                  {capacity.remaining.toLocaleString('en-IN')} allocations remain out of 99,999.
                  Status: {capacity.level}.
                </p>
                <p>
                  This namespace is shared across workspaces. Consumed positions include merged
                  identities, deleted records and failed allocations; numbers are never recycled.
                  This check allocates no ID.
                </p>
                {capacity.level !== 'healthy' && (
                  <p>
                    Review namespace expansion before accepting more imports. Preserve existing
                    Anthro-IDs.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
