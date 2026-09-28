// Shared DOM environment for the UI test suites.
//
// The SSR smoke suite proves pages *render*. This harness proves they *work*: components are
// mounted in a real DOM and driven with user events, so a ReferenceError inside an onClick
// handler (which SSR never reaches) fails the build instead of the recruiter's browser.
import { JSDOM } from 'jsdom';

const dom = new JSDOM(
  '<!doctype html><html><head></head><body><div id="root"></div></body></html>',
  {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
  },
);

const { window } = dom;

// --- globals the app expects from a browser -------------------------------------------
// Some of these are getter-only on Node's globalThis (navigator, location), so define
// rather than assign.
const define = (name, value) => {
  try {
    globalThis[name] = value;
  } catch {
    /* frozen or getter-only */
  }
  if (globalThis[name] !== value)
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
};

define('window', window);
define('document', window.document);
define('navigator', window.navigator);
define('location', window.location);
define('history', window.history);
define('localStorage', window.localStorage);
define('sessionStorage', window.sessionStorage);
define('HTMLElement', window.HTMLElement);
define('HTMLInputElement', window.HTMLInputElement);
define('HTMLSelectElement', window.HTMLSelectElement);
define('HTMLTextAreaElement', window.HTMLTextAreaElement);
define('HTMLDialogElement', window.HTMLDialogElement);
define('Element', window.Element);
define('Node', window.Node);
define('Event', window.Event);
define('CustomEvent', window.CustomEvent);
define('MouseEvent', window.MouseEvent);
define('File', window.File);
define('FileList', window.FileList);
define('FileReader', window.FileReader);
define('Blob', window.Blob);
define('FormData', window.FormData);
define('DataTransfer', window.DataTransfer);
define('DOMParser', window.DOMParser);
define('getComputedStyle', window.getComputedStyle.bind(window));
define(
  'requestAnimationFrame',
  window.requestAnimationFrame?.bind(window) || ((cb) => setTimeout(() => cb(Date.now()), 0)),
);
define('cancelAnimationFrame', window.cancelAnimationFrame?.bind(window) || clearTimeout);
define('IS_REACT_ACT_ENVIRONMENT', true);

// jsdom does not implement navigation or object URLs; both are used by download helpers.
window.scrollTo = () => {};
window.print = () => {};
window.alert = () => {};
window.confirm = () => true;
window.prompt = () => null;

export const downloaded = [];
const objectUrls = new Map();
let objectUrlSeq = 0;
const createObjectURL = (blob) => {
  const url = `blob:mock/${++objectUrlSeq}`;
  objectUrls.set(url, blob);
  return url;
};
const revokeObjectURL = (url) => {
  objectUrls.delete(url);
};
// App modules are transformed by Vite but still run in Node's realm, so the bare `URL`
// inside downloadFile is Node's URL — whose createObjectURL only accepts a node:buffer
// Blob and throws on jsdom's ("must be an instance of Blob. Received an instance of Blob").
// Install the same recording implementation on both so either resolves identically.
for (const target of [window.URL, globalThis.URL]) {
  if (!target) continue;
  for (const [name, fn] of [
    ['createObjectURL', createObjectURL],
    ['revokeObjectURL', revokeObjectURL],
  ]) {
    try {
      Object.defineProperty(target, name, { value: fn, configurable: true, writable: true });
    } catch {
      /* frozen */
    }
  }
}
// Capture anchor clicks so tests can assert on generated files (CSV/ICS/dossier/backup).
const realCreate = document.createElement.bind(document);
document.createElement = function (tag, options) {
  const el = realCreate(tag, options);
  if (String(tag).toLowerCase() === 'a') {
    const realClick = el.click.bind(el);
    el.click = function () {
      downloaded.push({ name: el.download, href: el.href, blob: objectUrls.get(el.href) });
      return realClick();
    };
  }
  return el;
};
export const blobText = async (blob) => (blob ? await blob.text() : '');
export function resetDownloads() {
  downloaded.length = 0;
}

// jsdom's <dialog> has no layout engine, so showModal/close need a minimal implementation
// for ui.jsx's Modal (which calls el.showModal() in an effect and el.close() on unmount).
if (window.HTMLDialogElement && !window.HTMLDialogElement.prototype.showModal) {
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.show = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.removeAttribute('open');
  };
}

// Web Crypto: jsdom ships crypto without subtle; Node's implementation is complete.
if (!globalThis.crypto?.subtle) globalThis.crypto = globalThis.crypto || {};
if (!globalThis.crypto.subtle) {
  const nodeCrypto = await import('node:crypto');
  globalThis.crypto = nodeCrypto.webcrypto;
  window.crypto = nodeCrypto.webcrypto;
}
if (!globalThis.crypto.randomUUID) {
  const nodeCrypto = await import('node:crypto');
  globalThis.crypto.randomUUID = () => nodeCrypto.randomUUID();
}

/** Release jsdom's timers/loops so the Node process can exit after the suite. */
export function teardownDom() {
  try {
    window.close();
  } catch {
    /* already closed */
  }
}
