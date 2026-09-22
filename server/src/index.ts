/**
 * Sync API for the finger strength tracker.
 *
 * The client is offline-first: localStorage is the source of truth on each
 * device, and this service is the meeting point between them. Conflicts are
 * resolved last-write-wins on the client's `updatedAt`, which is correct for
 * one person on two devices and predictable enough to reason about.
 */

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
}

type Kind = 'test' | 'session' | 'send' | 'settings';
const KINDS: readonly Kind[] = ['test', 'session', 'send', 'settings'];

interface ChangeIn {
  kind: Kind;
  id: string;
  payload: unknown;
  updatedAt: number;
  deleted?: boolean;
}

interface ChangeOut extends ChangeIn {
  deleted: boolean;
  seq: number;
}

const MAX_CHANGES = 2000;
const MAX_PAYLOAD_BYTES = 256 * 1024;

/* ---------- helpers ---------- */

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] || '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(body: unknown, init: ResponseInit = {}, cors: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors, ...(init.headers || {}) }
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface Auth { userId: string; tokenId: string; }

/**
 * Tokens are looked up by hash, so the plaintext never touches the database
 * and the comparison is an indexed equality rather than a string compare.
 */
async function authenticate(request: Request, env: Env): Promise<Auth | null> {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const hash = await sha256Hex(match[1]);
  const row = await env.DB
    .prepare(`SELECT id, user_id, expires_at, revoked_at FROM auth_tokens WHERE token_hash = ?`)
    .bind(hash)
    .first<{ id: string; user_id: string; expires_at: number | null; revoked_at: number | null }>();

  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && row.expires_at < Date.now()) return null;

  return { userId: row.user_id, tokenId: row.id };
}

function validateChanges(raw: unknown): { changes: ChangeIn[] } | { error: string } {
  if (raw === undefined || raw === null) return { changes: [] };
  if (!Array.isArray(raw)) return { error: 'changes must be an array' };
  if (raw.length > MAX_CHANGES) return { error: `too many changes (max ${MAX_CHANGES})` };

  const changes: ChangeIn[] = [];
  for (const [i, c] of raw.entries()) {
    if (typeof c !== 'object' || c === null) return { error: `changes[${i}] is not an object` };
    const { kind, id, updatedAt, payload, deleted } = c as Record<string, unknown>;
    if (typeof kind !== 'string' || !KINDS.includes(kind as Kind)) return { error: `changes[${i}].kind invalid` };
    if (typeof id !== 'string' || !id || id.length > 128) return { error: `changes[${i}].id invalid` };
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return { error: `changes[${i}].updatedAt invalid` };

    const encoded = JSON.stringify(payload ?? null);
    if (encoded.length > MAX_PAYLOAD_BYTES) return { error: `changes[${i}].payload too large` };

    changes.push({ kind: kind as Kind, id, payload: payload ?? null, updatedAt, deleted: Boolean(deleted) });
  }
  return { changes };
}

/* ---------- sync ---------- */

