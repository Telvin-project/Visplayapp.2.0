import fs from 'node:fs';
import path from 'node:path';
import { auditLegacyFinance } from '../server/finance-reconciliation.js';
import type { DatabaseSchema } from '../server/db.js';

const inputFlag = process.argv.indexOf('--input');
const inputFile = inputFlag < 0 ? path.resolve('data/visplay_db.json') : process.argv[inputFlag + 1];
if (!inputFile || !fs.existsSync(inputFile)) {
  throw new Error('Provide --input with an existing, backed-up VisPlay JSON snapshot.');
}
const snapshot = JSON.parse(fs.readFileSync(inputFile, 'utf8')) as DatabaseSchema;
if (!snapshot?.users || !snapshot?.transactions || !snapshot?.purchases || !snapshot?.ledger || !snapshot?.payouts) {
  throw new Error('Input does not resemble a complete VisPlay financial snapshot.');
}
const report = auditLegacyFinance(snapshot);
console.log(JSON.stringify(report, null, 2));
if (!report.readyForReviewedImport) process.exitCode = 2;
