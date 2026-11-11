/** Section H: read-only configuration checks. Never include secret values in
 * findings, logs, health responses, or employer-facing evidence screenshots. */

export type DeploymentStage = 'local' | 'staging' | 'production';
export interface PreflightFinding {
  severity: 'BLOCKER' | 'WARNING';
  code: string;
  action: string;
}
export interface PreflightReport {
  stage: DeploymentStage;
  ready_for_staging_checks: boolean;
  findings: PreflightFinding[];
}

const DEV_SECRET = 'visplay-super-secure-jwt-secret-nollywood-2026';

function properHttpsUrl(value?: string, allowPath = false): URL | null {
  if (!value || /my_|your-|replace|placeholder|example|\s/i.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname ||
      url.hash || (url.pathname !== '/' && !allowPath) || (!allowPath && url.search)) return null;
    return url;
  } catch { return null; }
}

export function inspectRuntimeConfig(env: Record<string, string | undefined>): PreflightReport {
  const findings: PreflightFinding[] = [];
  const stageValue = env.VISPLAY_DEPLOYMENT_STAGE || (env.NODE_ENV === 'production' ? 'production' : 'local');
  const stage: DeploymentStage = stageValue === 'staging' || stageValue === 'production' ? stageValue : 'local';
  const add = (severity: PreflightFinding['severity'], code: string, action: string) =>
    findings.push({ severity, code, action });
  if (!['local', 'staging', 'production'].includes(stageValue)) {
    add('BLOCKER', 'STAGE_INVALID', 'Set VISPLAY_DEPLOYMENT_STAGE to local, staging or production.');
  }
  if ((stage === 'local' && env.NODE_ENV === 'production') ||
    (stage !== 'local' && env.NODE_ENV !== 'production')) {
    add('BLOCKER', 'NODE_STAGE_MISMATCH', 'Use a production-mode Node build for staging/production, and development mode only locally.');
  }
  if (stage === 'local') {
    add('WARNING', 'LOCAL_ONLY', 'Local source checks do not qualify provider integrations or a deployment.');
    return { stage, ready_for_staging_checks: findings.every(item => item.severity !== 'BLOCKER'), findings };
  }

  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || '';
  const supabase = properHttpsUrl(env.SUPABASE_URL);
  const frontendSupabase = properHttpsUrl(env.VITE_SUPABASE_URL);
  if (!supabase || !frontendSupabase || supabase.origin !== frontendSupabase.origin) {
    add('BLOCKER', 'SUPABASE_PROJECT_MISMATCH', 'Provide matching, non-placeholder HTTPS Supabase URLs for API and website.');
  }
  if (serviceKey.length < 25 || /replace|placeholder|secret-manager|your-|my_/i.test(serviceKey)) {
    add('BLOCKER', 'SUPABASE_SERVER_SECRET', 'Set the server-only Supabase service-role credential in the hosting secret manager.');
  }
  if (env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_PAYSTACK_SECRET_KEY || env.VITE_R2_SECRET_ACCESS_KEY) {
    add('BLOCKER', 'FRONTEND_SECRET_EXPOSURE', 'Remove secret credentials from all VITE_* browser-visible variables and rotate exposed keys.');
  }
  const jwt = env.JWT_SECRET || '';
  if (jwt.length < 32 || jwt === DEV_SECRET || /replace|placeholder|your-|my_|secret-manager/i.test(jwt)) {
    add('BLOCKER', 'SESSION_SIGNING_SECRET', 'Generate and securely store a unique 32+ character session-signing secret.');
  }

  const trusted = (env.TRUSTED_WEB_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const trustedUrls = trusted.map(s => properHttpsUrl(s));
  if (!trusted.length || trusted.some(s => s.includes('*')) || trustedUrls.some(url => !url) ||
    trustedUrls.some((url, index) => url?.origin !== trusted[index].replace(/\/$/, ''))) {
    add('BLOCKER', 'TRUSTED_ORIGINS', 'Provide exact HTTPS origins separated by commas; never use wildcards or paths.');
  }
  const callback = properHttpsUrl(env.PAYSTACK_CALLBACK_URL, true);
  if (!callback || !trustedUrls.some(url => url?.origin === callback.origin)) {
    add('BLOCKER', 'PAYSTACK_CALLBACK', 'Use a trusted HTTPS website origin for the Paystack callback.');
  }
  const paystack = env.PAYSTACK_SECRET_KEY || '';
  if (!(stage === 'production' ? /^sk_live_[A-Za-z0-9]+$/ : /^sk_test_[A-Za-z0-9]+$/).test(paystack) || paystack.length < 20) {
    add('BLOCKER', 'PAYSTACK_MODE', 'Use only a valid test key in staging and a separately authorized live key in production.');
  }

  if (!/^[a-f0-9]{32}$/i.test(env.R2_ACCOUNT_ID || '') ||
    !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY ||
    /replace|placeholder|secret-manager|your-|my_/i.test(env.R2_SECRET_ACCESS_KEY || '')) {
    add('BLOCKER', 'R2_SERVER_CREDENTIALS', 'Configure a scoped R2 account ID and private, server-side S3 credentials.');
  }
  const publicBucket = env.R2_BUCKET_NAME;
  const privateBucket = env.R2_PRIVATE_VIDEO_BUCKET;
  if (!publicBucket || !privateBucket || publicBucket === privateBucket ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(publicBucket) ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(privateBucket)) {
    add('BLOCKER', 'R2_BUCKET_SEPARATION', 'Provide distinct, valid public-assets and private-video bucket names.');
  }
  if (!properHttpsUrl(env.R2_PUBLIC_BASE_URL)) {
    add('BLOCKER', 'R2_PUBLIC_URL', 'Set a real HTTPS public artwork origin, separate from the private master bucket.');
  }
  for (const [name, code] of [
    ['VISPLAY_SUPPORT_EMAIL', 'SUPPORT_CONTACT'],
    ['VISPLAY_COPYRIGHT_EMAIL', 'COPYRIGHT_CONTACT'],
    ['VISPLAY_PRIVACY_EMAIL', 'PRIVACY_CONTACT'],
  ] as const) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env[name] || '')) {
      add('WARNING', code, 'Verify the employer-approved, staffed public support/rights/privacy contact before launch.');
    }
  }
  add('WARNING', 'EXTERNAL_GATES', 'Config checks do not verify privacy, finance reconciliation, private bucket policy, SQL migrations, backups or device tests.');
  return { stage, ready_for_staging_checks: !findings.some(item => item.severity === 'BLOCKER'), findings };
}

export function assertRuntimeConfig(env: Record<string, string | undefined>): void {
  const report = inspectRuntimeConfig(env);
  const codes = report.findings.filter(item => item.severity === 'BLOCKER').map(item => item.code);
  if (codes.length) throw new Error(`VisPlay deployment preflight failed (${codes.join(', ')}). No server started.`);
}
