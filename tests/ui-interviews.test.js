// Interviews and offers, driven as a recruiter would: schedule a panel, refuse a half-filled
// form, record an outcome with a recommendation, download the calendar file, then take an offer
// Draft → Sent → Accepted and generate its letter. These are the flows where a modal that
// renders fine can still write a broken record (a stringly timestamp, a lost panel, a CTC that
// arrives as text), so every assertion goes back to what landed in the workspace store.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadApp,
  mount,
  screen,
  cleanup,
  stopVite,
  settle,
  downloaded,
  resetDownloads,
  blobText,
} from './ui-harness.js';
import { navTo, press, pressIn, type, choose, rowOf, allText, submitVia } from './ui-drivers.js';
import { makeSeed } from '../src/seed.js';
import { DEFAULT_CRITERIA, DEFAULT_THRESHOLD, RECOMMENDATIONS } from '../src/feedback.js';

let M;
test.before(async () => {
  M = await loadApp();
});
test.after(async () => {
  cleanup();
  await stopVite();
});
afterEach(() => cleanup());

const KEY = 'ecod-demo-v1';
const store = () => JSON.parse(localStorage.getItem(KEY));
const putStore = (data) => localStorage.setItem(KEY, JSON.stringify(data));

const inDays = (n) => new Date(Date.now() + n * 86400000);
const seed = () => makeSeed();

/** A workspace holding exactly one interview, so "the first row" is never ambiguous. */
function withInterview(mutate) {
  const data = seed();
  const c = data.candidates[0];
  const d = data.demands.find((x) => x.status === 'Open');
  const at = inDays(3);
  at.setHours(14, 30, 0, 0);
  data.interviews = [
    {
      id: 'iv-test-1',
      candidateId: c.id,
      demandId: d.id,
      round: 'Round 1',
      mode: 'Video',
      scheduledAt: at.toISOString(),
      durationMins: 45,
      interviewers: ['Neha Kulkarni'],
      notes: 'System design focus',
      status: 'Scheduled',
      recommendation: null,
      feedback: {},
      created: new Date().toISOString(),
    },
  ];
  data.offers = [];
  if (mutate) mutate(data, c, d);
  putStore(data);
  return { data, c, d };
}

/** Open the workspace on the Interviews page. Pass a workspace to install it first; omit the
 * argument to keep whatever `withInterview` already put in the store. */
/** The single offer row on screen — each of these tests seeds exactly one offer. */
function offerRow() {
  const rows = [...document.querySelectorAll('.offer-row')];
  assert.equal(rows.length, 1, `exactly one offer row is on screen (found ${rows.length})`);
  return rows[0];
}

async function boot(data) {
  if (data) putStore(data);
  await mount(M.App, {});
  await settle(6);
  await navTo('Interviews');
}

test('scheduling refuses a half-filled form before it writes anything', async () => {
  await boot(seed());
  await press('Schedule interview');
  await submitVia('Schedule interview');
  assert.ok(
    screen.getByText('Select the candidate being interviewed.'),
    'a panel without a candidate is refused',
  );

  const { candidates } = seed();
  await choose('Candidate', candidates[0].id);
  await type('Date', '');
  const before = store().interviews.length;
  await submitVia('Schedule interview');
  assert.ok(
    screen.getByText('Pick a date and time for the interview.'),
    'and so is one without a date',
  );
  assert.equal(
    store().interviews.length,
    before,
    'no interview was written while the form was invalid',
  );
});

