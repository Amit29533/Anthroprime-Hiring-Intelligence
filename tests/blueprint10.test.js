import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeData, TABLES } from '../src/schema.js';
import { makeSeed } from '../src/seed.js';
import { ruleMatches, actionsFor, buildActions, AUTOMATION_TABLES } from '../src/automation.js';
import { parseICS, interviewDraftFromEvent } from '../src/calendar.js';
import { emailBodyText } from '../src/documents.js';
import { backupBundle, parseBackup } from '../src/backup.js';

const seed = normalizeData(makeSeed());

test('automation rules fire on trigger transitions and compile concrete actions', () => {
  assert.ok(AUTOMATION_TABLES.includes('offers'));
  const rule = seed.workflowRules.find((r) => r.name.startsWith('Offer accepted'));
  assert.ok(rule, 'seed contains an offer-acceptance rule');
  assert.equal(
    ruleMatches(rule, 'offers', { status: 'Sent' }, { status: 'Accepted' }),
    true,
    'fires when the offer enters Accepted',
  );
  assert.equal(
    ruleMatches(rule, 'offers', { status: 'Accepted' }, { status: 'Accepted' }),
    false,
    'does not refire on an unchanged value',
  );
  assert.equal(
    ruleMatches(rule, 'offers', { status: 'Accepted' }, { status: 'Rejected' }),
    false,
    'ignores other transitions',
  );
  assert.equal(
    ruleMatches({ ...rule, enabled: false }, 'offers', { status: 'Sent' }, { status: 'Accepted' }),
    false,
    'paused rules never fire',
  );
  const strong = seed.workflowRules.find((r) => r.triggerTable === 'interviews');
  assert.equal(
    ruleMatches(strong, 'interviews', { recommendation: null }, { recommendation: 'Strong hire' }),
    true,
  );
  const matched = actionsFor(
    seed.workflowRules,
    'offers',
    { status: 'Sent' },
    { status: 'Accepted' },
  );
  const built = buildActions(matched, {
    candidate: { id: 'c-1' },
    demand: { id: 'd-1' },
    base: '2026-09-28',
  });
  const strongBuilt = buildActions(
    actionsFor(
      seed.workflowRules,
      'interviews',
      { recommendation: null },
      { recommendation: 'Strong hire' },
    ),
    { candidate: { id: 'c-1' }, base: '2026-09-28' },
  );
  assert.equal(
    strongBuilt.nextActions[0].text,
    'Prepare offer package',
    'interview rule sets the candidate next action',
  );
  assert.ok(built.tasks.length >= 1, 'task action produced');
  const task = built.tasks[0];
  assert.equal(task.candidateId, 'c-1');
  assert.equal(task.done, false);
  assert.equal(task.due, '2026-09-30', 'due date honours dueDays');
  assert.ok(
    built.tagUpdates.some((t) => t.tag === 'Onboarding'),
    'tag action produced',
  );
  assert.ok(
    built.notes.every((n) => n.author === 'Automation' && n.candidateId === 'c-1'),
    'notes attributed to Automation',
  );
  assert.ok(
    built.notes.every((n) => n.followUp === null),
    'notes without follow-up dates use a database NULL',
  );
  const demandNote = buildActions(
    [{ name: 'Demand rule', actions: [{ type: 'note', text: 'Cannot be candidate note' }] }],
    { demand: { id: 'd-1' }, base: '2026-09-28' },
  );
  assert.equal(
    demandNote.notes.length,
    0,
    'a demand-only event never creates an invalid note without a candidate',
  );
});

test('calendar import parses folded, escaped VEVENTS into importable drafts', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:ext-1@client.example',
    'SUMMARY:Interview: Priya Sharma\\, Round 2',
    'DESCRIPTION:Panel with the platform team\\nSecond line',
    'DTSTART;TZID=Asia/Kolkata:20261102T143000',
    'DTEND;TZID=Asia/Kolkata:20261102T153000',
    'LOCATION:Client office\\, Pune',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:ext-2@client.example',
    'SUMMARY:Candidate no-show follow-up',
    'DTSTART:20261103',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const events = parseICS(ics);
  assert.equal(events.length, 2);
  const [a, b] = events;
  assert.equal(a.summary, 'Interview: Priya Sharma, Round 2', 'escaped comma unescaped');
  assert.ok(a.description.includes('Second line'), 'folded/escaped newline preserved');
  assert.equal(
    a.start,
    '2026-11-02T09:00:00.000Z',
    'TZID wall time is normalized to the correct UTC instant',
  );
  assert.equal(
    parseICS(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART:20261102T143000+0530',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    )[0].start,
    '2026-11-02T09:00:00.000Z',
    'explicit +0530 offset normalised to UTC',
  );
  assert.equal(b.start, '2026-11-03T09:00:00.000Z', 'all-day dates get a default time');
  const priya = seed.candidates.find((c) => c.name === 'Priya Sharma') || seed.candidates[0];
  const draft = interviewDraftFromEvent(a, seed.candidates);
  if (seed.candidates.some((c) => c.name === 'Priya Sharma'))
    assert.equal(draft.candidateId, priya.id, 'candidate matched by name');
  else assert.ok(draft, 'draft returned even without a match');
  assert.equal(
    interviewDraftFromEvent({ ...a, start: null }, seed.candidates).candidateId,
    null,
    'events without a usable start are never auto-matched',
  );
});

test('forwarded emails yield a parseable CV body', () => {
  const em =
    'From: Devika Nair <devika@example.com>\nSubject: Application — Senior Databricks Architect\nMIME-Version: 1.0\nContent-Type: text/html; charset=UTF-8\n\n<html><body><p>Devika Nair</p><p>devika@example.com</p><p>Senior Databricks Engineer, 7 years with Spark, Databricks, Delta Lake and Azure.</p></body></html>';
  const body = emailBodyText(em);
  assert.ok(!body.includes('MIME-Version'), 'headers stripped');
  assert.ok(!body.includes('<p>'), 'html tags stripped');
  assert.ok(body.includes('Devika Nair'), 'body text preserved');
  assert.equal(emailBodyText('Just a bare body line'), 'Just a bare body line');
});

test('backups carry a table manifest and stay backward-compatible', () => {
  const bundle = backupBundle(seed);
  // Pinned to the schema rather than a literal, so adding a table cannot silently drop it from
  // the backup manifest without this assertion noticing.
  assert.deepEqual(
    bundle.tableList.length,
    TABLES.length,
    'the manifest lists every table in the schema',
  );
  for (const table of ['workflowRules', 'clients', 'clientContacts'])
    assert.ok(bundle.tableList.includes(table), `${table} is included in the backup manifest`);
  const restored = parseBackup(JSON.stringify(bundle));
  assert.equal(restored.rows.workflowRules.length, seed.workflowRules.length);
  const legacy = JSON.parse(JSON.stringify(bundle));
  delete legacy.tableList;
  delete legacy.workflowRules;
  const old = parseBackup(JSON.stringify(legacy));
  assert.deepEqual(
    old.rows.workflowRules,
    [],
    'a pre-rules backup restores with an empty rules table',
  );
  assert.throws(
    () => parseBackup('{"format":"ecod-workspace-backup","version":1,"candidates":[]}'),
    /missing the demands table/,
    'legacy backups still guard core tables',
  );
});
