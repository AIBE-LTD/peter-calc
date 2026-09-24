export const CALCULATOR_ID = 'aa2c4ddc-8587-4da0-9b10-a76b211ec99e';
export const PAYLOAD_VERSION = 1;
export const REPORT_BUCKET = 'calculator-reports';
export const PAGE_SIZE = 20;

export function reportPath(report) {
  return `${report.user_id}/${report.calculator_id}/${report.id}.pdf`;
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export function createRepository(client) {
  const bucket = client.storage.from(REPORT_BUCKET);
  return {
    async insert(report) {
      const { id, user_id, calculator_id, title, payload_schema_version, payload } = report;
      const result = await client.from('calculator_reports').insert({
        id, user_id, calculator_id, title, payload_schema_version, payload, pdf_status: 'pending',
      }).select().single();
      if (result.error?.code === '23505') {
        return unwrap(await client.from('calculator_reports').select('*').eq('id', report.id).single());
      }
      return unwrap(result);
    },
    async ready(report) {
      return unwrap(await client.from('calculator_reports').update({ pdf_status: 'ready' })
        .eq('id', report.id).eq('user_id', report.user_id).select().single());
    },
    async get(id) {
      return unwrap(await client.from('calculator_reports').select('*').eq('id', id).single());
    },
    async list({ userId, calculatorId, offset = 0 }) {
      let query = client.from('calculator_reports')
        .select('id,user_id,calculator_id,created_at,title,payload_schema_version,pdf_status,calculators(display_name,application_url)')
        .eq('user_id', userId).order('created_at', { ascending: false }).order('id', { ascending: false });
      if (calculatorId) query = query.eq('calculator_id', calculatorId);
      const rows = unwrap(await query.range(offset, offset + PAGE_SIZE));
      return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
    },
    async calculators() {
      return unwrap(await client.from('calculators').select('id,display_name,application_url').order('display_name'));
    },
    async download(report) {
      return unwrap(await bucket.download(reportPath(report), {}, { cache: 'no-store' }));
    },
    async existing(report) {
      const result = await bucket.download(reportPath(report), {}, { cache: 'no-store' });
      if (!result.error) return result.data;
      // Only absence permits rendering. Network/permission failures must not replace an original.
      if (['404', 'not_found', 'NoSuchKey'].includes(String(result.error.statusCode || result.error.code))) return null;
      if (String(result.error.statusCode) === '400' && /not found|does not exist/i.test(result.error.message)) return null;
      throw result.error;
    },
    async upload(report, pdf) {
      return unwrap(await bucket.upload(reportPath(report), pdf, { contentType: 'application/pdf', upsert: false, cacheControl: '0' }));
    },
  };
}

export async function renderPdf(payload, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 45_000);
  try {
    const response = await fetch('/api/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal,
    });
    if (!response.ok) throw new Error('The PDF service could not create your report. Please retry.');
    const blob = await response.blob();
    if (!blob.type.includes('application/pdf') || await blob.slice(0, 5).text() !== '%PDF-') {
      throw new Error('The PDF service returned an invalid file. Please retry.');
    }
    return blob;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

// Captures the owner at analysis time. Every async boundary verifies that the same session still owns the work.
export function createReportService({ repository, render = renderPdf, onState = () => {}, uuid = () => crypto.randomUUID() }) {
  let owner = null;
  let epoch = 0;
  const jobs = new Map();
  function assertCurrent(job) {
    if (owner !== job.row.user_id || epoch !== job.epoch) throw new Error('Your account changed. Sign in again to continue.');
  }
  async function run(job) {
    assertCurrent(job);
    onState(job, 'saving');
    try {
      job.row = await repository.insert(job.row);
      assertCurrent(job);
      let pdf = await repository.existing(job.row);
      assertCurrent(job);
      if (!pdf) {
        // Never regenerate a row marked ready if its original file is unavailable.
        if (job.row.pdf_status === 'ready') throw new Error('The original PDF is unavailable. Please try again later.');
        pdf = job.pdf || await render(job.row.payload, job.controller.signal);
        assertCurrent(job);
        job.pdf = pdf;
        try {
          await repository.upload(job.row, pdf);
        } catch (error) {
          assertCurrent(job);
          // Another tab or a timed-out upload may have already saved the original.
          const original = await repository.existing(job.row);
          if (!original) throw error;
          pdf = original;
        }
        assertCurrent(job);
      }
      if (job.row.pdf_status !== 'ready') {
        job.row = await repository.ready(job.row);
        assertCurrent(job);
      }
      job.pdf = pdf;
      onState(job, 'saved');
      return pdf;
    } catch (error) {
      if (owner === job.row.user_id && epoch === job.epoch) onState(job, 'error', error);
      throw error;
    }
  }
  function start(job) {
    if (!job.promise) job.promise = run(job).finally(() => { job.promise = null; });
    return job.promise;
  }
  return {
    setOwner(userId) {
      if (owner === userId) return;
      owner = userId;
      epoch++;
      for (const job of jobs.values()) job.controller.abort();
      jobs.clear();
    },
    capture(payload) {
      if (!owner) return null;
      const row = {
        id: uuid(), user_id: owner, calculator_id: CALCULATOR_ID,
        title: [payload.preparedFor, payload.inputs.address].filter(Boolean).join(' — ').slice(0, 240) || 'Peter deal analysis',
        payload_schema_version: PAYLOAD_VERSION, payload: structuredClone(payload), pdf_status: 'pending',
      };
      const job = { row, epoch, controller: new AbortController(), pdf: null, promise: null };
      jobs.set(row.id, job);
      return job;
    },
    start,
    async resume(row) {
      if (row.calculator_id !== CALCULATOR_ID || row.payload_schema_version !== PAYLOAD_VERSION) {
        throw new Error('This report must be prepared by its original calculator version.');
      }
      let job = jobs.get(row.id);
      if (!job) {
        job = { row, epoch, controller: new AbortController(), pdf: null, promise: null };
        jobs.set(row.id, job);
      }
      return start(job);
    },
    async download(row) {
      const stamp = epoch;
      if (!owner || row.user_id !== owner) throw new Error('Sign in to download this report.');
      const pdf = await repository.download(row);
      if (stamp !== epoch || row.user_id !== owner) throw new Error('Your account changed. Please retry.');
      return pdf;
    },
  };
}
