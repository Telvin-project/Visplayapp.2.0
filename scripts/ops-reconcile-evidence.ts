/**
 * Read-only comparison of RECONCILED, operator-exported JSON evidence.
 * Usage: npm run ops:reconcile -- /approved/path/evidence.json
 * No provider API is contacted; no ledger is modified or approved.
 */
import { readFile, stat } from 'node:fs/promises';
import { reconcileEvidence, type ReconciliationEvidence } from '../server/ops-reconciliation.js';

async function main() {
  if (process.argv.length !== 3) throw new Error('Expected exactly one approved evidence JSON file path.');
  const inputPath = process.argv[2];
  const meta = await stat(inputPath);
  if (!meta.isFile() || meta.size > 10 * 1024 * 1024 || !meta.size) throw new Error('Invalid or oversized evidence file.');
  const raw = await readFile(inputPath, 'utf8');
  const evidence = JSON.parse(raw) as ReconciliationEvidence;
  const result = reconcileEvidence(evidence);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.verdict === 'BLOCKED') process.exitCode = 2;
}

main().catch(() => {
  // Never print raw parse errors or evidence payloads: they may contain PII.
  process.stderr.write('Evidence comparison could not be completed. Check the approved JSON format and file location.\n');
  process.exitCode = 1;
});
