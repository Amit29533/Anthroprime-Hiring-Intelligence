import React, { useState } from 'react';
import { Plus, Layers, Pencil, Archive } from 'lucide-react';
import { Button, PanelHeading, Field, Modal, SearchBox, PersonName, Badge, Empty } from './ui.jsx';
import { uid, today } from './domain.js';
import { getRole, canWriteForRole } from './repository.js';
import { staticPoolMembers, validatePool } from './pools.js';

export function StaticPools({ data, onOpen, onSave, busy, role = getRole() }) {
  const [selected, setSelected] = useState(''),
    [draft, setDraft] = useState(null),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [picker, setPicker] = useState(false),
    [picked, setPicked] = useState([]),
    [archived, setArchived] = useState(false);
  const editable = canWriteForRole(role) && Boolean(onSave);
  const pools = data.talentPools || [];
  const pool = pools.find((row) => row.id === selected);
  const members = pool ? staticPoolMembers(data, pool.id) : [];
  const candidates = data.candidates.filter(
    (c) =>
      !members.some((member) => member.id === c.id) &&
      `${c.name} ${c.title} ${c.skills.join(' ')}`.toLowerCase().includes(query.toLowerCase()),
  );
  async function save(event) {
    event.preventDefault();
    const problem = validatePool(draft, pools);
    if (problem) return setError(problem);
    const row = {
      ...draft,
      id: draft.id || uid(),
      name: draft.name.trim(),
      created: draft.created || today(),
    };
    if (await onSave('talentPools', [row])) {
      setSelected(row.id);
      setDraft(null);
    }
  }
  async function addMembers() {
    const rows = picked
      .filter(
        (id) =>
          data.candidates.some((c) => c.id === id) && !members.some((member) => member.id === id),
      )
      .map((candidateId) => {
        const existing = (data.poolMembers || []).find(
          (row) => row.poolId === pool.id && row.candidateId === candidateId,
        );
        return {
          id: existing?.id || uid(),
          poolId: pool.id,
          candidateId,
          active: true,
          created: existing?.created || today(),
        };
      });
    if (rows.length && (await onSave('poolMembers', rows))) {
      setPicker(false);
      setPicked([]);
    }
  }
  async function removeMember(candidateId) {
    const row = data.poolMembers.find(
      (member) =>
        member.poolId === pool.id && member.candidateId === candidateId && member.active !== false,
    );
    if (row) await onSave('poolMembers', [{ ...row, active: false }]);
  }
  return (
    <section className="static-pools">
      <PanelHeading
        title="Curated talent pools"
        subtitle="Keep a handpicked group together as skills and availability change."
        action={
          editable && (
            <Button
              icon={Plus}
              disabled={busy}
              onClick={() => {
                setDraft({ name: '', description: '', archived: false });
                setError('');
              }}
            >
              Create pool
            </Button>
          )
        }
      />
      <label className="checkbox-label library-filter">
        <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
        Show archived pools
      </label>
      <div className="pools-grid">
        {pools
          .filter((row) => archived || !row.archived)
          .map((row) => (
            <button
              className={`pool-card ${selected === row.id ? 'selected' : ''}`}
              key={row.id}
              onClick={() => setSelected(selected === row.id ? '' : row.id)}
            >
              <span className="pool-icon violet">
                <Layers size={24} />
              </span>
              <h2>{row.name}</h2>
              <p>{row.description}</p>
              <div>
                <span>{staticPoolMembers(data, row.id).length} candidates</span>
                <Badge>{row.archived ? 'Archived' : 'Curated'}</Badge>
              </div>
            </button>
          ))}
      </div>
      {!pools.some((row) => archived || !row.archived) && (
        <p className="supporting-text library-empty">
          Create a curated pool for silver medalists, a client shortlist or a specialist community.
          Dynamic pools remain available below.
        </p>
      )}
      {pool && (
        <section className="panel pool-members">
          <PanelHeading
            title={pool.name}
            subtitle={
              pool.archived
                ? 'Archived pool · membership is preserved'
                : 'Membership is maintained by your team'
            }
            action={
              editable && (
                <div className="heading-actions">
                  {!pool.archived && (
                    <Button
                      icon={Plus}
                      disabled={busy}
                      onClick={() => {
                        setPicker(true);
                        setQuery('');
                        setPicked([]);
                      }}
                    >
                      Add members
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    icon={Pencil}
                    disabled={busy}
                    onClick={() => {
                      setDraft({ ...pool });
                      setError('');
                    }}
                  >
                    Edit pool
                  </Button>
                  <Button
                    variant="ghost"
                    icon={Archive}
                    disabled={busy}
                    onClick={() => onSave('talentPools', [{ ...pool, archived: !pool.archived }])}
                  >
                    {pool.archived ? 'Restore pool' : 'Archive pool'}
                  </Button>
                </div>
              )
            }
          />
          <div className="people-grid">
            {members.map((person, i) => (
              <div className="pool-person" key={person.id}>
                <PersonName person={person} index={i} onClick={() => onOpen(person.id)} />
                <Badge>{person.status}</Badge>
                {editable && !pool.archived && (
                  <Button variant="ghost" disabled={busy} onClick={() => removeMember(person.id)}>
                    Remove {person.name}
                  </Button>
                )}
              </div>
            ))}
          </div>
          {!members.length && (
            <Empty
              title="Choose people for this pool"
              text="Add members from your repository. Removing a membership keeps the candidate profile."
            />
          )}
        </section>
      )}
      {draft && (
        <Modal
          title={draft.id ? 'Edit talent pool' : 'Create talent pool'}
          onClose={() => !busy && setDraft(null)}
        >
          <form onSubmit={save}>
            <div className="modal-body form-grid">
              <Field label="Pool name *" wide>
                <input
                  required
                  maxLength={120}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="Pool description" wide>
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </Field>
              {error && (
                <p className="form-error wide" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="modal-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Save pool
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {picker && pool && (
        <Modal title={`Add members to ${pool.name}`} onClose={() => !busy && setPicker(false)} wide>
          <div className="modal-body">
            <SearchBox value={query} onChange={setQuery} placeholder="Search repository members…" />
            <div className="pool-picker">
              {candidates.map((c) => (
                <label key={c.id}>
                  <input
                    type="checkbox"
                    checked={picked.includes(c.id)}
                    onChange={(e) =>
                      setPicked(
                        e.target.checked ? [...picked, c.id] : picked.filter((id) => id !== c.id),
                      )
                    }
                  />
                  <span>
                    <strong>{c.name}</strong>
                    <small>{c.title}</small>
                  </span>
                </label>
              ))}
            </div>
            {!candidates.length && (
              <Empty
                title="No additional candidates"
                text="Try a different search or add candidates to the repository."
              />
            )}
          </div>
          <div className="modal-actions">
            <Button variant="secondary" disabled={busy} onClick={() => setPicker(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !picked.length} onClick={addMembers}>
              Add {picked.length} members
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
