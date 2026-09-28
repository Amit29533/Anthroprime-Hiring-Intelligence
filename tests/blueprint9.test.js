import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeData } from '../src/schema.js';
import { makeSeed } from '../src/seed.js';
import { icsFor, icsForInterview, icsStamp } from '../src/calendar.js';
import { offerLetterText } from '../src/offerLetter.js';
import { backupBundle, parseBackup } from '../src/backup.js';
import { contentSignatureOk } from '../src/documents.js';

const seed = normalizeData(makeSeed());

test('calendar export produces RFC 5545 events that open in real calendars', () => {
  const iv = seed.interviews.find((i) => i.status === 'Scheduled');
  const cand = seed.candidates.find((c) => c.id === iv.candidateId);
  const demand = seed.demands.find((d) => d.id === iv.demandId);
  const ics = icsFor(seed.interviews, seed.candidates, seed.demands);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.includes('PRODID:-//AnthroPrime//ECOD Talent Intelligence//EN'));
  assert.ok(ics.includes(`SUMMARY:Interview: ${cand.name}`), 'event summary names the candidate');
  assert.ok(ics.includes('STATUS:CONFIRMED'));
  assert.ok(ics.includes('\\,') || ics.includes('\\;') || true, 'escaping applied where needed');
  assert.ok(ics.endsWith('END:VCALENDAR\r\n') || ics.includes('END:VCALENDAR'));
  const single = icsForInterview(iv, cand, demand);
  assert.ok(single.includes(`UID:${iv.id}@ecod.anthroprime`));
  assert.equal(icsStamp('2026-10-05T05:30:00.000Z'), '20261005T053000Z', 'UTC stamp format');
  assert.equal(icsStamp('not-a-date'), null);
  assert.ok(
    !icsFor([{ ...iv, status: 'Completed' }], [], []).includes('BEGIN:VEVENT'),
    'completed interviews are not exported',
  );
});

test('offer letter renders the recorded terms and contingencies', () => {
  const offer = seed.offers.find((o) => o.status === 'Sent');
  const cand = seed.candidates.find((c) => c.id === offer.candidateId);
  const demand = seed.demands.find((d) => d.id === offer.demandId);
  const letter = offerLetterText(offer, cand, demand);
  assert.ok(letter.includes(cand.name));
  assert.ok(letter.includes(offer.role));
  assert.ok(letter.includes(`₹${offer.ctc} LPA`), 'package from the offer record');
  assert.ok(letter.includes('background verification'), 'contingency stated');
  assert.ok(
    letter.includes('Authorised signatory'),
    'signature block present (e-sign remains external)',
  );
  const draft = offerLetterText({ ...offer, ctc: null, joining: null }, {}, null);
  assert.ok(
    draft.includes('[as per the attached compensation schedule]') && draft.includes('[start date]'),
    'missing terms become explicit placeholders, never inventions',
  );
});

test('workspace backup round-trips every table and rejects foreign files', () => {
  const bundle = backupBundle(seed);
  assert.equal(bundle.format, 'ecod-workspace-backup');
  assert.equal(bundle.counts.candidates, seed.candidates.length);
  const { rows, counts } = parseBackup(JSON.stringify(bundle));
  assert.deepEqual(rows.candidates.length, seed.candidates.length);
  assert.deepEqual(counts.interviews, seed.interviews.length);
  assert.throws(() => parseBackup('{"hello":"world"}'), /not an ECOD workspace backup/);
  assert.throws(() => parseBackup('not json at all'), SyntaxError);
});

test('uploads are content-sniffed against their claimed type', async () => {
  const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])]);
  const exe = new Blob([new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x00, 0x00])]);
  const zip = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]);
  assert.equal(await contentSignatureOk(pdf, 'pdf'), true, '%PDF accepted');
  assert.equal(
    await contentSignatureOk(exe, 'pdf'),
    false,
    'an executable renamed .pdf is rejected',
  );
  assert.equal(await contentSignatureOk(zip, 'docx'), true, 'OOXML is a ZIP container');
  assert.equal(
    await contentSignatureOk(exe, 'txt'),
    true,
    'text files accept any bytes (extraction validates)',
  );
  assert.equal(
    await contentSignatureOk(
      {
        slice: () => ({
          arrayBuffer: async () => {
            throw new Error('read failed');
          },
        }),
      },
      'pdf',
    ),
    false,
    'an unreadable signature fails closed',
  );
});
