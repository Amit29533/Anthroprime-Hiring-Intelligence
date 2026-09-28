// Phase B: bulk operations through the real repository screen. The behaviour that matters is
// the preview — a bulk action must never leave a user believing it did more than it did.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, mount, screen, cleanup, stopVite, settle, act, fireEvent } from './ui-harness.js';
import { navTo, press, allText } from './ui-drivers.js';
import { makeSeed } from '../src/seed.js';
import { normalizeData } from '../src/schema.js';

let M;
test.before(async () => {
  M = await loadApp();
});
test.after(async () => {
  cleanup();
  await stopVite();
});
afterEach(() => cleanup());

// Demo mode only writes to localStorage on the first save, so fall back to the seed for reads
// that happen before anything has been written.
const store = () =>
  JSON.parse(localStorage.getItem('ecod-demo-v1') || 'null') || normalizeData(makeSeed());

async function boot(seed) {
  localStorage.removeItem('ecod-demo-v1');
  if (seed) localStorage.setItem('ecod-demo-v1', JSON.stringify(seed));
  await mount(M.App, {});
  await settle(6);
  await navTo('Candidates');
}

/** Tick the row checkboxes for the first `n` visible candidates. */
async function selectRows(n) {
  const boxes = [...document.querySelectorAll('tbody input[type="checkbox"]')].slice(0, n);
  for (const box of boxes)
    await act(async () => {
      fireEvent.click(box);
    });
  await settle(2);
  return boxes.length;
}

const setControl = async (label, value) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
  await settle(2);
};

test('the bulk bar appears only once something is selected', async () => {
  await boot();
  assert.equal(
    document.querySelector('.bulk-bar') === null,
    true,
    'nothing selected, nothing offered',
  );
  await selectRows(2);
  assert.ok(document.querySelector('.bulk-bar'), 'the bar appears with a selection');
  assert.ok(allText(/2 selected/).length);
  cleanup();
});

test('an action must be previewed before it can be applied', async () => {
  await boot();
  await selectRows(2);
  await setControl('Bulk action', 'tag');
  await setControl('Bulk value', 'Bench 2026');
  assert.equal(
    [...document.querySelectorAll('button')].some((b) => /^Apply to/.test(b.textContent.trim())),
    false,
    'there is no way to apply without looking first',
  );
  await press('Preview');
  assert.ok(
    [...document.querySelectorAll('button')].some((b) => /^Apply to 2$/.test(b.textContent.trim())),
    'the apply button states exactly how many records it will touch',
  );
  cleanup();
});

test('the preview names the records and what will change', async () => {
  await boot();
  await selectRows(2);
  const names = [...document.querySelectorAll('tbody tr')]
    .slice(0, 2)
    .map((r) => r.querySelector('strong')?.textContent);
  await setControl('Bulk action', 'owner');
  await setControl('Bulk value', 'Neha Kulkarni');
  await press('Preview');
  const preview = document.querySelector('.bulk-preview').textContent;
  for (const name of names) assert.ok(preview.includes(name), `${name} is listed in the preview`);
  assert.match(preview, /Owner .* → Neha Kulkarni|Owner set to Neha Kulkarni/);
  cleanup();
});

test('applying writes every changed record and reports the count', async () => {
  await boot();
  const n = await selectRows(3);
  await setControl('Bulk action', 'tag');
  await setControl('Bulk value', 'Bench 2026');
  await press('Preview');
  const apply = [...document.querySelectorAll('button')].find((b) =>
    /^Apply to/.test(b.textContent.trim()),
  );
  assert.ok(apply, 'the apply button is on screen');
  await act(async () => {
    fireEvent.click(apply);
  });
  await settle(5);
  const tagged = store().candidates.filter((c) => (c.tags || []).includes('Bench 2026'));
  assert.equal(tagged.length, n, 'every selected record was written');
  assert.ok(allText(/records updated/).length, 'the result is confirmed');
  assert.equal(
    document.querySelectorAll('tbody input[type="checkbox"]:checked').length,
    0,
    'and the selection clears',
  );
  assert.ok(allText('Change applied').length, 'leaving the undo affordance behind');
  cleanup();
});

