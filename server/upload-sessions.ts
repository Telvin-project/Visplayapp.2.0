import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_ACTIVE_UPLOADS, MAX_DAILY_UPLOAD_SESSIONS, MAX_DAILY_RESERVED_BYTES, SESSION_TTL_MS,
  type UploadKind, type UploadUsage,
} from './upload-security.js';

export type UploadStatus = 'created' | 'processing' | 'ready' | 'attaching' | 'consumed' | 'failed' | 'aborted';

export interface UploadSession {
  id: string;
  user_id: string;
  kind: UploadKind;
  usage: UploadUsage;
  content_type: string;
  expected_size: number;
  staging_key: string;
  upload_id: string | null;
  status: UploadStatus;
  final_key: string | null;
  created_at: string;
  expires_at: string;
  updated_at: string;
}

type CreateFields = Pick<UploadSession, 'id' | 'user_id' | 'kind' | 'usage' | 'content_type' | 'expected_size' | 'staging_key' | 'upload_id'>;

class UploadSessionError extends Error {
  constructor(message: string, readonly statusCode = 409) { super(message); }
}

/**
 * Production uses a separate PostgreSQL table and an atomic RPC quota check;
 * not the legacy JSON-row database. An in-memory adapter is DEV/TEST ONLY.
 */
export class UploadSessionStore {
  private memory = new Map<string, UploadSession>();
  private client: SupabaseClient<any> | null;

  constructor() {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (process.env.NODE_ENV === 'production' && (!url || !key)) {
      throw new Error('Production upload sessions require a configured server-only Supabase connection.');
    }
    this.client = url && key ? createClient<any>(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  }

  async create(fields: CreateFields): Promise<UploadSession> {
    if (this.client) {
      const { data, error } = await this.client.rpc('visplay_create_media_upload', {
        p_id: fields.id, p_user_id: fields.user_id, p_kind: fields.kind, p_usage: fields.usage,
        p_content_type: fields.content_type, p_expected_size: fields.expected_size,
        p_staging_key: fields.staging_key, p_upload_id: fields.upload_id,
      });
      if (error || !data) throw new UploadSessionError('Upload quota exceeded or upload-session database migration is unavailable.', 503);
      return data as UploadSession;
    }

    const now = Date.now();
    for (const [id, session] of this.memory) {
      if (Date.parse(session.created_at) < now - 2 * 24 * 60 * 60 * 1000) this.memory.delete(id);
    }
    const recent = [...this.memory.values()].filter(s => s.user_id === fields.user_id && Date.parse(s.created_at) > now - 24 * 60 * 60 * 1000);
    const open = recent.filter(s => ['created', 'processing', 'attaching'].includes(s.status) && Date.parse(s.expires_at) > now);
    if (recent.length >= MAX_DAILY_UPLOAD_SESSIONS || open.length >= MAX_ACTIVE_UPLOADS ||
      recent.reduce((total, s) => total + s.expected_size, 0) + fields.expected_size > MAX_DAILY_RESERVED_BYTES) {
      throw new UploadSessionError('Too many pending uploads or daily upload limit reached.', 429);
    }
    const created = new Date(now).toISOString();
    const record: UploadSession = { ...fields, status: 'created', final_key: null, created_at: created,
      expires_at: new Date(now + SESSION_TTL_MS).toISOString(), updated_at: created };
    this.memory.set(record.id, record);
    return record;
  }

  async get(id: string, userId: string): Promise<UploadSession> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new UploadSessionError('Upload session not found.', 404);
    if (this.client) {
      const { data, error } = await this.client.from('visplay_upload_sessions').select('*').eq('id', id).eq('user_id', userId).maybeSingle();
      if (error) throw new UploadSessionError('Upload-session storage temporarily unavailable.', 503);
      if (!data) throw new UploadSessionError('Upload session not found.', 404);
      return data as UploadSession;
    }
    const record = this.memory.get(id);
    if (!record || record.user_id !== userId) throw new UploadSessionError('Upload session not found.', 404);
    return record;
  }

  /** Compare-and-swap prevents two requests consuming/attaching the same asset. */
  async transition(id: string, userId: string, expected: UploadStatus, status: UploadStatus, fields: Partial<Pick<UploadSession, 'final_key'>> = {}): Promise<UploadSession> {
    if (this.client) {
      const { data, error } = await this.client.from('visplay_upload_sessions')
        .update({ status, ...fields, updated_at: new Date().toISOString() })
        .eq('id', id).eq('user_id', userId).eq('status', expected).select('*').maybeSingle();
      if (error) throw new UploadSessionError('Could not update upload-session state.', 503);
      if (!data) throw new UploadSessionError('Upload has already changed state. Refresh and try again.', 409);
      return data as UploadSession;
    }
    const session = await this.get(id, userId);
    if (session.status !== expected) throw new UploadSessionError('Upload has already changed state. Refresh and try again.', 409);
    Object.assign(session, fields, { status, updated_at: new Date().toISOString() });
    return session;
  }

  async assertActive(id: string, userId: string, status: UploadStatus): Promise<UploadSession> {
    const session = await this.get(id, userId);
    if (session.status !== status) throw new UploadSessionError('Upload is not in the required state.', 409);
    if (Date.parse(session.expires_at) < Date.now()) {
      throw new UploadSessionError('Upload session expired. Start a new upload.', 410);
    }
    return session;
  }

  /** Called by an operator-only maintenance process, never from a browser. */
  async listExpired(cutoff: Date, limit = 100): Promise<UploadSession[]> {
    if (this.client) {
      const { data, error } = await this.client.from('visplay_upload_sessions').select('*')
        .lt('expires_at', cutoff.toISOString()).neq('status', 'consumed').order('expires_at', { ascending: true }).limit(limit);
      if (error) throw new UploadSessionError('Could not list expired upload sessions.', 503);
      return (data || []) as UploadSession[];
    }
    return [...this.memory.values()]
      .filter(session => Date.parse(session.expires_at) < cutoff.getTime() && session.status !== 'consumed')
      .sort((a, b) => a.expires_at.localeCompare(b.expires_at)).slice(0, limit);
  }
}

export function uploadErrorStatus(error: unknown): number {
  return error instanceof UploadSessionError ? error.statusCode : 503;
}
