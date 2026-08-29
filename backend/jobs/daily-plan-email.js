/**
 * Morning focus email — thin wrapper over daily-memory-pipeline.
 * Cron: 30 13 * * * UTC (~8:30 AM CDT)
 */
export { sendMorningFocusEmail as sendDailyPlanEmail } from './daily-memory-pipeline.js';