test('a scheduled interview lands as a real timestamp with its panel intact', async () => {
  await boot(seed());
  const data = seed();
  const person = data.candidates[0];
  const role = data.demands.find((x) => x.status === 'Open');

  await press('Schedule interview');
  await choose('Candidate', person.id);
  await choose('Demand', role.id);
  await choose('Round', 'Round 2');
  await choose('Mode', 'Onsite');
  await type('Date', '2027-02-08');
  await type('Time', '16:45');
  await type('Duration (minutes)', '90');
  await type('Interviewers', 'Neha Kulkarni, Rohit Verma , Amit Singh');
  await type('Notes', 'Bring the lakehouse cost model.');
  await submitVia('Schedule interview');
  await settle(3);

  const rows = store().interviews;
  assert.equal(rows.length, data.interviews.length + 1, 'one interview was added');
  const iv = rows.find((r) => r.notes === 'Bring the lakehouse cost model.');
  assert.ok(iv, 'the new interview is in the workspace');
  assert.equal(iv.candidateId, person.id);
  assert.equal(iv.demandId, role.id);
  assert.equal(iv.round, 'Round 2');
  assert.equal(iv.mode, 'Onsite');
  assert.equal(iv.durationMins, 90);
  assert.equal(iv.status, 'Scheduled');
  // Stored as one instant, not as separate date and time strings the matcher has to rejoin.
  assert.equal(iv.scheduledAt, new Date('2027-02-08T16:45:00').toISOString());
  assert.ok(!Number.isNaN(new Date(iv.scheduledAt).getTime()), 'and it parses back');
  assert.deepEqual(
    iv.interviewers,
    ['Neha Kulkarni', 'Rohit Verma', 'Amit Singh'],
    'the panel is split on commas and trimmed',
  );
  assert.equal(
    iv.feedback && Object.keys(iv.feedback).length,
    0,
    'an outcome is not invented at scheduling time',
  );
});

test('optional interview and offer links become database nulls, not empty UUID or date strings', async () => {
  const { c } = withInterview();
  await boot();

  await press('Schedule interview');
  await choose('Candidate', c.id);
  await type('Date', '2027-02-08');
  await type('Time', '16:45');
  await submitVia('Schedule interview');
  await settle(3);
  const interview = store().interviews.find(
    (iv) => iv.scheduledAt === new Date('2027-02-08T16:45:00').toISOString(),
  );
  assert.ok(interview, 'the interview was saved');
  assert.equal(
    interview.demandId,
    null,
    'an unlinked interview sends SQL NULL for its optional demand',
  );

  await press('New offer');
  await choose('Candidate', c.id);
  await type('Annual package', '29.5');
  // Leave both optional values empty: Postgres date/UUID columns accept null, not "".
  await submitVia('Draft offer');
  await settle(3);
  const offer = store().offers.find((o) => o.ctc === 29.5);
  assert.ok(offer, 'the offer was drafted');
  assert.equal(offer.demandId, null, 'an unlinked offer sends SQL NULL for its optional demand');
  assert.equal(offer.joining, null, 'an unknown joining date is a date NULL, not an empty string');
});

test('recording an outcome needs a recommendation, and keeps the ratings it was given', async () => {
  const { c } = withInterview();
  await boot();
  await press('Record outcome');
  assert.ok(
    screen.getByText(`Feedback — ${c.name}`),
    'the outcome form knows whose interview it is',
  );
  assert.ok(
    screen.getByText(new RegExp(`bar for this workspace is ${DEFAULT_THRESHOLD}`)),
    'and shows the workspace hiring bar',
  );

  await submitVia('Submit feedback');
  assert.ok(
    screen.getByText('Pick a recommendation before submitting feedback.'),
    'ratings alone are not a decision',
  );

  for (const criterion of DEFAULT_CRITERIA)
    assert.ok(
      screen.getByLabelText(new RegExp(`^${criterion}`)),
      `every default criterion "${criterion}" is rated`,
    );
  const ratings = ['5', '4', '5', '4'];
  for (const [i, criterion] of DEFAULT_CRITERIA.entries()) await choose(criterion, ratings[i]);
  const overall = ratings.reduce((a, b) => a + Number(b), 0) / ratings.length;
  assert.ok(overall >= DEFAULT_THRESHOLD, 'these ratings clear the workspace bar');
  assert.ok(
    screen.getByText(new RegExp(`Overall ${overall} of 5 · meets the bar`)),
    'the overall is shown live against the bar',
  );

  await choose('Recommendation', 'Strong hire');
  await type('Evidence and notes', 'Designed the bronze-to-gold layer unaided.');
  await submitVia('Submit feedback');
  await settle(3);

  const iv = store().interviews.find((r) => r.id === 'iv-test-1');
  assert.equal(iv.status, 'Completed', 'recording an outcome completes the interview');
  assert.equal(iv.recommendation, 'Strong hire');
  assert.ok(RECOMMENDATIONS.includes(iv.recommendation));
  for (const [i, criterion] of DEFAULT_CRITERIA.entries()) {
    assert.equal(iv.feedback[criterion], Number(ratings[i]), 'ratings are stored as numbers');
    assert.equal(typeof iv.feedback[criterion], 'number');
  }
  assert.equal(iv.notes, 'Designed the bronze-to-gold layer unaided.');
  assert.ok(iv.completed, 'and the completion time is stamped');
  assert.ok(
    store().auditEvents.some((a) => a.detail === `Feedback recorded: Strong hire (${overall})`),
    'the decision is auditable',
  );
});

