# Finger Strength Block

An 8-week finger strength tracker for sport climbing, built as a static site. No
build step, no server, no account — open it, enter your numbers, train.

It replaces a spreadsheet with something usable one-handed on a phone between
sets.

## The idea

Every prescribed load is a **percentage of a tested max**, never a fixed number.
Enter a max, and all 24 sessions price themselves. Retest, and they re-price.

Week percentages run:

| Week | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| % of max | 80 | 85 | 90 | 70 | 85 | 90 | 95 | 85 |
| Phase | Build | Build | Build | **Deload + retest** | Build | Build | Peak | **Taper + test** |

Weeks 1–4 run off the baseline test. Week 4 ends in a retest, and weeks 5–8
recalculate off that — so the second half of the block is never built on
month-old numbers.

## The week

Three sessions, minimum 48 hours apart.

- **Mon — Max Strength.** Heavy Grippūl pulls and 10mm block lifts, fully rested. Climbing after, never before.
- **Wed — Capacity & Recruitment.** Fingers only. Short max-intent pulls plus long sub-maximal density hangs.
- **Sat — Power Endurance + Board.** 4×4 board intervals, then edge repeaters.

Supported devices: Grippūl, Tension Block (10mm), The Overcome (28mm). Each
carries its own tested max.

## Tracking

- **Today** — the next unlogged session, with loads resolved.
- **Program** — all 8 weeks, any week browsable.
- **Progress** — max tests, a strength-over-time chart in lb or % bodyweight, session history.
- **Sends** — route log and a grade pyramid. The finger numbers are the means; this is the end.
- **Setup** — bodyweight, dates, targets, the testing protocol, RPE and pain rules, export/import.

## Your data

Everything is stored in your browser's `localStorage` on the device you use.
Nothing is uploaded, and there is no backend — this repo is only the app. Two
consequences worth knowing:

- Clearing site data wipes your log. **Export JSON from the Setup tab now and then.**
- Data does not sync between your phone and your laptop. Export and import to move it.

## Running it

It is plain HTML, CSS and ES modules. Any static server works:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. On a phone, use the browser's "Add to Home
Screen" to get it as a standalone app.

## A caveat on the targets

The default % bodyweight targets (74% Grippūl, 55% on a 10mm edge) come from the
Beastfingers calculator. They are a reasonable reference, not a validated
predictor of redpoint grade — and because they are ratios, they improve when you
lose weight even if your fingers got weaker. Judge a block by the pounds in the
log. They are editable on the Setup tab.

Not medical advice. The pain scale on the Setup tab has a hard stop for a
reason: finger injuries end seasons.
