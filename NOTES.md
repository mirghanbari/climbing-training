# Project notes

A running log for this repo: what exists, the rules that keep it correct, the
mistakes already made so they are not repeated, and a dated entry per working
session.

Read the **Invariants** before changing anything. Most of them exist because
breaking them caused a real bug, not because they sound tidy.

---

## What this is

An 8-week finger strength block for sport climbing, timed to finish well before
a Leonidio trip rather than peaking at departure.

| | |
|---|---|
| App | https://mirghanbari.github.io/climbing-training/ |
| Repo | https://github.com/mirghanbari/climbing-training (**public**) |
| Sync API | `https://climbing-training-sync.mirghanbariconsulting.workers.dev` |
| Hosting | GitHub Pages (static) + Cloudflare Worker & D1 |
| Cost | $0 — all free tiers |

### Layout

| Path | Role |
|---|---|
| `index.html` | Shell: top bar, tabs, five view containers |
| `js/program.js` | The training block as data. Weeks, sessions, devices, rules copy |
| `js/store.js` | State, localStorage, derived loads, sync plumbing |
| `js/sync.js` | Client half of the sync protocol |
| `js/charts.js` | Hand-rolled SVG line chart and bar chart |
| `js/app.js` | Views and rendering |
| `server/src/index.ts` | Worker: `/v1/health`, `/v1/whoami`, `/v1/sync` |
| `server/migrations/` | D1 schema |
| `server/scripts/issue-token.mjs` | Issues a device token, prints it once |

---

## Invariants

**Training model**

1. **Loads are never hard-coded in pounds.** Every exercise is a percentage of a
   tested max for a named device. If there is no test, show "no max" — never
   invent a number.
2. **Weeks 1–4 price off the baseline test; weeks 5–8 off the week-4 retest.**
   This is the whole point of the block structure. Do not let a late test
   retroactively re-price weeks already trained.
3. **Bodyweight moves only the % BW readouts and the targets — never a training
   load.** A ratio improves when you lose weight even if your fingers got
   weaker. Judge blocks by pounds lifted.
4. **Round working loads to 2.5 lb** (what you can actually load). Keep
   benchmark targets exact — they are a reference, not something to put on a pin.
5. The % BW targets are Beastfingers benchmarks. Keep the caveat visible: they
   are a reference, not a validated predictor of redpoint grade.

**Privacy**

6. **The repo is public. No personal data in source, ever.** Bodyweight, maxes
   and trip were originally hardcoded and had to be stripped. The app asks once
   and stores locally.
7. **The device token lives in its own localStorage key** (`climbing-training.sync`)
   and is excluded from JSON exports. Tokens are stored server-side as SHA-256
   hashes only.

**Sync**

8. **localStorage is the source of truth on each device.** The Worker is a
   meeting point. The app must stay fully usable with no signal — it gets used
   in gyms and abroad.
9. **The pull cursor is a monotonic per-user sequence, never a timestamp.** Two
   devices with skewed clocks would otherwise skip or replay changes.
10. **Sessions use the natural key `w<week>d<day>`** so two devices logging the
    same session converge instead of duplicating. Tests and sends use random
    ids — they are genuinely distinct events.
11. **Sync config/status must not flow through the data listener.** The data
    listener schedules a sync; sharing a channel makes every sync trigger the
    next one. See the 2026-09-22 entry.
12. **`applyChanges` only notifies when a record actually landed.** The server
    echoes back what you just pushed.

**UI**

13. **Never re-render a view while a form field has focus.** It steals focus and
    destroys unsaved text. Defer to `focusout`, with a timer backstop so a
    deferred render cannot get stuck.
14. Charts follow the validated palette (`--series-1/2/3`). Run the dataviz
    validator before changing chart colors; do not eyeball CVD safety.
15. Mobile first — it is used one-handed between sets. No horizontal overflow at
    390px.

---

## Errors to avoid

Each of these cost real time already.

**Tooling**

- **`node --check` does not catch syntax errors in ES modules.** It passed a
  missing `)` that broke the page. Use
  `npx esbuild js/app.js --bundle --outfile=/dev/null --format=esm` as the gate.
- **Browsers cache ES modules hard.** Changing only the URL *hash* does not
  reload the page at all. During dev, serve with `Cache-Control: no-store` and
  navigate to a changed query string to force a real reload.
- **Wrangler 4 requires `@cloudflare/workers-types` v5.** Upgrade both together
  or npm throws ERESOLVE.
