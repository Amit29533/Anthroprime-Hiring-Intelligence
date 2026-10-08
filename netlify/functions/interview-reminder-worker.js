import { executionClient } from './_shared/execution.js';

export const config = { schedule: '* * * * *' };
export function createInterviewReminderWorker({ client = executionClient } = {}) {
  return async () => {
    const { data, error } = await client().rpc('worker_run_interview_reminders', { p_limit: 20 });
    if (error)
      throw new Error(
        'Internal interview reminders failed. Check migrations and service configuration.',
      );
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
export default createInterviewReminderWorker();
