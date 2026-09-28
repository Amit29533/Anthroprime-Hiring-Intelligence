import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  TriangleAlert,
  CalendarClock,
  Clock,
  Users,
} from 'lucide-react';
import { PanelHeading, Button, Field, Modal, Badge, Stat } from './ui.jsx';
import { uid } from './domain.js';
import { canWriteForRole, getRole } from './repository.js';
import {
  SLOT_MODES,
  weekGrid,
  scheduleTotals,
  formatTime,
  formatDayLabel,
  blankSlot,
  validateSlot,
  generateSlots,
  addDays,
  startOfWeek,
} from './schedule.js';

/** Week view of interviews and published availability, with clashes called out. */
export function InterviewCalendar({ data, onOpenCandidate, onPublish, role = getRole() }) {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
  const grid = weekGrid(data, anchor);
  const totals = scheduleTotals(data, anchor);
  const canEdit = canWriteForRole(role);

  return (
    <>
      <div className="stats-grid">
        <Stat label="Interviews this week" value={totals.thisWeek} icon={CalendarClock} />
        <Stat
          label="Times offered"
          value={totals.slotsOpen}
          detail="Awaiting a choice"
          icon={Clock}
          tone="blue"
        />
        <Stat
          label="Candidates deciding"
          value={totals.awaitingChoice}
          detail="Have slots to pick from"
          icon={Users}
          tone="teal"
        />
        <Stat
          label="Clashes"
          value={totals.conflicts}
          detail={totals.conflicts ? 'Same person, same time' : 'None this week'}
          icon={TriangleAlert}
          tone={totals.conflicts ? 'amber' : 'teal'}
        />
      </div>

      <section className="panel">
        <PanelHeading
          title={`${formatDayLabel(grid.start)} – ${formatDayLabel(grid.end)}`}
          subtitle="Interviews and the times you have offered, in your own timezone."
          action={
            <span className="cal-nav">
              <Button variant="secondary" onClick={() => setAnchor(addDays(anchor, -7))}>
                <ChevronLeft size={15} />
              </Button>
              <Button variant="secondary" onClick={() => setAnchor(startOfWeek(new Date()))}>
                This week
              </Button>
              <Button variant="secondary" onClick={() => setAnchor(addDays(anchor, 7))}>
                <ChevronRight size={15} />
              </Button>
              {canEdit && onPublish && <Button onClick={onPublish}>Offer times</Button>}
            </span>
          }
        />
        <div className="cal-week">
          {grid.days.map((day) => (
            <div key={day.date.toISOString()} className={`cal-day ${day.isToday ? 'today' : ''}`}>
              <h4>
                {formatDayLabel(day.date)}
                {day.conflicts > 0 && <Badge tone="amber">{day.conflicts}</Badge>}
              </h4>
              {day.entries.length === 0 ? (
                <p className="cal-empty">—</p>
              ) : (
                day.entries.map((e) => (
                  <button
                    key={e.id}
                    className={`cal-entry ${e.kind} ${e.conflict ? 'clash' : ''}`}
                    onClick={() => e.candidateId && onOpenCandidate?.(e.candidateId)}
                    title={e.conflict ? 'Clashes with another commitment for the same person' : ''}
                  >
                    <strong>
                      {formatTime(e.startsAt)} {e.title}
                    </strong>
                    <small>
                      {e.subtitle}
                      {e.conflict && ' · clash'}
                    </small>
                  </button>
                ))
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/**
 * Publish times a candidate can choose from. Offering several at once is the point — publishing
 * one at a time is the friction this replaces.
 */
export function SlotPublisher({ data, candidateId, demandId, onClose, onSave, notify, busy }) {
  const [form, setForm] = useState(() => blankSlot(candidateId || null, demandId || null));
  const [count, setCount] = useState(3);
  const [everyMins, setEveryMins] = useState(60);
  const [errors, setErrors] = useState({});
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const candidates = data.candidates || [];
  const openDemands = (data.demands || []).filter((d) => d.status === 'Open');

  async function submit(e) {
    e.preventDefault();
    const found = validateSlot(form, data.interviewSlots || []);
    setErrors(found);
    if (Object.keys(found).length) return;
    const run = generateSlots(form, {
      count: Number(count) || 1,
      everyMins: Number(everyMins) || 60,
    });
    // Each generated time is checked too, so a run cannot quietly collide with existing offers.
    const rows = [];
    const clashes = [];
    for (const slot of run) {
      const problem = validateSlot(slot, [...(data.interviewSlots || []), ...rows]);
      if (Object.keys(problem).length) clashes.push(slot.startsAt);
      else rows.push({ ...slot, id: uid(), demandId: slot.demandId || null });
    }
    if (!rows.length) {
      setErrors({ startsAt: 'Every time in that run is already published.' });
      return;
    }
    if (!(await onSave('interviewSlots', rows))) return;
    notify?.(
      `${rows.length} time${rows.length === 1 ? '' : 's'} offered${
        clashes.length ? `, ${clashes.length} skipped as already published` : ''
      }.`,
    );
    onClose();
  }

  return (
    <Modal
      title="Offer interview times"
      subtitle="The candidate picks one in their portal. Choosing a time withdraws the others automatically."
      onClose={onClose}
      wide
    >
      <form className="modal-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Candidate" hint={errors.candidateId}>
            <select
              value={form.candidateId || ''}
              onChange={set('candidateId')}
              aria-invalid={!!errors.candidateId}
            >
              <option value="">Choose a candidate…</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Role">
            <select value={form.demandId || ''} onChange={set('demandId')}>
              <option value="">No specific role</option>
              {openDemands.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} — {d.client}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Interviewer" hint={errors.interviewer}>
            <input
              value={form.interviewer}
              onChange={set('interviewer')}
              aria-invalid={!!errors.interviewer}
            />
          </Field>
          <Field label="Round">
            <input value={form.round} onChange={set('round')} />
          </Field>
          <Field label="First time" hint={errors.startsAt}>
            <input
              type="datetime-local"
              value={form.startsAt}
              onChange={set('startsAt')}
              aria-invalid={!!errors.startsAt}
            />
          </Field>
          <Field label="Length (minutes)" hint={errors.durationMins}>
            <input
              type="number"
              min="5"
              max="480"
              value={form.durationMins}
              onChange={set('durationMins')}
            />
          </Field>
          <Field label="How many times to offer">
            <input
              type="number"
              min="1"
              max="12"
              value={count}
              onChange={(e) => setCount(e.target.value)}
            />
          </Field>
          <Field label="Spaced apart by (minutes)">
            <input
              type="number"
              min="15"
              max="480"
              value={everyMins}
              onChange={(e) => setEveryMins(e.target.value)}
            />
          </Field>
          <Field label="Mode" hint={errors.mode}>
            <select value={form.mode} onChange={set('mode')}>
              {SLOT_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Location or link">
            <input
              value={form.location}
              onChange={set('location')}
              placeholder="Meet link or office"
            />
          </Field>
        </div>
        <div className="modal-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Offer {count} time{Number(count) === 1 ? '' : 's'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