test('the calendar export produces an .ics for one interview and for the whole schedule', async () => {
  const { c } = withInterview();
  await boot();
  resetDownloads();
  await press('Calendar');
  await settle(3);
  assert.equal(downloaded.length, 1, 'one file was downloaded');
  assert.equal(downloaded[0].name, `interview-${c.name.toLowerCase().replace(/\s+/g, '-')}.ics`);
  const ics = await blobText(downloaded[0].blob);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'), 'it is a calendar file');
  assert.ok(ics.includes('BEGIN:VEVENT') && ics.includes('END:VEVENT'), 'with an event in it');
  assert.ok(ics.includes('DTSTART:'), 'that starts at a real time');
  assert.ok(ics.includes(c.name), 'and names the candidate');
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'), 'and is terminated properly');

  resetDownloads();
  await press('Export calendar (.ics)');
  await settle(3);
  assert.equal(downloaded.length, 1);
  assert.equal(downloaded[0].name, 'ecod-interviews.ics');
  assert.ok((await blobText(downloaded[0].blob)).includes('BEGIN:VCALENDAR'));
});

test('marking an interview a no-show keeps it on the record instead of deleting it', async () => {
  const { c } = withInterview();
  await boot();
  await pressIn(rowOf(c.name), 'No-show');
  await settle(3);
  const iv = store().interviews.find((r) => r.id === 'iv-test-1');
  assert.equal(iv.status, 'No-show', 'the outcome is recorded');
  assert.ok(
    iv.scheduledAt,
    'and the scheduled time survives, so the panel’s time is still accounted for',
  );
});

test('an offer goes Draft → Sent → Accepted with each date stamped', async () => {
  const { data, c, d } = withInterview();
  await boot();

  await press('New offer');
  await submitVia('Draft offer');
  assert.ok(
    screen.getByText('Select the candidate receiving the offer.'),
    'an offer needs a person',
  );
  await choose('Candidate', c.id);
  await submitVia('Draft offer');
  assert.ok(screen.getByText('Enter the annual package in rupee lakh per annum.'), 'and a package');

  await choose('Demand', d.id);
  assert.equal(
    screen.getByLabelText(/^Role on offer/).value,
    d.title,
    'linking a demand fills the role in',
  );
  await type('Annual package', '32.5');
  await type('Joining date', '2027-03-01');
  await type('Notes', 'Two days in office, agreed on the panel call.');
  await submitVia('Draft offer');
  await settle(3);

  let offers = store().offers;
  assert.equal(offers.length, data.offers.length + 1);
  let o = offers.find((x) => x.ctc === 32.5);
  assert.ok(o, 'the offer was drafted');
  assert.equal(typeof o.ctc, 'number', 'the package is a number, not the text that was typed');
  assert.equal(o.status, 'Draft');
  assert.equal(o.sentDate, null);
  assert.equal(o.decidedDate, null);

  await pressIn(offerRow(), 'Mark sent');
  await settle(3);
  o = store().offers.find((x) => x.id === o.id);
  assert.equal(o.status, 'Sent');
  assert.ok(o.sentDate, 'sending stamps the date');
  const sentDate = o.sentDate;

  await pressIn(offerRow(), 'Accepted');
  await settle(3);
  o = store().offers.find((x) => x.id === o.id);
  assert.equal(o.status, 'Accepted');
  assert.ok(o.decidedDate, 'acceptance stamps the decision date');
  assert.equal(o.sentDate, sentDate, 'and does not overwrite when it was sent');
});

