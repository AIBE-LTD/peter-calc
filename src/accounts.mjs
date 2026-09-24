import { createClient } from '@supabase/supabase-js';
import { CALCULATOR_ID, PAYLOAD_VERSION, createRepository, createReportService } from './report-history.mjs';
import './accounts.css';

const $ = (id) => document.getElementById(id);
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
let user = null;
let revision = 0;
let historyRequest = 0;
let offset = 0;
let currentJob = null;
let tracked = new WeakMap();
let resendAt = 0;
const urls = new Set();
const failedSaves = new Map();
const saving = new Set();
const client = url && key ? createClient(url, key, {
  auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;
const repository = client && createRepository(client);
const service = repository && createReportService({ repository, onState(job, state) {
  saving.delete(job.row.id);
  failedSaves.delete(job.row.id);
  if (state === 'saving') saving.add(job.row.id);
  if (state === 'error') failedSaves.set(job.row.id, job);
  renderSaveStatus();
  if (state === 'saved' && $('history-dialog').open) loadHistory(true);
} });

function renderSaveStatus() {
  $('history-save-retry').hidden = !failedSaves.size;
  if (failedSaves.size) {
    $('history-save-status').textContent = `${failedSaves.size} analysis save${failedSaves.size === 1 ? '' : 's'} incomplete. Keep this page open and retry.`;
  } else if (saving.size) {
    $('history-save-status').textContent = 'Saving your analyses and their original PDFs…';
  } else {
    $('history-save-status').textContent = currentJob?.row.pdf_status === 'ready' ? 'Saved to My Results.' : '';
  }
}

function clearDownloads() {
  for (const url of urls) URL.revokeObjectURL(url);
  urls.clear();
  document.querySelectorAll('[data-history-download]').forEach((link) => link.remove());
}

function applySession(session) {
  const next = session?.user || null;
  if (user?.id !== next?.id) {
    revision++;
    historyRequest++;
    clearDownloads();
    service?.setOwner(next?.id || null);
    tracked = new WeakMap();
    currentJob = null;
    failedSaves.clear();
    saving.clear();
    $('history-list').replaceChildren();
    $('history-notice').textContent = '';
    $('history-save-status').textContent = '';
    $('history-save-retry').hidden = true;
    $('history-more').hidden = true;
    $('history-dialog').close();
    window.dispatchEvent(new Event('calculator:account-changed'));
  }
  user = next;
  $('account-label').textContent = user ? user.email : 'Sign in to keep your results across devices.';
  $('account-sign-in').hidden = !!user;
  $('account-sign-out').hidden = !user;
  $('account-history').hidden = !user;
  if (user) $('auth-dialog').close();
}

function message(error) {
  if (!navigator.onLine) return 'You are offline. Reconnect and retry.';
  if (error?.status === 429) return 'Too many requests. Please wait before trying again.';
  return 'Something went wrong. Please retry. Your current calculation is still available.';
}

function saveBlob(blob, title, container) {
  const objectUrl = URL.createObjectURL(blob);
  urls.add(objectUrl);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `${title.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 100) || 'Calculator-report'}.pdf`;
  link.textContent = 'Save PDF';
  link.dataset.historyDownload = '';
  container.querySelector('[data-history-download]')?.remove();
  container.append(link);
  link.click();
}

async function loadHistory(reset = false) {
  if (!user || !repository) return;
  const stamp = revision;
  const request = ++historyRequest;
  if (reset) {
    offset = 0;
    clearDownloads();
    $('history-list').replaceChildren();
  }
  $('history-notice').textContent = 'Loading your results…';
  $('history-more').disabled = true;
  $('history-refresh').disabled = true;
  try {
    const page = await repository.list({ userId: user.id, calculatorId: $('history-calculator').value, offset });
    if (stamp !== revision || request !== historyRequest) return;
    page.rows.forEach(renderHistoryRow);
    offset += page.rows.length;
    $('history-more').hidden = !page.hasMore;
    $('history-notice').textContent = offset ? '' : 'No saved results yet. Analyze a deal while signed in to save your first report.';
  } catch (error) {
    if (stamp === revision && request === historyRequest) $('history-notice').textContent = message(error);
  } finally {
    if (stamp === revision && request === historyRequest) {
      $('history-more').disabled = false;
      $('history-refresh').disabled = false;
    }
  }
}

function renderHistoryRow(row) {
  const item = document.createElement('article');
  item.className = 'history-item';
  const title = document.createElement('h3');
  title.textContent = row.title;
  const detail = document.createElement('p');
  detail.textContent = `${row.calculators?.display_name || 'Calculator'} · ${new Date(row.created_at).toLocaleString()} · ${row.pdf_status === 'ready' ? 'PDF ready' : 'PDF preparation incomplete'}`;
  item.append(title, detail);
  if (row.pdf_status === 'ready' || (row.calculator_id === CALCULATOR_ID && row.payload_schema_version === PAYLOAD_VERSION)) {
    const button = document.createElement('button');
    button.className = 'account-button';
    button.textContent = row.pdf_status === 'ready' ? 'Download PDF' : 'Retry PDF preparation';
    button.addEventListener('click', async () => {
      const stamp = revision;
      button.disabled = true;
      try {
        if (row.pdf_status === 'ready') {
          const blob = await service.download(row);
          if (stamp === revision) saveBlob(blob, row.title, item);
        } else {
          const full = await repository.get(row.id);
          if (stamp !== revision) return;
          await service.resume(full);
          if (stamp === revision) await loadHistory(true);
        }
      } catch (error) {
        if (stamp === revision) detail.textContent = message(error);
      } finally { if (stamp === revision) button.disabled = false; }
    });
    item.append(button);
  } else {
    const origin = row.calculators?.application_url;
    if (origin && /^https:\/\//.test(origin) && row.calculator_id !== CALCULATOR_ID) {
      const link = document.createElement('a');
      link.className = 'account-button';
      link.href = origin;
      link.textContent = 'Open original calculator to retry';
      link.rel = 'noopener noreferrer';
      item.append(link);
    } else {
      const note = document.createElement('p');
      note.textContent = 'Preparation requires the original calculator version. Please contact support.';
      item.append(note);
    }
  }
  $('history-list').append(item);
}

// The calculator only depends on this narrow bridge; future apps can use the repository independently.
window.calculatorAccount = {
  async pdfFor(report) {
    const job = tracked.get(report);
    if (!job) return null;
    return service.start(job);
  },
};
window.addEventListener('calculator:analyzed', (event) => {
  const job = service?.capture(event.detail);
  currentJob = job;
  renderSaveStatus();
  if (!job) {
    $('history-save-status').textContent = client ? 'Sign in before your next analysis to save reports automatically.' : '';
    return;
  }
  tracked.set(event.detail, job);
  service.start(job).catch(() => {}); // The state callback presents the retry action.
});
window.addEventListener('calculator:invalidated', () => {
  currentJob = null;
  renderSaveStatus();
});
$('history-save-retry').addEventListener('click', () => {
  for (const job of [...failedSaves.values()]) service.start(job).catch(() => {});
});
$('account-sign-in').addEventListener('click', () => $('auth-dialog').showModal());
document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => $(button.dataset.closeDialog).close());
});
$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!client || Date.now() < resendAt) return;
  $('auth-submit').disabled = true;
  $('auth-notice').textContent = 'Sending your sign-in link…';
  try {
    const { error } = await client.auth.signInWithOtp({ email: $('auth-email').value.trim(), options: {
      shouldCreateUser: true, emailRedirectTo: new URL('/', location.origin).href,
    } });
    if (error) throw error;
    resendAt = Date.now() + 60_000;
    $('auth-notice').textContent = 'Check your email and open the link to sign in or create your account. You can request another link in one minute.';
    setTimeout(() => { $('auth-submit').disabled = false; $('auth-submit').textContent = 'Send another link'; }, 60_000);
  } catch (error) {
    $('auth-notice').textContent = message(error);
    $('auth-submit').disabled = false;
  }
});
$('account-sign-out').addEventListener('click', async () => {
  $('account-sign-out').disabled = true;
  const { error } = await client.auth.signOut({ scope: 'local' });
  $('account-sign-out').disabled = false;
  if (error) $('account-label').textContent = 'Could not sign out. Please retry.';
});
$('account-history').addEventListener('click', async () => {
  $('history-dialog').showModal();
  const stamp = revision;
  try {
    const calculators = await repository.calculators();
    if (stamp !== revision) return;
    $('history-calculator').replaceChildren(new Option('All calculators', ''));
    calculators.forEach((calculator) => $('history-calculator').add(new Option(calculator.display_name, calculator.id)));
    await loadHistory(true);
  } catch (error) { if (stamp === revision) $('history-notice').textContent = message(error); }
});
$('history-calculator').addEventListener('change', () => loadHistory(true));
$('history-more').addEventListener('click', () => loadHistory());
$('history-refresh').addEventListener('click', () => loadHistory(true));
$('history-dialog').addEventListener('close', clearDownloads);

if (!client) {
  $('account-label').textContent = 'Account history is not configured yet. You can still analyze and download.';
  $('account-sign-in').disabled = true;
} else {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const callbackError = fragment.has('error') || new URLSearchParams(location.search).has('error');
  const hasCallback = fragment.has('access_token') || callbackError;
  client.auth.onAuthStateChange((_event, session) => { applySession(session); });
  client.auth.getSession().then(({ data, error }) => {
    if (error || callbackError) {
      $('auth-notice').textContent = 'This sign-in link is invalid or expired. Request a new link below.';
      $('auth-dialog').showModal();
    } else applySession(data.session);
    if (hasCallback) history.replaceState(null, '', location.pathname);
  }).catch(() => {
    $('account-label').textContent = 'Could not restore your account. Please sign in again.';
    if (hasCallback) history.replaceState(null, '', location.pathname);
  });
}
