import { localVector } from '../../../src/localVector.js';

export async function runIndexBatch(client) {
  const { data: jobs, error } = await client.rpc('worker_claim_index', { p_limit: 20 });
  if (error) throw new Error('Private index queue is unavailable.');
  // One request per item, with four concurrent completions, keeps the batch bounded.
  let completed = 0,
    failed = 0,
    unrecorded = 0;
  for (let offset = 0; offset < (jobs || []).length; offset += 4) {
    const results = await Promise.all(
      jobs.slice(offset, offset + 4).map(async (job) => {
        const args = {
          p_workspace: job.workspaceId,
          p_candidate: job.candidateId,
          p_lease: job.lease,
        };
        try {
          const result = await client.rpc('worker_finish_index', {
            ...args,
            p_vector: localVector(job.text),
          });
          if (!result.error) return result.data ? 'completed' : 'superseded';
        } catch {
          // Transport errors need the same retry bookkeeping as RPC errors.
        }
        try {
          const retry = await client.rpc('worker_finish_index', { ...args, p_failed: true });
          if (retry.error) return 'unrecorded';
          return retry.data ? 'failed' : 'superseded';
        } catch {
          return 'unrecorded';
        }
      }),
    );
    completed += results.filter((status) => status === 'completed').length;
    failed += results.filter((status) => status === 'failed').length;
    unrecorded += results.filter((status) => status === 'unrecorded').length;
  }
  // Finish all claimed jobs before surfacing a sanitized error to the scheduler.
  if (unrecorded) throw new Error('Index completion could not be recorded.');
  return { claimed: (jobs || []).length, completed, failed };
}