test('the offer letter is generated from the record and priced in rupees', async () => {
  const { c } = withInterview((data) => {
    data.offers = [
      {
        id: 'offer-test-1',
        candidateId: data.candidates[0].id,
        demandId: data.demands.find((x) => x.status === 'Open').id,
        role: data.demands.find((x) => x.status === 'Open').title,
        location: 'Bengaluru',
        ctc: 34,
        joining: '2027-04-05',
        status: 'Sent',
        sentDate: new Date().toISOString(),
        decidedDate: null,
        notes: '',
        created: new Date().toISOString(),
      },
    ];
  });
  await boot();
  resetDownloads();
  await pressIn(offerRow(), 'Letter');
  assert.ok(screen.getByText(`Offer letter — ${c.name}`), 'the letter previews in the workspace');
  const preview = document.querySelector('.submission-preview pre').textContent;
  assert.ok(preview.includes(c.name), 'addressed to the candidate');
  assert.ok(preview.includes('₹'), 'priced in rupees, not dollars');
  assert.ok(preview.includes('34'), 'for the package on the record');
  assert.ok(!preview.includes('{{'), 'with no unfilled template tokens left behind');

  await press('Download letter');
  await settle(2);
  assert.equal(downloaded.length, 1, 'the letter downloads');
  assert.equal(downloaded[0].name, `offer-letter-${c.name.toLowerCase().replace(/\s+/g, '-')}.txt`);
  const letter = await blobText(downloaded[0].blob);
  assert.equal(letter, preview, 'what downloads is exactly what was previewed');
});

