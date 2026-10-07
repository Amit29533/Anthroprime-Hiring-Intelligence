import React, { useEffect, useRef, useState } from 'react';
import { Button, Field } from './ui.jsx';
import { repositoryRead } from './pagedRepository.js';

const textFields = ['name', 'title', 'company', 'location', 'summary'];
const numberFields = ['experience', 'relevantExperience', 'notice'];
const labels = {
  name: 'Candidate name',
  title: 'Job title',
  company: 'Company',
  location: 'Location',
  summary: 'Profile summary',
  experience: 'Total experience (years)',
  relevantExperience: 'Relevant experience (years)',
  notice: 'Notice period (days)',
};
export default function CandidateProfileEditor({ candidateId, rpc = repositoryRead, onUpdated }) {
  const [draft, setDraft] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function checked(value) {
    if (
      value?.candidateId !== candidateId ||
      !/^[a-f0-9]{32}$/.test(value.token || '') ||
      !value.fields ||
      [...textFields, ...numberFields].some((k) => !(k in value.fields))
    )
      throw new Error('Profile editor returned an invalid response.');
    return value;
  }
  async function run(save = false) {
    setBusy(true);
    setError('');
    try {
      const fields = save
        ? Object.fromEntries(
            [...textFields, ...numberFields].map((k) => [
              k,
              numberFields.includes(k)
                ? draft.fields[k] === '' || draft.fields[k] == null
                  ? null
                  : Number(draft.fields[k])
                : draft.fields[k],
            ]),
          )
        : null;
      const value = checked(
        await rpc(
          save ? 'api_candidate_profile_edit' : 'api_candidate_profile_context',
          save
            ? { p_candidate: candidateId, p_token: draft.token, p_fields: fields }
            : { p_candidate: candidateId },
        ),
      );
      if (alive.current) {
        if (save) {
          setDraft(null);
          onUpdated(value.fields);
        } else setDraft(value);
      }
    } catch (err) {
      if (alive.current) setError(err.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section aria-label="Profile facts editor">
      {error && <p role="alert">{error}</p>}
      {!draft ? (
        <Button disabled={busy} onClick={() => run()}>
          Edit profile facts
        </Button>
      ) : (
        <form
          aria-label="Edit profile facts"
          onSubmit={(e) => {
            e.preventDefault();
            run(true);
          }}
        >
          <p>
            Blank numbers mean unknown; zero is a known value. Saving records the previous profile
            in history.
          </p>
          {[...textFields, ...numberFields].map((k) => (
            <Field key={k} label={labels[k]}>
              <input
                aria-label={labels[k]}
                disabled={busy}
                type={numberFields.includes(k) ? 'number' : 'text'}
                required={k === 'name'}
                maxLength={k === 'summary' ? 10000 : 300}
                min={0}
                max={k === 'notice' ? 3650 : 100}
                step={k === 'notice' ? 1 : 'any'}
                value={draft.fields[k] ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, fields: { ...draft.fields, [k]: e.target.value } })
                }
              />
            </Field>
          ))}
          <Button type="submit" disabled={busy}>
            Save profile facts
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => run()}>
            Reload profile fields
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setDraft(null);
              setError('');
            }}
          >
            Cancel profile edit
          </Button>
        </form>
      )}
    </section>
  );
}
