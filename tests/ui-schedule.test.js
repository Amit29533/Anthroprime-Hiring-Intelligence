// Phase C: the week calendar and interviewer availability, driven through the real screens.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadApp,
  mount,
  screen,
  cleanup,
  stopVite,
  settle,
  act,
  fireEvent,
  createHarness,
} from './ui-harness.js';
import { navTo, press, type, choose, pressPrefixed, allText } from './ui-drivers.js';
import { makeSeed } from '../src/seed.js';
import { normalizeData } from '../src/schema.js';

let M, CAL;
test.before(async () => {
  M = await loadApp();
  CAL = { InterviewCalendar: M.InterviewCalendar, SlotPublisher: M.SlotPublisher };
});
test.after(async () => {
  cleanup();
  await stopVite();
});
afterEach(() => cleanup());

const soon = (hoursFromNow) => new Date(Date.now() + hoursFromNow * 3600000).toISOString();

function world(over = {}) {
  const seed = makeSeed();
  return normalizeData({
    ...seed,
    interviews: [
      {
        id: 'iv1',
        candidateId: seed.candidates[0].id,
        demandId: seed.demands[0].id,
        round: 'Round 1',
        mode: 'Video',
        scheduledAt: soon(24),
        durationMins: 45,
        interviewers: ['Priya Raman'],
        status: 'Scheduled',
      },
    ],
    interviewSlots: [],
    ...over,
  });
}

test('the interviews page offers a week view alongside the list', async () => {
  localStorage.setItem('ecod-demo-v1', JSON.stringify(world()));
  await mount(M.App, {});
  await settle(6);
  await navTo('Interviews');
  assert.ok(screen.getByText('List'));
  await press('Week');
  assert.ok(document.querySelector('.cal-week'), 'the calendar grid rendered');
  assert.equal(document.querySelectorAll('.cal-day').length, 7, 'a full week of columns');
  assert.ok(allText(/Interviews this week/).length);
  cleanup();
});

test('a scheduled interview appears on its day', async () => {
  const data = world();
  await mount(CAL.InterviewCalendar, { data, onOpenCandidate: () => {} });
  await settle(3);
  const entries = [...document.querySelectorAll('.cal-entry')];
  assert.equal(entries.length, 1, 'the one interview is placed');
  assert.ok(entries[0].textContent.includes(data.candidates[0].name), 'labelled by candidate');
  cleanup();
});

test('a clash is called out rather than hidden between two rows', async () => {
  const seed = makeSeed();
  const when = soon(24);
  const data = world({
    interviews: [
      {
        id: 'a',
        candidateId: seed.candidates[0].id,
        round: 'R1',
        mode: 'Video',
        scheduledAt: when,
        durationMins: 60,
        interviewers: ['Priya Raman'],
        status: 'Scheduled',
      },
      {
        id: 'b',
        candidateId: seed.candidates[1].id,
        round: 'R1',
        mode: 'Video',
        scheduledAt: when,
        durationMins: 60,
        interviewers: ['Priya Raman'],
        status: 'Scheduled',
      },
    ],
  });
  await mount(CAL.InterviewCalendar, { data, onOpenCandidate: () => {} });
  await settle(3);
  assert.equal(document.querySelectorAll('.cal-entry.clash').length, 2, 'both sides are marked');
  assert.ok(allText(/Same person, same time/).length, 'and the count explains what a clash is');
  cleanup();
});

test('clicking an entry opens that candidate', async () => {
  const data = world();
  const opened = [];
  await mount(CAL.InterviewCalendar, { data, onOpenCandidate: (id) => opened.push(id) });
  await settle(3);
  await act(async () => {
    fireEvent.click(document.querySelector('.cal-entry'));
  });
  assert.deepEqual(opened, [data.candidates[0].id]);
  cleanup();
});

test('the week can be paged and reset', async () => {
  const data = world();
  await mount(CAL.InterviewCalendar, { data, onOpenCandidate: () => {} });
  await settle(3);
  const heading = () => document.querySelector('.panel-heading h2').textContent;
  const first = heading();
  const next = [...document.querySelectorAll('.cal-nav button')].at(-2 - 0);
  await act(async () => {
    fireEvent.click([...document.querySelectorAll('.cal-nav button')][2]);
  });
  await settle(2);
  assert.notEqual(heading(), first, 'paging forward changes the week');
  await press('This week');
  assert.equal(heading(), first, 'and "This week" comes back');
  assert.ok(next);
  cleanup();
});

