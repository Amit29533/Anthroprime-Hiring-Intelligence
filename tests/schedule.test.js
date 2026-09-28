import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SLOT_MODES,
  DEFAULT_DURATION,
  startOfDay,
  startOfWeek,
  addDays,
  sameDay,
  minutesInDay,
  scheduleEntries,
  overlaps,
  findConflicts,
  weekGrid,
  blankSlot,
  validateSlot,
  generateSlots,
  slotsForCandidate,
  scheduleTotals,
} from '../src/schedule.js';
import { normalizeData, emptyData } from '../src/schema.js';

/** A fixed Wednesday, built in local time so the tests are timezone-independent. */
const WED = new Date(2026, 8, 30, 9, 0, 0);
const at = (dayOffset, hour, min = 0) =>
  new Date(2026, 8, 30 + dayOffset, hour, min, 0).toISOString();

const world = (over = {}) =>
  normalizeData({
    ...emptyData(),
    candidates: [
      { id: 'c1', name: 'Aarav', skills: [] },
      { id: 'c2', name: 'Bhavna', skills: [] },
    ],
    demands: [{ id: 'd1', title: 'Data Engineer', client: 'Meridian', skills: [] }],
    interviews: [
      {
        id: 'i1',
        candidateId: 'c1',
        demandId: 'd1',
        round: 'Round 1',
        mode: 'Video',
        scheduledAt: at(0, 10),
        durationMins: 45,
        interviewers: ['Priya Raman'],
        status: 'Scheduled',
      },
      {
        id: 'i2',
        candidateId: 'c2',
        demandId: 'd1',
        round: 'Round 1',
        mode: 'Video',
        scheduledAt: at(1, 14),
        durationMins: 60,
        interviewers: ['Vikram Shah'],
        status: 'Scheduled',
      },
      {
        id: 'i3',
        candidateId: 'c1',
        demandId: 'd1',
        scheduledAt: at(0, 16),
        durationMins: 30,
        interviewers: [],
        status: 'Cancelled',
      },
    ],
    interviewSlots: [
      {
        id: 's1',
        candidateId: 'c2',
        demandId: 'd1',
        interviewer: 'Priya Raman',
        round: 'Round 2',
        mode: 'Video',
        startsAt: at(2, 11),
        durationMins: 45,
        status: 'Open',
      },
      {
        id: 's2',
        candidateId: 'c1',
        demandId: 'd1',
        interviewer: 'Priya Raman',
        round: 'Round 2',
        mode: 'Video',
        startsAt: at(3, 11),
        durationMins: 45,
        status: 'Booked',
      },
    ],
    ...over,
  });

test('week boundaries are Monday-based and timezone-local', () => {
  const monday = startOfWeek(WED);
  assert.equal(monday.getDay(), 1, 'weeks start on Monday for a working calendar');
  assert.equal(monday.getHours(), 0);
  assert.equal(startOfDay(WED).getHours(), 0);
  assert.equal(addDays(monday, 6).getDay(), 0, 'and end on Sunday');
  assert.equal(sameDay(WED, new Date(2026, 8, 30, 23, 59)), true);
  assert.equal(sameDay(WED, new Date(2026, 9, 1)), false);
  assert.equal(minutesInDay(new Date(2026, 8, 30, 9, 30)), 570);
  // A Monday must map to itself, not to the previous week.
  assert.equal(startOfWeek(new Date(2026, 8, 28)).getDate(), 28);
});

test('cancelled interviews and booked slots stay off the calendar', () => {
  const entries = scheduleEntries(world());
  const ids = entries.map((e) => e.id);
  assert.ok(!ids.includes('i3'), 'a cancelled interview is not a commitment');
  assert.ok(!ids.includes('s2'), 'a booked slot already appears as its interview');
  assert.deepEqual(ids, ['i1', 'i2', 's1'], 'and everything is in time order');
  assert.equal(entries[0].title, 'Aarav', 'an interview is labelled by who it is with');
  assert.equal(entries[2].title, 'Offered to Bhavna', 'an open slot says it is only an offer');
  assert.deepEqual(
    scheduleEntries(world(), { includeSlots: false }).map((e) => e.id),
    ['i1', 'i2'],
  );
});

