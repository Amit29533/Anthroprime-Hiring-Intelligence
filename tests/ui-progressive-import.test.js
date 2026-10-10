import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { load, mount, cleanup, stopVite, screen, fireEvent, settle } from './ui-harness.js';
import { makeSeed } from '../src/seed.js';
let ImportModal, DisclosureSection, LinkedinImport;
test.before(async () => {
  ImportModal = (await load('/src/ImportCandidates.jsx')).ImportModal;
  DisclosureSection = (await load('/src/DisclosureSection.jsx')).DisclosureSection;
  LinkedinImport = (await load('/src/LinkedinImport.jsx')).LinkedinImport;
});
afterEach(cleanup);
test.after(stopVite);

test('closed sections defer mounting and preserve input after closing and reopening', async () => {
  await mount(DisclosureSection, {
    title: 'Optional details',
    children: React.createElement('input', { 'aria-label': 'Draft note', defaultValue: '' }),
  });
  const toggle = screen.getByRole('button', { name: 'Optional details' });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(screen.queryByRole('textbox', { name: 'Draft note' }), null);
  fireEvent.click(toggle);
  fireEvent.change(screen.getByRole('textbox', { name: 'Draft note' }), {
    target: { value: 'Keep my work' },
  });
  fireEvent.click(toggle);
  assert.equal(screen.queryByRole('textbox', { name: 'Draft note' }), null);
  fireEvent.click(toggle);
  assert.equal(screen.getByRole('textbox', { name: 'Draft note' }).value, 'Keep my work');
  assert.ok(document.getElementById(toggle.getAttribute('aria-controls')));
});

test('import starts with source choices and preserves LinkedIn setup while switching routes', async () => {
  await mount(ImportModal, {
    data: makeSeed(),
    onClose() {},
    onSave: async () => assert.fail('No write expected'),
  });
  assert.equal(screen.queryByRole('textbox', { name: 'LinkedIn profile URL or ID' }), null);
  assert.equal(screen.queryByLabelText('Candidate spreadsheet file'), null);
  fireEvent.click(screen.getByRole('button', { name: /^LinkedIn profile/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'LinkedIn profile URL or ID' }), {
    target: { value: 'mira-testcandidate' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Spreadsheet/ }));
  assert.equal(screen.queryByRole('textbox', { name: 'LinkedIn profile URL or ID' }), null);
  assert.ok(screen.getByLabelText('Candidate spreadsheet file'));
  fireEvent.click(screen.getByRole('button', { name: /^LinkedIn profile/ }));
  assert.equal(
    screen.getByRole('textbox', { name: 'LinkedIn profile URL or ID' }).value,
    'mira-testcandidate',
  );
  assert.equal(document.querySelectorAll('.import-source-picker > .is-open').length, 1);
});

test('LinkedIn guides setup, import and review, while advanced actions stay closed', async () => {
  await mount(LinkedinImport, {
    data: { candidates: [] },
    isCloud: false,
    canImport: true,
    readClipboard: async () =>
      JSON.stringify({
        url: 'https://www.linkedin.com/in/mira-testcandidate/',
        name: 'Mira Testcandidate',
      }),
    onSave: async () => assert.fail('A draft cannot auto-save'),
  });
  assert.ok(screen.getByRole('button', { name: 'Copy extraction command' }));
  assert.equal(screen.queryByRole('button', { name: 'Paste extracted profile' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Copy forget-login command' }), null);
  assert.equal(screen.queryByRole('button', { name: 'Look up LinkedIn ID' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Continue to import result' }));
  assert.equal(screen.queryByRole('button', { name: 'Copy extraction command' }), null);
  fireEvent.click(screen.getByRole('button', { name: 'Paste extracted profile' }));
  await settle();
  assert.equal(
    screen.getByRole('button', { name: /Step 3/ }).getAttribute('aria-expanded'),
    'true',
  );
  assert.equal(document.activeElement.textContent, 'Check candidate details');
  assert.equal(
    screen.getByRole('button', { name: 'Save reviewed LinkedIn candidate' }).disabled,
    true,
  );
  assert.equal(screen.queryByRole('button', { name: 'Paste extracted profile' }), null);
});
