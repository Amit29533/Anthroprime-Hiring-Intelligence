// User-action drivers shared by the UI suites. They query the way a person clicks — by the
// visible label or button text — and are scoped so a breadcrumb, a nav item and a page heading
// that share a word cannot collide. When a modal is open, everything is scoped to it, because
// that is the only thing the user can actually reach.
import assert from 'node:assert/strict';
import { within } from '@testing-library/react';
import { click, change, settle } from './ui-harness.js';

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const startsWith = (text) => new RegExp(`^${escapeRe(text)}`);

/** The container a user can currently interact with: the open dialog, or the page. */
export function scope() {
  const open = [...document.querySelectorAll('dialog')].find(
    (d) => d.open || d.hasAttribute('open'),
  );
  return open || document.body;
}
const q = () => within(scope());

/** Click a sidebar navigation item and let the page render. */
export async function navTo(page) {
  const nav = document.querySelector('nav');
  assert.ok(nav, 'the workspace sidebar is rendered');
  const button = [...nav.querySelectorAll('button')].find((b) =>
    b.textContent.trim().startsWith(page),
  );
  assert.ok(button, `navigation item "${page}" exists`);
  await click(button);
  await settle(2);
  return button;
}

/** Every button whose visible text is exactly `text` (trimmed). */
export function buttonsNamed(text) {
  return [...scope().querySelectorAll('button')].filter(
    (b) => b.textContent.trim() === text.trim(),
  );
}

/** Click a button by its exact visible text. */
export async function press(text, index = 0) {
  const matches = buttonsNamed(text);
  assert.ok(
    matches.length > index,
    `a button labelled "${text}" is on screen (found ${matches.length})`,
  );
  await click(matches[index]);
  await settle(2);
  return matches[index];
}

/** Click a button or button-styled link by its exact visible text. */
export async function pressLink(text, index = 0) {
  const matches = [...scope().querySelectorAll('button, a.button')].filter(
    (b) => b.textContent.trim() === text.trim(),
  );
  assert.ok(matches.length > index, `a control labelled "${text}" is on screen`);
  await click(matches[index]);
  await settle(2);
  return matches[index];
}

/** Type into the control whose accessible label starts with `label`. */
export async function type(label, value) {
  const el = q().getByLabelText(startsWith(label));
  await change(el, value);
  return el;
}

/** Choose an option in the select whose accessible label starts with `label`. */
export async function choose(label, value) {
  const el = q().getByLabelText(startsWith(label));
  await change(el, value);
  return el;
}

/** All controls whose accessible label starts with `label`. */
export const allLabelled = (label) => q().queryAllByLabelText(startsWith(label));
/** The first control whose accessible label starts with `label`, or undefined. */
export const findLabelled = (label) => q().queryByLabelText(startsWith(label));

export const text = (s, opts) => q().queryByText(s, opts);
export const allText = (s, opts) => q().queryAllByText(s, opts);
export const getByText = (s, opts) => q().getByText(s, opts);
export const byPlaceholder = (p) => q().getByPlaceholderText(p);

/**
 * Click the button with this label and let its form submit. Prefers a button that actually
 * lives inside a form, so a page-header button sharing the label cannot be picked by mistake.
 */
export async function submitVia(buttonText) {
  const matches = buttonsNamed(buttonText);
  assert.ok(matches.length, `a button labelled "${buttonText}" is on screen`);
  const button = matches.find((b) => b.closest('form')) || matches[matches.length - 1];
  assert.ok(button.closest('form'), `"${buttonText}" lives inside a form`);
  await click(button);
  await settle(4);
  return button.closest('form');
}

/** Temporarily replace a window dialog function for the duration of `fn`. */
export async function withWindow(name, value, fn) {
  const real = window[name];
  window[name] = value;
  try {
    return await fn();
  } finally {
    window[name] = real;
  }
}

/**
 * The row of a panel that mentions `name`, so a control can be clicked in context rather than
 * by hunting for the Nth button on the page. Rows are cards/articles in this UI; the list is
 * deliberately specific, because `closest('div')` would match the text's own wrapper.
 */
const ROW = '.app-row, .status-row, .iv-row, .match-card, .pipeline-card, article, li';
export function rowOf(name) {
  const hit = allText(name)[0];
  assert.ok(hit, `"${name}" is on screen`);
  const row = hit.closest(ROW);
  assert.ok(row, `"${name}" sits inside a recognisable row`);
  return row;
}

/** Click the button with this exact label that belongs to `row`. */
export async function pressIn(row, label) {
  assert.ok(row, 'the row containing that entry was found');
  const btn = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  assert.ok(btn, `a "${label}" control belongs to that row`);
  await click(btn);
  await settle(4);
  return btn;
}