test('records that already match are skipped, and the user is told how many', async () => {
  const seed = makeSeed();
  seed.candidates = seed.candidates.map((c, i) =>
    i === 0 ? { ...c, tags: [...(c.tags || []), 'Bench 2026'] } : c,
  );
  await boot(seed);
  await selectRows(3);
  await setControl('Bulk action', 'tag');
  await setControl('Bulk value', 'Bench 2026');
  await press('Preview');
  assert.ok(allText(/1 already tagged/i).length, 'the skip is surfaced, not silent');
  assert.ok(
    [...document.querySelectorAll('button')].some((b) => /^Apply to 2$/.test(b.textContent.trim())),
    'and the apply button counts only the records that will actually change',
  );
  cleanup();
});

test('a no-op selection says so instead of offering a misleading apply', async () => {
  const seed = makeSeed();
  seed.candidates = seed.candidates.map((c) => ({ ...c, status: 'Ready' }));
  await boot(seed);
  await selectRows(3);
  await setControl('Bulk action', 'status');
  await setControl('Bulk value', 'Ready');
  assert.ok(allText(/already match/).length, 'the bar explains there is nothing to do');
  cleanup();
});

test('a bulk change can be undone in one click', async () => {
  await boot();
  // saveRows hoists updated rows to the front, so compare by id rather than by position.
  const statusById = () => Object.fromEntries(store().candidates.map((c) => [c.id, c.status]));
  const before = statusById();
  await selectRows(2);
  await setControl('Bulk action', 'status');
  await setControl('Bulk value', 'Unavailable');
  await press('Preview');
  const apply = [...document.querySelectorAll('button')].find((b) =>
    /^Apply to/.test(b.textContent.trim()),
  );
  await act(async () => {
    fireEvent.click(apply);
  });
  await settle(5);
  assert.ok(
    store().candidates.filter((c) => c.status === 'Unavailable').length >= 2,
    'the change landed',
  );
  await press('Undo');
  await settle(5);
  assert.deepEqual(statusById(), before, 'every previous value was restored exactly');
  assert.ok(allText(/Change undone/).length);
  cleanup();
});

test('shortlisting in bulk creates pipeline entries and skips those already there', async () => {
  await boot();
  const seedData = store();
  const openDemand = seedData.demands.find((d) => d.status === 'Open');
  const already = seedData.considerations.filter((k) => k.demandId === openDemand.id).length;
  await selectRows(3);
  await setControl('Bulk action', 'shortlist');
  await setControl('Bulk value', openDemand.id);
  await press('Preview');
  const apply = [...document.querySelectorAll('button')].find((b) =>
    /^Apply to/.test(b.textContent.trim()),
  );
  assert.ok(apply, 'there is something to do');
  const willAdd = Number(apply.textContent.replace(/\D/g, ''));
  await act(async () => {
    fireEvent.click(apply);
  });
  await settle(5);
  const now = store().considerations.filter((k) => k.demandId === openDemand.id).length;
  assert.equal(now, already + willAdd, 'exactly the previewed number of entries was created');
  cleanup();
});

test('a viewer is offered no bulk controls at all', async () => {
  const { createHarness } = await import('./ui-harness.js');
  const h = createHarness(normalizeData(makeSeed()));
  await mount(M.BulkBar, {
    data: h.state.data,
    selected: [h.state.data.candidates[0].id],
    onSave: h.save,
    notify: h.noop,
    onClear: h.noop,
    role: 'viewer',
  });
  await settle(2);
  assert.ok(allText(/viewer role cannot change records/i).length, 'and is told why');
  await press('Preview');
  assert.equal(h.state.writes.length, 0, 'nothing is written even if the control is reached');
  cleanup();
});