test('overlap is computed from duration, not just start time', () => {
  const a = { startsAt: at(0, 10), durationMins: 45 };
  const b = { startsAt: at(0, 10, 30), durationMins: 30 };
  const c = { startsAt: at(0, 11), durationMins: 30 };
  assert.equal(overlaps(a, b), true, '10:00–10:45 and 10:30–11:00 collide');
  assert.equal(overlaps(a, c), false, '10:00–10:45 and 11:00 do not');
  assert.equal(overlaps(b, c), false, 'touching at 11:00 exactly is not an overlap');
});

test('a clash needs both an overlap and a shared person', () => {
  // Same interviewer, overlapping times.
  const clash = world({
    interviews: [
      {
        id: 'i1',
        candidateId: 'c1',
        scheduledAt: at(0, 10),
        durationMins: 60,
        interviewers: ['Priya Raman'],
        status: 'Scheduled',
      },
      {
        id: 'i2',
        candidateId: 'c2',
        scheduledAt: at(0, 10, 30),
        durationMins: 30,
        interviewers: ['priya raman'],
        status: 'Scheduled',
      },
    ],
    interviewSlots: [],
  });
  assert.deepEqual(
    [...findConflicts(scheduleEntries(clash))].sort(),
    ['i1', 'i2'],
    'matched case-insensitively',
  );

  // Overlapping, but different people — two recruiters can interview at once.
  const fine = world({
    interviews: [
      {
        id: 'i1',
        candidateId: 'c1',
        scheduledAt: at(0, 10),
        durationMins: 60,
        interviewers: ['Priya'],
        status: 'Scheduled',
      },
      {
        id: 'i2',
        candidateId: 'c2',
        scheduledAt: at(0, 10, 30),
        durationMins: 30,
        interviewers: ['Vikram'],
        status: 'Scheduled',
      },
    ],
    interviewSlots: [],
  });
  assert.equal(findConflicts(scheduleEntries(fine)).size, 0);

  // The candidate is a person too: one candidate cannot be in two interviews at once.
  const candidateClash = world({
    interviews: [
      {
        id: 'i1',
        candidateId: 'c1',
        scheduledAt: at(0, 10),
        durationMins: 60,
        interviewers: ['Priya'],
        status: 'Scheduled',
      },
      {
        id: 'i2',
        candidateId: 'c1',
        scheduledAt: at(0, 10, 30),
        durationMins: 30,
        interviewers: ['Vikram'],
        status: 'Scheduled',
      },
    ],
    interviewSlots: [],
  });
  assert.equal(
    findConflicts(scheduleEntries(candidateClash)).size,
    2,
    'the candidate is double-booked',
  );
});

test('a published slot can clash with a real interview', () => {
  const data = world({
    interviews: [
      {
        id: 'i1',
        candidateId: 'c1',
        scheduledAt: at(0, 10),
        durationMins: 60,
        interviewers: ['Priya Raman'],
        status: 'Scheduled',
      },
    ],
    interviewSlots: [
      {
        id: 's1',
        candidateId: 'c2',
        interviewer: 'Priya Raman',
        startsAt: at(0, 10, 30),
        durationMins: 45,
        status: 'Open',
      },
    ],
  });
  assert.equal(
    findConflicts(scheduleEntries(data)).size,
    2,
    'offering a time the interviewer is already busy is exactly the mistake to catch',
  );
});

test('the week grid has seven days and marks the clashes', () => {
  const grid = weekGrid(world(), WED);
  assert.equal(grid.days.length, 7);
  assert.equal(grid.days[0].date.getDay(), 1, 'starting Monday');
  const wednesday = grid.days.find((d) => sameDay(d.date, WED));
  assert.deepEqual(
    wednesday.entries.map((e) => e.id),
    ['i1'],
  );
  assert.equal(grid.total, 3, 'every entry is counted, across the whole set');
  assert.equal(typeof grid.days[0].isToday, 'boolean');
  for (const day of grid.days)
    for (const entry of day.entries) assert.equal(typeof entry.conflict, 'boolean');
});

