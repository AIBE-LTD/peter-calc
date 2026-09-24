import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createReportService, CALCULATOR_ID, PAYLOAD_VERSION } from '../src/report-history.mjs';

// Execute the real UI controller against a small DOM and an injected transport.
// This tests user-visible lifecycle behavior without a real email provider.
const controller = readFileSync(new URL('../src/accounts.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replaceAll('import.meta.env', '__env');
const tick = () => new Promise(setImmediate);
function setup({ signedIn = true, hash = '' } = {}) {
  class Element extends EventTarget {
    hidden = false; disabled = false; textContent = ''; value = ''; open = false;
    replaceChildren() {} close() { this.open = false; } showModal() { this.open = true; }
  }
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const window = new EventTarget();
  let session = signedIn ? { user: { id: 'user-a', email: 'a@example.invalid' } } : null;
  let authChange, failInsert = true, insertCount = 0;
  const files = new Map();
  const repository = {
    async insert(row) { insertCount++; if (failInsert) throw new Error('offline'); return row; },
    async existing(row) { return files.get(row.id) || null; },
    async upload(row, blob) { files.set(row.id, blob); },
    async ready(row) { return { ...row, pdf_status: 'ready' }; },
  };
  const locations = [];
  const client = { auth: {
    onAuthStateChange(callback) { authChange = callback; },
    async getSession() { return { data: { session } }; },
    async signOut() { session = null; authChange('SIGNED_OUT', null); return {}; },
  } };
  vm.runInNewContext(controller, {
    __env: { VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_PUBLISHABLE_KEY: 'fixture' },
    document: { getElementById: get, querySelectorAll: () => [] }, window,
    createClient: () => client, createRepository: () => repository,
    createReportService: (options) => createReportService({ ...options, render: async () => new Blob(['%PDF-fixture']) }),
    CALCULATOR_ID, PAYLOAD_VERSION, Event, URL, URLSearchParams, setTimeout, navigator: { onLine: true },
    location: { hash, search: '', pathname: '/', origin: 'https://example.invalid' },
    history: { replaceState: (...args) => locations.push(args) },
  });
  return { get, window, locations, setOnline() { failInsert = false; }, get insertCount() { return insertCount; } };
}

test('a failed analysis stays retryable after the user edits inputs', async () => {
  const ui = setup();
  await tick();
  ui.window.dispatchEvent(new CustomEvent('calculator:analyzed', { detail: {
    preparedFor: 'Recipient', inputs: { address: 'Fixture' }, results: {},
  } }));
  await tick();
  ui.window.dispatchEvent(new Event('calculator:invalidated'));
  assert.match(ui.get('history-save-status').textContent, /incomplete/);
  assert.equal(ui.get('history-save-retry').hidden, false);
  ui.setOnline();
  ui.get('history-save-retry').dispatchEvent(new Event('click'));
  await tick();
  assert.equal(ui.insertCount, 2);
  assert.equal(ui.get('history-save-retry').hidden, true);
});

test('sign-out clears failed saves and prevents a retry under the next account', async () => {
  const ui = setup();
  await tick();
  ui.window.dispatchEvent(new CustomEvent('calculator:analyzed', { detail: { preparedFor: 'Recipient', inputs: {}, results: {} } }));
  await tick();
  ui.get('account-sign-out').dispatchEvent(new Event('click'));
  await tick();
  assert.equal(ui.get('history-save-retry').hidden, true);
  assert.equal(ui.get('account-history').hidden, true);
  ui.get('history-save-retry').dispatchEvent(new Event('click'));
  await tick();
  assert.equal(ui.insertCount, 1);
});

test('expired magic links open a recovery form and remove callback data from the URL', async () => {
  const ui = setup({ signedIn: false, hash: '#error=access_denied&error_code=otp_expired' });
  await tick();
  assert.equal(ui.get('auth-dialog').open, true);
  assert.match(ui.get('auth-notice').textContent, /invalid or expired/);
  assert.equal(ui.locations.at(-1)[2], '/');
});
