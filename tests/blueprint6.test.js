import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeData, TABLES } from '../src/schema.js';
import { makeSeed } from '../src/seed.js';
import { OFFER_STATUSES, OFFER_TONES, offersSummary, offerIsOpen } from '../src/offers.js';
import { templatesFor, fillTemplate } from '../src/feedback.js';

const seed = normalizeData(makeSeed());

test('offers and tasks are first-class tables with normalize defaults', () => {
  for (const t of ['offers', 'tasks']) assert.ok(TABLES.includes(t), `TABLES includes ${t}`);
  const out = normalizeData({
    candidates: [],
    demands: [],
    offers: [
      { id: 'o1', candidateId: 'c1' },
      { id: 'o2', candidateId: 'c1', status: 'Sent', ctc: '31.5', role: 'Architect' },
    ],
    tasks: [
      { id: 't1', title: 'X' },
      { id: 't2', title: 'Y', done: true },
    ],
  });
  const [o1, o2] = out.offers,
    [t1, t2] = out.tasks;
  assert.equal(o1.status, 'Draft');
  assert.equal(o2.ctc, 31.5, 'ctc is stored as a number');
  assert.equal(o2.role, 'Architect');
  assert.equal(t1.done, false);
  assert.equal(t2.done, true);
  assert.equal(t1.due, '');
});

test('offer lifecycle helpers compute the summary honestly', () => {
  assert.deepEqual(OFFER_STATUSES, [
    'Draft',
    'Pending approval',
    'Sent',
    'Accepted',
    'Rejected',
    'Withdrawn',
  ]);
  assert.equal(OFFER_TONES.Accepted, 'green');
  assert.equal(offerIsOpen({ status: 'Sent' }), true);
  assert.equal(offerIsOpen({ status: 'Rejected' }), false);
  const s = offersSummary([
    { status: 'Draft' },
    { status: 'Sent' },
    { status: 'Sent' },
    { status: 'Accepted' },
    { status: 'Rejected' },
  ]);
  assert.equal(s.open, 3);
  assert.equal(s.sent, 2);
  assert.equal(s.accepted, 1);
  assert.equal(s.acceptRate, 50, 'acceptance rate over decided offers only');
  assert.equal(offersSummary([]).acceptRate, null);
});

test('seed carries offers, tasks, custom fields and per-record custom values', () => {
  assert.equal(seed.offers.length, 2);
  assert.equal(seed.tasks.length, 3);
  const sent = seed.offers.find((o) => o.status === 'Sent');
  assert.ok(sent.ctc > 0 && sent.demandId, 'the sent offer has terms and a demand link');
  const fields = seed.settings[0].custom.customFields;
  assert.equal(fields.candidates.length, 2);
  assert.equal(fields.demands.length, 1);
  assert.deepEqual(fields.candidates[0].options, ['Pending', 'Clear', 'Flagged']);
  assert.equal(seed.candidates[0].custom['Background check'], 'Clear');
  assert.equal(seed.candidates[5].custom['Background check'], 'Pending');
  assert.equal(seed.demands[0].custom['Billing rate'], 95);
  assert.deepEqual(seed.candidates[1].custom, {}, 'untouched candidates get an empty object');
});

test('offer email template exists with term placeholders', () => {
  const tpls = templatesFor([]);
  assert.equal(tpls.length, 4, 'invite, follow-up, rejection, offer');
  const offer = tpls.find((t) => t.name === 'Offer');
  assert.ok(offer, 'offer template present by default');
  const out = fillTemplate(offer.body, {
    name: 'Aarav',
    demand: 'Cloud Platform Engineer (Meridian)',
    mode: 'Hybrid',
    location: 'Bengaluru',
    ctc: '₹35 LPA',
    date: '12 November 2026',
  });
  assert.ok(out.includes('₹35 LPA') && out.includes('12 November 2026') && out.includes('Aarav'));
});