test('an empty week renders as seven empty days rather than nothing', () => {
  const grid = weekGrid(normalizeData(emptyData()), WED);
  assert.equal(grid.days.length, 7);
  assert.equal(grid.total, 0);
  assert.equal(grid.conflicts, 0);
  assert.ok(grid.days.every((d) => d.entries.length === 0));
});

test('slot validation mirrors the database rules', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const good = { ...blankSlot('c1', 'd1'), interviewer: 'Priya', startsAt: future };
  assert.deepEqual(validateSlot(good, []), {});
  assert.match(validateSlot({ ...good, candidateId: null }, []).candidateId, /offered to/);
  assert.match(validateSlot({ ...good, interviewer: ' ' }, []).interviewer, /Who is interviewing/);
  assert.match(validateSlot({ ...good, startsAt: '' }, []).startsAt, /date and time/);
  assert.match(
    validateSlot({ ...good, startsAt: new Date(Date.now() - 3600000).toISOString() }, []).startsAt,
    /in the future/,
    'publishing a time that has already passed helps nobody',
  );
  assert.match(validateSlot({ ...good, durationMins: 2 }, []).durationMins, /between 5 and 480/);
  assert.match(validateSlot({ ...good, durationMins: 999 }, []).durationMins, /between 5 and 480/);
  assert.match(validateSlot({ ...good, mode: 'Telepathy' }, []).mode, /how the interview happens/);
  for (const mode of SLOT_MODES) assert.deepEqual(validateSlot({ ...good, mode }, []), {});
});

test('the same interviewer cannot be published as free twice at one moment', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const existing = [{ id: 's1', interviewer: 'Priya Raman', startsAt: future, status: 'Open' }];
  const clash = { ...blankSlot('c1'), interviewer: ' priya raman ', startsAt: future };
  assert.match(validateSlot(clash, existing).startsAt, /already published as free/);
  assert.deepEqual(validateSlot(clash, existing, 's1'), {}, 'editing that slot is fine');
  assert.deepEqual(
    validateSlot(clash, [{ ...existing[0], status: 'Cancelled' }]),
    {},
    'a withdrawn slot frees the time again',
  );
});

test('a run of slots can be generated in one go', () => {
  const start = new Date(2026, 8, 30, 10, 0).toISOString();
  const run = generateSlots({ ...blankSlot('c1'), startsAt: start }, { count: 3, everyMins: 60 });
  assert.equal(run.length, 3);
  assert.deepEqual(
    run.map((s) => new Date(s.startsAt).getHours()),
    [10, 11, 12],
  );
  assert.equal(run[0].candidateId, 'c1', 'the rest of the slot carries over');
  assert.deepEqual(generateSlots({ startsAt: '' }, { count: 3 }), []);
  assert.deepEqual(generateSlots({ startsAt: start }, { count: 0 }), []);
  assert.equal(generateSlots({ startsAt: start }).length, 1, 'one by default');
});

test('only open slots are offered to a candidate', () => {
  const data = world();
  assert.deepEqual(
    slotsForCandidate(data, 'c2').map((s) => s.id),
    ['s1'],
  );
  assert.deepEqual(slotsForCandidate(data, 'c1'), [], 'their slot is already booked');
  assert.deepEqual(slotsForCandidate(data, 'nobody'), []);
});

test('the totals describe the week honestly', () => {
  const totals = scheduleTotals(world(), WED);
  assert.equal(totals.thisWeek, 2, 'cancelled interviews are not commitments');
  assert.equal(totals.slotsOpen, 1);
  assert.equal(totals.awaitingChoice, 1, 'one candidate has a decision to make');
  assert.equal(totals.conflicts, 0);
  assert.equal(DEFAULT_DURATION, 45);
});