async function handleSync(request: Request, env: Env, auth: Auth, cors: Record<string, string>) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 }, cors);
  }

  const cursor = Number(body.cursor ?? 0);
  if (!Number.isFinite(cursor) || cursor < 0) {
    return json({ error: 'cursor must be a non-negative number' }, { status: 400 }, cors);
  }

  const parsed = validateChanges(body.changes);
  if ('error' in parsed) return json({ error: parsed.error }, { status: 400 }, cors);
  const { changes } = parsed;

  // --- apply the client's changes, last-write-wins on updatedAt ---
  let applied = 0;
  if (changes.length) {
    const state = await env.DB
      .prepare(`SELECT last_seq FROM sync_state WHERE user_id = ?`)
      .bind(auth.userId)
      .first<{ last_seq: number }>();
    let seq = state?.last_seq ?? 0;

    // Only touch rows the client actually beats, so server_seq stays meaningful:
    // a no-op push must not bump the cursor for every other device.
    const stmts: D1PreparedStatement[] = [];
    const incoming = env.DB.prepare(
      `INSERT INTO records (user_id, kind, id, payload, updated_at, deleted, server_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, kind, id) DO UPDATE SET
         payload    = excluded.payload,
         updated_at = excluded.updated_at,
         deleted    = excluded.deleted,
         server_seq = excluded.server_seq
       WHERE excluded.updated_at > records.updated_at`
    );

    for (const c of changes) {
      seq += 1;
      applied += 1;
      stmts.push(incoming.bind(
        auth.userId, c.kind, c.id, JSON.stringify(c.payload), c.updatedAt, c.deleted ? 1 : 0, seq
      ));
    }

    stmts.push(env.DB.prepare(
      `INSERT INTO sync_state (user_id, last_seq) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET last_seq = excluded.last_seq`
    ).bind(auth.userId, seq));

    // batch() is atomic — a partial apply would leave the cursor lying.
    await env.DB.batch(stmts);
  }

  // --- return everything the client has not seen ---
  const { results } = await env.DB
    .prepare(
      `SELECT kind, id, payload, updated_at, deleted, server_seq
         FROM records
        WHERE user_id = ? AND server_seq > ?
        ORDER BY server_seq ASC
        LIMIT ?`
    )
    .bind(auth.userId, cursor, MAX_CHANGES)
    .all<{ kind: Kind; id: string; payload: string; updated_at: number; deleted: number; server_seq: number }>();

  const out: ChangeOut[] = (results || []).map((r) => ({
    kind: r.kind,
    id: r.id,
    payload: JSON.parse(r.payload),
    updatedAt: r.updated_at,
    deleted: Boolean(r.deleted),
    seq: r.server_seq
  }));

  const head = await env.DB
    .prepare(`SELECT last_seq FROM sync_state WHERE user_id = ?`)
    .bind(auth.userId)
    .first<{ last_seq: number }>();

  // More rows than one page? Keep the cursor at the last row actually sent so
  // the client comes back for the rest instead of skipping it.
  const nextCursor = out.length ? out[out.length - 1].seq : Math.max(cursor, head?.last_seq ?? 0);

  await env.DB
    .prepare(`UPDATE auth_tokens SET last_used_at = ? WHERE id = ?`)
    .bind(Date.now(), auth.tokenId)
    .run();

  return json({
    cursor: nextCursor,
    hasMore: out.length === MAX_CHANGES,
    changes: out,
    applied,
    serverTime: Date.now()
  }, {}, cors);
}

/* ---------- router ---------- */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname === '/v1/health') {
      return json({ ok: true, service: 'climbing-training-sync' }, {}, cors);
    }

    if (url.pathname === '/v1/sync' && request.method === 'POST') {
      const auth = await authenticate(request, env);
      if (!auth) {
        return json({ error: 'unauthorized' }, {
          status: 401,
          headers: { 'WWW-Authenticate': 'Bearer' }
        }, cors);
      }
      try {
        return await handleSync(request, env, auth, cors);
      } catch (err) {
        console.error('[sync] failed', err);
        return json({ error: 'sync failed' }, { status: 500 }, cors);
      }
    }

    // Confirms the token works without moving any data.
    if (url.pathname === '/v1/whoami' && request.method === 'GET') {
      const auth = await authenticate(request, env);
      if (!auth) return json({ error: 'unauthorized' }, { status: 401 }, cors);
      const head = await env.DB
        .prepare(`SELECT last_seq FROM sync_state WHERE user_id = ?`)
        .bind(auth.userId)
        .first<{ last_seq: number }>();
      return json({ userId: auth.userId, cursor: head?.last_seq ?? 0 }, {}, cors);
    }

    return json({ error: 'not found' }, { status: 404 }, cors);
  }
} satisfies ExportedHandler<Env>;
