import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRuntimeConfig, assertRuntimeConfig } from '../server/ops-config.ts';

const staging = () => ({
  NODE_ENV: 'production', VISPLAY_DEPLOYMENT_STAGE: 'staging',
  SUPABASE_URL: 'https://goodproject.supabase.co',
  VITE_SUPABASE_URL: 'https://goodproject.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test_service_key_' + 'x'.repeat(32),
  JWT_SECRET: 'different-private-random-key-' + 'x'.repeat(36),
  TRUSTED_WEB_ORIGINS: 'https://staging.visplay.ng',
  PAYSTACK_CALLBACK_URL: 'https://staging.visplay.ng/verify-payment',
  PAYSTACK_SECRET_KEY: 'sk_test_' + 'x'.repeat(30),
  R2_ACCOUNT_ID: 'a'.repeat(32), R2_ACCESS_KEY_ID: 'scoped-access-key',
  R2_SECRET_ACCESS_KEY: 'private-test-s3-key',
  R2_BUCKET_NAME: 'visplay-staging-artwork',
  R2_PRIVATE_VIDEO_BUCKET: 'visplay-staging-private-videos',
  R2_PUBLIC_BASE_URL: 'https://staging-assets.visplay.ng',
  VISPLAY_SUPPORT_EMAIL: 'support@visplay.ng',
  VISPLAY_PRIVACY_EMAIL: 'privacy@visplay.ng',
  VISPLAY_COPYRIGHT_EMAIL: 'copyright@visplay.ng',
});

test('a properly separated staging configuration passes syntax checks without contacting services', () => {
  const report = inspectRuntimeConfig(staging());
  assert.equal(report.ready_for_staging_checks, true);
  assert.equal(report.findings.filter(item => item.severity === 'BLOCKER').length, 0);
  assert.equal(report.findings.some(item => item.code === 'EXTERNAL_GATES'), true);
});

test('test keys cannot launch in production and live keys cannot enter staging', () => {
  const wrongProd = { ...staging(), VISPLAY_DEPLOYMENT_STAGE: 'production' };
  assert.equal(inspectRuntimeConfig(wrongProd).findings.some(item => item.code === 'PAYSTACK_MODE'), true);
  const wrongStage = { ...staging(), PAYSTACK_SECRET_KEY: 'sk_live_' + 'x'.repeat(30) };
  assert.equal(inspectRuntimeConfig(wrongStage).findings.some(item => item.code === 'PAYSTACK_MODE'), true);
});

test('public assets and private film masters cannot occupy the same bucket', () => {
  const bad = staging(); bad.R2_PRIVATE_VIDEO_BUCKET = bad.R2_BUCKET_NAME;
  assert.equal(inspectRuntimeConfig(bad).findings.some(item => item.code === 'R2_BUCKET_SEPARATION'), true);
});

test('browser-injected admin or gateway credentials block deployment', () => {
  const bad = { ...staging(), VITE_PAYSTACK_SECRET_KEY: 'must-not-ship' };
  assert.equal(inspectRuntimeConfig(bad).findings.some(item => item.code === 'FRONTEND_SECRET_EXPOSURE'), true);
});

test('untrusted Paystack callback and wildcard origin fail closed', () => {
  const bad = { ...staging(), TRUSTED_WEB_ORIGINS: '*', PAYSTACK_CALLBACK_URL: 'https://attacker.invalid/callback' };
  assert.equal(inspectRuntimeConfig(bad).findings.some(item => item.code === 'TRUSTED_ORIGINS'), true);
  assert.equal(inspectRuntimeConfig(bad).findings.some(item => item.code === 'PAYSTACK_CALLBACK'), true);
});

test('disagreeing Supabase projects and placeholder session keys block start', () => {
  const bad = { ...staging(), VITE_SUPABASE_URL: 'https://other.supabase.co', JWT_SECRET: 'visplay-super-secure-jwt-secret-nollywood-2026' };
  assert.equal(inspectRuntimeConfig(bad).findings.some(item => item.code === 'SUPABASE_PROJECT_MISMATCH'), true);
  assert.throws(() => assertRuntimeConfig(bad), /SUPABASE_PROJECT_MISMATCH/);
});

test('preflight errors never include supplied sensitive values', () => {
  const bad = { ...staging(), SUPABASE_SERVICE_ROLE_KEY: 'TOP_SECRET_VALUE', PAYSTACK_SECRET_KEY: 'TOP_SECRET_GATEWAY', JWT_SECRET: 'TOP_SECRET_JWT' };
  const serialized = JSON.stringify(inspectRuntimeConfig(bad));
  assert.equal(serialized.includes('TOP_SECRET'), false);
});

test('local source checks remain separate from deployed integrations', () => {
  const report = inspectRuntimeConfig({ NODE_ENV: 'test', VISPLAY_DEPLOYMENT_STAGE: 'local' });
  assert.equal(report.ready_for_staging_checks, true);
  assert.equal(report.findings.some(item => item.code === 'LOCAL_ONLY'), true);
});
