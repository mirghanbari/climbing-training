# Sync backend

A Cloudflare Worker + D1 database that lets the tracker sync between devices.
The app works without it — localStorage stays the source of truth on each
device, and this is the meeting point between them.

## How syncing works

Each record (a max test, a session, a send, the settings blob) carries a client
`updatedAt`. On sync the client pushes everything it has and asks for anything
with a `server_seq` above its cursor. The server applies a push only when it
beats the stored `updatedAt` — last write wins.

The pull cursor is a **monotonic per-user sequence, not a timestamp**. Two
devices with skewed clocks would otherwise skip or replay each other's changes.

## Setup

```sh
cd server
npm install
npx wrangler login

# create the database, then paste the printed database_id into wrangler.jsonc
npx wrangler d1 create climbing-training

npm run migrate        # apply schema to the remote database
npm run deploy         # deploy the Worker
npm run issue-token -- --label "iPhone"
```

The last command prints a token **once**. Paste it, with the Worker URL, into
the app's Setup tab. Issue one per device.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/v1/health` | Liveness. No auth. |
| `GET`  | `/v1/whoami` | Confirms a token works. Returns the current cursor. |
| `POST` | `/v1/sync` | Push changes, pull everything newer than `cursor`. |

All authenticated requests use `Authorization: Bearer <token>`.

## Security notes

- Tokens are stored as SHA-256 hashes. A database dump does not yield write access.
- `ALLOWED_ORIGINS` in `wrangler.jsonc` restricts which sites may call the API. Update it if you move the front end.
- Tokens can expire (`--expires-days`) and can be revoked without touching the others.
- There is no rate limiting. Add a Cloudflare rate-limiting rule if the URL ever leaks.

## Multi-user later

Every table already carries `user_id`, and the sequence counter is per user. Going
multi-user means replacing token issuance with a real login — the schema and the
sync protocol do not change.

## Local development

```sh
npm run migrate:local
npm run issue-token -- --label "local" --local
npm run dev
```
