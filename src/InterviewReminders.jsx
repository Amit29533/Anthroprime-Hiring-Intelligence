import React, { useEffect, useState } from 'react';
import { cloud, getSupabase } from './repository.js';
import { Button, PanelHeading } from './ui.jsx';
async function reminderRpc(name, args) {
  const c = await getSupabase();
  const { data, error } = await c.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
export function InterviewReminders({ isCloud = cloud, rpc = reminderRpc }) {
  const [data, setData] = useState(null),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!isCloud) return;
    let active = true;
    setBusy(true);
    setError('');
    setData(null);
    rpc('api_interview_reminders', { p_offset: offset })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [isCloud, rpc, offset, revision]);
  if (!isCloud) return null;
  return (
    <section className="panel">
      <PanelHeading title="Internal interview reminders" />
      <div className="settings-body">
        <p>
          Create a shared preparation task within 60 minutes before a scheduled interview, even with
          the browser closed. No candidate email is sent. Rescheduling, panel changes or
          cancellation close the old reminder task. Pausing prevents new tasks and keeps existing
          tasks.
        </p>
        {error && <p role="alert">{error}</p>}
        <Button disabled={busy} onClick={() => setRevision((r) => r + 1)}>
          Refresh reminders
        </Button>
        {data && (
          <>
            <p role="status">
              Reminders {data.enabled ? 'enabled' : 'paused'}. Last worker run:{' '}
              {data.lastRun ? new Date(data.lastRun).toLocaleString() : 'not recorded'}.
            </p>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await rpc('api_set_interview_reminders', { p_enabled: !data.enabled });
                  setOffset(0);
                  setRevision((r) => r + 1);
                } catch (err) {
                  setError(err.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {data.enabled ? 'Pause interview reminders' : 'Enable interview reminders'}
            </Button>
            <p>
              Tasks appear in Notes &amp; Tasks after refreshing the workspace. Overdue interviews
              are skipped after an outage. Completing a task does not create another reminder for
              that schedule.
            </p>
            <ul>
              {data.rows.map((r) => (
                <li key={r.id}>
                  Interview {r.interviewId} — {new Date(r.scheduledAt).toLocaleString()} —{' '}
                  {
                    {
                      delivered: 'Task created',
                      cancelled: 'Cancelled; task closed',
                      retrying: 'Waiting to retry',
                      failed: 'Failed; review required',
                    }[r.status]
                  }
                  {r.lastError && <small>{r.lastError}</small>}
                  {r.status === 'failed' && (
                    <Button
                      disabled={busy || new Date(r.scheduledAt) <= new Date()}
                      onClick={async () => {
                        setBusy(true);
                        setError('');
                        try {
                          await rpc('api_retry_interview_reminder', { p_id: r.id });
                          setRevision((n) => n + 1);
                        } catch (err) {
                          setError(err.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Retry reminder
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {!data.rows.length && <p>No reminder receipts yet.</p>}
            <Button
              disabled={busy || offset === 0}
              onClick={() => setOffset((n) => Math.max(0, n - 50))}
            >
              Previous reminders
            </Button>
            <Button
              disabled={busy || offset >= 10000 || offset + 50 >= data.total}
              onClick={() => setOffset((n) => n + 50)}
            >
              Next reminders
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