- **GitHub Pages cannot serve a private repo on a free account.** Public repo or
  pay. This is why the repo is public and why no personal data may live in it.

**Testing in a backgrounded Chrome tab**

- `setTimeout` is throttled to ~1s minimum, so timing measurements are junk.
- **Focus events do not fire at all.** `focus()`/`blur()` move `activeElement`
  but dispatch nothing, so focus behaviour cannot be observed this way. Dispatch
  a synthetic `FocusEvent('focusout')`, or assert the wiring synchronously.
- Two concurrent monkey-patches of `window.fetch` will race and produce
  confident, wrong numbers. Run one measurement at a time.

**Correctness**

- **Do not assume a synced record has every field.** A record missing `date`
  crashed the entire merge via `a.date.localeCompare`. Sorts must be defensive —
  one malformed record should not take down sync.
- **Do not put the training JSON in the public repo.** It was considered as a
  Git-as-database option; it would publish the log. A separate private repo or a
  real backend only.
- Clearing site data wipes a device. Export JSON periodically, or sync.

---

## Before shipping a change

- [ ] `npx esbuild` over every changed module
- [ ] Load the page and look at it — the bundler does not catch layout breakage
- [ ] Console clean on the live origin, not just localhost
- [ ] If sync touched: no-op sync stays silent, no runaway request loop
- [ ] If the repo gained files: nothing personal, nothing secret

---

## Log

### 2026-09-22 — Built the tracker, added sync, fixed a feedback loop

**Context.** Replaced an xlsx workbook with a site. The prior plan came from a
shared chat (bodyweight 148, Grippūl 105 lb, Tension Block 10mm 75 lb, both
tested June 2026 and stale; week percentages 80/85/90/70/85/90/95/85 with a
week-4 retest). Ported rather than reinvented — week 1 computes to 85 lb / 60 lb,
matching the workbook exactly.

**Built.**
- Static PWA on GitHub Pages: Today, Program, Progress, Sends, Setup. Loads
  resolve from tested maxes; grade pyramid and strength-over-time charts.
- Cloudflare Worker + D1 sync. Push-everything / pull-past-cursor, last-write-wins
  on a client `updatedAt`, tombstones for deletes, hashed per-device tokens.
  Every table carries `user_id` so multi-user is an auth change, not a migration.
- Moved off Wrangler 3 (EOL) to 4.

**Decisions.**
- *GitHub Pages over Cloudflare Pages* for the front end — `gh` was already
  authenticated. Then *public repo*, because Pages will not serve a private one
  free. That forced stripping all personal data from source, which was the right
  outcome anyway.
- *Cloudflare Worker over writing JSON to a Git repo.* Both end with a credential
  in the browser, so Git-as-database was not the hack-free option it looked like;
  the deciding factor was that the public repo would expose the log.
- *Push the whole dataset every sync.* A few KB at this scale, and it makes sync
  idempotent instead of dependent on tracking dirty records.

**Bugs found and fixed.**
1. Missing `)` in `app.js` — page rendered blank. `node --check` passed it;
   esbuild caught it. Changed the syntax gate.
2. Personal numbers hardcoded in source with a public repo pending. Stripped;
   app now onboards instead.
3. `applyChanges` crashed on a record without `date`. Sorts made defensive.
4. **The big one:** `setSync()` notified the same listener set as data changes,
   and that listener schedules a sync — so every sync scheduled the next one. The
   app re-synced every ~2.5s forever, re-rendering each time and kicking the user
   out of any focused field. Reported as "clicking a text field kicks me out."
   Fixed by splitting the listener channels, making `applyChanges` notify only on
   real changes, and deferring renders while a field has focus.

**State at end of session.** Worker deployed and verified (401 unauthenticated,
CORS restricted to the Pages origin). D1 wiped of test data — 0 records,
`last_seq` 0, one live iPhone token. Nothing entered yet.

**Open / next.**
- Retest both maxes before Sep 28. June numbers at 155 lb will make the block too easy.
- Enter real data on one device and sync *before* connecting the laptop, so the
  first sync defines a clean starting state.
- The iPhone token was printed into a chat transcript. Low stakes, trivially
  rotatable — reissue and revoke when convenient.
- No rate limiting on the Worker. Add a Cloudflare rule if the URL ever leaks.
- Last-write-wins will silently drop an edit if the same record is changed on two
  devices while one is offline. Near-impossible for one person; not impossible.