test('publishing offers several times at once', async () => {
  const data = world();
  const harness = createHarness(data);
  await mount(CAL.SlotPublisher, {
    data,
    onClose: () => {},
    onSave: harness.save,
    notify: (m) => harness.state.toasts.push(m),
    busy: false,
  });
  await settle(2);
  await choose('Candidate', data.candidates[0].id);
  await type('Interviewer', 'Priya Raman');
  const when = new Date(Date.now() + 48 * 3600000);
  when.setSeconds(0, 0);
  const localValue = new Date(when.getTime() - when.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  await type('First time', localValue);
  await type('How many times to offer', '3');
  await pressPrefixed('Offer');
  await settle(3);

  const write = harness.state.writes.find((w) => w.table === 'interviewSlots');
  assert.ok(write, 'slots were published');
  assert.equal(write.rows.length, 3, 'a run of three, not one at a time');
  assert.equal(write.rows[0].candidateId, data.candidates[0].id);
  assert.equal(write.rows[0].status, 'Open');
  const times = write.rows.map((r) => new Date(r.startsAt).getTime());
  assert.equal(times[1] - times[0], 3600000, 'spaced an hour apart by default');
  assert.ok(harness.state.toasts.some((t) => /3 times offered/.test(t)));
  cleanup();
});

test('a time in the past is refused before anything is written', async () => {
  const data = world();
  const harness = createHarness(data);
  await mount(CAL.SlotPublisher, {
    data,
    onClose: () => {},
    onSave: harness.save,
    notify: () => {},
    busy: false,
  });
  await settle(2);
  await choose('Candidate', data.candidates[0].id);
  await type('Interviewer', 'Priya Raman');
  await type('First time', '2020-01-01T10:00');
  await pressPrefixed('Offer');
  await settle(2);
  assert.ok(allText(/in the future/).length);
  assert.equal(harness.state.writes.length, 0);
  cleanup();
});

test('publishing requires someone to offer the time to', async () => {
  const data = world();
  const harness = createHarness(data);
  await mount(CAL.SlotPublisher, {
    data,
    onClose: () => {},
    onSave: harness.save,
    notify: () => {},
    busy: false,
  });
  await settle(2);
  await type('Interviewer', 'Priya Raman');
  await type('First time', new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await pressPrefixed('Offer');
  await settle(2);
  assert.ok(allText(/offered to/).length, 'a slot with no candidate is not an offer');
  assert.equal(harness.state.writes.length, 0);
  cleanup();
});

test('an open slot shows on the calendar as an offer, and a booked one does not', async () => {
  const seed = makeSeed();
  const data = world({
    interviews: [],
    interviewSlots: [
      {
        id: 's1',
        candidateId: seed.candidates[0].id,
        interviewer: 'Priya',
        round: 'Round 2',
        mode: 'Video',
        startsAt: soon(24),
        durationMins: 45,
        status: 'Open',
      },
      {
        id: 's2',
        candidateId: seed.candidates[1].id,
        interviewer: 'Vikram',
        round: 'Round 2',
        mode: 'Video',
        startsAt: soon(26),
        durationMins: 45,
        status: 'Booked',
      },
    ],
  });
  await mount(CAL.InterviewCalendar, { data, onOpenCandidate: () => {} });
  await settle(3);
  const entries = [...document.querySelectorAll('.cal-entry')];
  assert.equal(entries.length, 1, 'only the open offer is shown');
  assert.ok(entries[0].classList.contains('slot'), 'styled as an offer, not a commitment');
  assert.ok(entries[0].textContent.includes('Offered to'));
  cleanup();
});

test('a viewer sees the calendar but cannot offer times', async () => {
  const data = world();
  await mount(CAL.InterviewCalendar, {
    data,
    onOpenCandidate: () => {},
    onPublish: () => {},
    role: 'viewer',
  });
  await settle(2);
  assert.ok(document.querySelector('.cal-week'), 'the calendar is readable');
  assert.equal(screen.queryByText('Offer times'), null, 'but publishing is not offered');
  cleanup();
});