test('with offer approvals on, a draft cannot be sent until it is approved', async () => {
  withInterview((data) => {
    data.settings = data.settings.map((r) =>
      r.id === 'workspace' ? { ...r, custom: { ...(r.custom || {}), offerApprovals: true } } : r,
    );
    data.offers = [
      {
        id: 'offer-approval-1',
        candidateId: data.candidates[0].id,
        demandId: data.demands[0].id,
        role: data.demands[0].title,
        location: 'Bengaluru',
        ctc: 28,
        joining: '',
        status: 'Draft',
        sentDate: null,
        decidedDate: null,
        notes: '',
        created: new Date().toISOString(),
      },
    ];
  });
  await boot();

  const row = offerRow();
  assert.ok(
    [...row.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Submit for approval'),
    'the workspace policy surfaces on the offer row',
  );
  assert.ok(!allText('Mark sent').length, 'and the draft cannot be sent straight to the candidate');
  assert.ok(
    screen.getByText(/Approval required before this offer can be sent/),
    'the row says why',
  );

  await pressIn(row, 'Submit for approval');
  await settle(3);
  assert.equal(store().offers.find((o) => o.id === 'offer-approval-1').status, 'Pending approval');
  assert.ok(!allText('Mark sent').length, 'a pending offer still cannot be sent');

  await pressIn(offerRow(), 'Approve');
  await settle(3);
  const approved = store().offers.find((o) => o.id === 'offer-approval-1');
  assert.equal(approved.status, 'Draft', 'approval returns it to a sendable draft');
  assert.ok(approved.approvedAt, 'and records when it was approved');
  assert.equal(approved.approvedBy, 'Admin', 'and by whom in demo mode');
  assert.ok(
    screen.getByText(/Approved .*Admin/),
    'the approval stamp is visible to the recruiting team',
  );
  assert.deepEqual(
    approved.approvedTerms,
    {
      candidateId: approved.candidateId,
      demandId: approved.demandId,
      role: approved.role,
      location: approved.location,
      ctc: approved.ctc,
      joining: approved.joining,
    },
    'the approval is pinned to the exact draft terms',
  );
  assert.equal(allText('Mark sent').length, 1, 'only now can the offer be sent');
  assert.ok(
    store().auditEvents.some((a) => a.detail.includes('Offer approved')),
    'the approval is audited',
  );

  // An approval covers the package it was granted for — not whatever the terms become later.
  await pressIn(offerRow(), 'Edit');
  await type('Annual package', '45');
  await submitVia('Save offer');
  await settle(3);
  const edited = store().offers.find((o) => o.id === 'offer-approval-1');
  assert.equal(edited.ctc, 45, 'the new package is saved');
  assert.equal(edited.approvedAt, null, 'and it voids the approval that covered ₹28 LPA');
  assert.equal(edited.approvedTerms, null, 'the old approved-terms snapshot is removed too');
  assert.ok(!allText('Mark sent').length, 'so it has to be approved again before it can be sent');

  await pressIn(offerRow(), 'Submit for approval');
  await settle(3);
  await pressIn(offerRow(), 'Approve');
  await settle(3);
  await pressIn(offerRow(), 'Mark sent');
  await settle(3);
  assert.equal(store().offers.find((o) => o.id === 'offer-approval-1').status, 'Sent');

  // Changing terms after an offer has already been sent reopens it as a fresh draft, rather
  // than silently rewriting the package the candidate received.
  await pressIn(offerRow(), 'Edit');
  await type('Annual package', '48');
  await submitVia('Save offer');
  await settle(3);
  const reopened = store().offers.find((o) => o.id === 'offer-approval-1');
  assert.equal(reopened.status, 'Draft');
  assert.equal(reopened.sentDate, null, 'the old send date no longer describes the new draft');
  assert.equal(reopened.decidedDate, null);
  assert.equal(reopened.approvedAt, null, 'the new terms require a fresh approval');
  assert.ok(!allText('Mark sent').length, 'the reissued package cannot bypass approval');
});

test('rescheduling keeps the interview’s identity and outcome history', async () => {
  const { c } = withInterview();
  await boot();
  await pressIn(rowOf(c.name), 'Reschedule');
  assert.ok(screen.getByText('Reschedule interview'), 'the same record is being edited');
  await type('Date', '2027-06-11');
  await type('Time', '10:00');
  await submitVia('Update interview');
  await settle(3);

  const rows = store().interviews;
  assert.equal(
    rows.filter((r) => r.id === 'iv-test-1').length,
    1,
    'it updated the row rather than cloning it',
  );
  const iv = rows.find((r) => r.id === 'iv-test-1');
  assert.equal(iv.scheduledAt, new Date('2027-06-11T10:00:00').toISOString());
  assert.equal(iv.candidateId, c.id, 'and kept its candidate');
  assert.deepEqual(iv.interviewers, ['Neha Kulkarni'], 'and its panel');
});

test('the interviews page counts its own pipeline honestly', async () => {
  withInterview();
  await boot();
  const stat = (label) => {
    const card = [...document.querySelectorAll('.stat')].find(
      (s) => s.querySelector('.stat-top span')?.textContent === label,
    );
    assert.ok(card, `the "${label}" counter is on the page`);
    return card.querySelector('strong').textContent;
  };
  // Exactly one scheduled interview, nothing completed, nothing cancelled.
  assert.equal(stat('Upcoming'), '1');
  assert.equal(stat('Completed'), '0');
  assert.equal(stat('Cancelled / no-show'), '0');
  assert.equal(stat('Average rating'), '—', 'no ratings exist yet, so none are implied');
  assert.equal(
    allText('Record outcome').length,
    1,
    'and exactly one interview is awaiting an outcome',
  );
});
