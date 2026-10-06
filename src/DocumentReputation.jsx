import React, { useEffect, useState } from 'react';
import { cloud, getSupabase } from './repository.js';
import { Button, PanelHeading } from './ui.jsx';

export async function reputationRequest(body) {
  const client = await getSupabase();
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error('Sign in again to check document reputation.');
  const response = await fetch('/.netlify/functions/document-reputation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Reputation lookup failed.');
  return result;
}
const LABELS = {
  unknown: 'Unknown to VirusTotal — unverified',
  incomplete: 'Incomplete report — unverified',
  stale: 'Report older than 30 days or undated — unverified',
  detections: 'Threat detections reported — review before use',
  no_known_detections: 'No known detections in the existing report',
};
export function DocumentReputation({
  documents = [],
  isCloud = cloud,
  request = reputationRequest,
}) {
  const [config, setConfig] = useState(null),
    [selected, setSelected] = useState('');
  const [result, setResult] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isCloud) return;
    let active = true;
    Promise.resolve()
      .then(() => request({ action: 'status' }))
      .then((value) => {
        if (active) setConfig(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [isCloud, request]);
  if (!isCloud) return null;
  async function check() {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await request({ action: 'lookup', documentId: selected }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <PanelHeading
        title="VirusTotal document reputation"
        subtitle="Checks an existing file report using its SHA-256 hash"
      />
      <div className="settings-body">
        <p>
          Set VIRUSTOTAL_API_KEY in the hosting provider’s server environment settings. Confirm your
          commercial-use license with VIRUSTOTAL_USAGE_TIER=commercial. The key stays on the server.
        </p>
        {config && (
          <p>
            API key: {config.configured ? 'configured' : 'not configured'} · Commercial-use
            configuration: {config.licensed ? 'confirmed by deployment setting' : 'not confirmed'}
          </p>
        )}
        <p>
          Only the file hash is sent to VirusTotal. CV contents and download links are not uploaded.
          This is a reputation check, not a fresh antivirus scan or a safety guarantee.
        </p>
        <p>
          Only documents with a full SHA-256 fingerprint can be checked. Older truncated
          fingerprints require rehashing the original file.
        </p>
        <label>
          Document
          <select
            aria-label="Document reputation file"
            disabled={busy}
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setResult(null);
              setError('');
            }}
          >
            <option value="">Choose a document…</option>
            {documents
              .filter((d) => !d.removed && /^[a-f0-9]{64}$/i.test(d.hash || ''))
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </label>
        <Button
          disabled={busy || !selected || !config?.configured || !config?.licensed}
          onClick={check}
        >
          Check VirusTotal reputation
        </Button>
        {busy && <p role="status">Checking reputation…</p>}
        {error && <p role="alert">{error}</p>}
        {result && (
          <div role="status">
            <strong>{LABELS[result.status] || 'Unverified report'}</strong>
            {result.completedEngines != null && (
              <p>
                {result.detections} detections across {result.completedEngines} completed engine
                results.
              </p>
            )}
            {result.analysedAt && (
              <p>Report analysed: {new Date(result.analysedAt).toLocaleString()}</p>
            )}
            <p>The result does not change document permissions or mark the file safe.</p>
          </div>
        )}
      </div>
    </section>
  );
}
