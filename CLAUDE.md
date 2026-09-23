# Working in this repo

An 8-week finger strength tracker for sport climbing. Static site on GitHub
Pages, plus an optional Cloudflare Worker + D1 sync backend in `server/`.

**Read [NOTES.md](NOTES.md) before changing anything.** It holds the full
invariants, the known pitfalls, and a dated session log. The rules repeated
below are the ones that cause real damage when broken — the rest are there.

---

## Hard rules

**This repo is public. Never put personal data in source.**
Bodyweight, maxes, and trip details were hardcoded once and had to be stripped.
The app asks the user for them and stores them locally. Do not reintroduce them
into any file — including as "example" defaults or test fixtures.

**Never hard-code a training load in pounds.**
Every exercise is a percentage of a tested max for a named device. No test means
display "no max" — never invent a number. Weeks 1–4 price off the baseline test;
weeks 5–8 off the week-4 retest. Bodyweight changes only the % BW readouts and
targets, never a load.

**localStorage is the source of truth on each device.**
The Worker is a meeting point between devices, not the authority. The app must
stay fully usable offline — it is used in gyms and abroad.

**Sync config must not flow through the data listener.**
The data listener schedules a sync. Sharing one channel makes every sync trigger
the next one; this shipped once and re-synced every 2.5s forever while stealing
focus from form fields. `store.js` has two channels: `subscribe` (data) and
`subscribeSync` (config/status). Keep them separate, and keep `applyChanges`
notifying only when a record actually landed.

**Never re-render a view while a form field has focus.**
It steals focus and destroys unsaved text. `app.js` defers to `focusout` with a
timer backstop. Do not bypass `requestRender()`.

**The sync cursor is a monotonic per-user sequence, never a timestamp.**
Clock skew between two devices would otherwise skip or replay changes.

**Do not assume a synced record has every field.**
A record missing `date` once crashed the whole merge. Sorts and readers must be
defensive — one malformed record must not take down sync.

---

## Tooling traps

- **`node --check` does not catch ES module syntax errors.** It passed a missing
  `)` that blanked the page. Use this as the gate:
  ```sh
  npx esbuild js/app.js --bundle --outfile=/dev/null --format=esm
  ```
- **Browsers cache ES modules hard, and changing only the URL hash does not
  reload the page at all.** When testing in a browser, serve with
  `Cache-Control: no-store` and navigate to a changed query string.
- **A backgrounded Chrome tab throttles timers and fires no focus events.**
  Timing measurements there are junk; assert wiring synchronously instead.
- Wrangler 4 requires `@cloudflare/workers-types` v5 — upgrade both together.

---

## Commands

```sh
# syntax gate (run on every changed module)
npx esbuild js/app.js --bundle --outfile=/dev/null --format=esm

# serve the site locally
python3 -m http.server 8000

# backend
cd server
npm run dev                          # local Worker + local D1
npm run migrate                      # apply migrations to remote
npm run deploy
npm run issue-token -- --label "…"   # prints a device token once
```

The user must run `npx wrangler login` themselves — it is an interactive browser
flow. Do not run `issue-token` on their behalf: it prints a live credential into
the transcript. Give them the command instead.

---

## Before finishing

- Run the esbuild gate on every changed module.
- Load the page and look at it — the bundler does not catch layout breakage.
- If sync was touched: confirm a no-op sync stays silent and no request loop.
- If files were added: nothing personal, nothing secret.
- **Add a dated entry to `NOTES.md`** after substantive work: what changed, why,
  bugs found with root causes, and what is still open.
