#!/usr/bin/env node
/**
 * Issue a device token.
 *
 *   npm run issue-token -- --label "iPhone"            (production)
 *   npm run issue-token -- --label "laptop" --local    (local dev database)
 *
 * The plaintext token is printed once and never stored — only its SHA-256
 * lands in D1. If you lose it, revoke and issue another.
 */
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const label = flag('label', 'device');
const userLabel = flag('user', 'me');
const local = args.includes('--local');
const expiresDays = Number(flag('expires-days', '0')) || 0;

// A label goes straight into SQL, so keep it to characters that cannot end a
// string literal. Everything else here is generated hex/base64url.
const safe = (s) => String(s).replace(/[^A-Za-z0-9 _.@-]/g, '').slice(0, 64);
const cleanLabel = safe(label);
const cleanUser = safe(userLabel);

const token = `ct_${randomBytes(32).toString('base64url')}`;
const tokenHash = createHash('sha256').update(token).digest('hex');
const tokenId = randomBytes(8).toString('hex');
const userId = createHash('sha256').update(`user:${cleanUser}`).digest('hex').slice(0, 16);
const now = Date.now();
const expiresAt = expiresDays > 0 ? now + expiresDays * 86400000 : null;

const sql = `
INSERT INTO users (id, label, created_at) VALUES ('${userId}', '${cleanUser}', ${now})
  ON CONFLICT(id) DO NOTHING;
INSERT INTO sync_state (user_id, last_seq) VALUES ('${userId}', 0)
  ON CONFLICT(user_id) DO NOTHING;
INSERT INTO auth_tokens (id, user_id, token_hash, label, created_at, expires_at)
  VALUES ('${tokenId}', '${userId}', '${tokenHash}', '${cleanLabel}', ${now}, ${expiresAt ?? 'NULL'});
`.trim();

const wranglerArgs = [
  'wrangler', 'd1', 'execute', 'climbing-training',
  local ? '--local' : '--remote',
  '--command', sql, '--yes'
];

try {
  execFileSync('npx', wranglerArgs, { stdio: ['ignore', 'pipe', 'inherit'] });
} catch (err) {
  console.error('\nCould not write the token to D1.');
  console.error('Check that the database exists and migrations have been applied.');
  process.exit(1);
}

console.log(`
Token issued for user "${cleanUser}" (${userId}), device "${cleanLabel}"${expiresAt ? `, expires in ${expiresDays} days` : ', no expiry'}.

Paste this into the app's Setup tab. It is shown once:

  ${token}

To revoke it later:
  npx wrangler d1 execute climbing-training ${local ? '--local' : '--remote'} \\
    --command "UPDATE auth_tokens SET revoked_at = ${Date.now()} WHERE id = '${tokenId}';"
`);
