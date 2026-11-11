/** Read-only, local checks; safe to run before provider integration. */
import 'dotenv/config';
import { inspectRuntimeConfig } from '../server/ops-config.js';

const report = inspectRuntimeConfig(process.env);
process.stdout.write(`VisPlay ${report.stage} integration preflight (does not contact or change providers):\n`);
for (const item of report.findings) process.stdout.write(`${item.severity} ${item.code}: ${item.action}\n`);
process.stdout.write(report.ready_for_staging_checks ?
  'Configuration syntax: no blockers. Actual integration and operator acceptance remain NOT RUN.\n' :
  'BLOCKED: fix every configuration error before deploying or testing integrations.\n');
if (!report.ready_for_staging_checks) process.exitCode = 2;
