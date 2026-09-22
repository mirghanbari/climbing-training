// The 8-week finger strength block. Everything here is data; app.js renders it.
// Loads are never hard-coded in pounds — each exercise names a device and a
// percentage of that device's most recent tested max.

export const DEVICES = {
  grippul: {
    id: 'grippul',
    name: 'Grippūl',
    short: 'Grippūl',
    detail: 'Load-cell pull. Half-crimp, one hand at a time.',
    targetPctBw: 74
  },
  block10: {
    id: 'block10',
    name: 'Tension Block — 10mm',
    short: 'Block 10mm',
    detail: 'Floor lift, half-crimp, one hand at a time.',
    targetPctBw: 55
  },
  overcome28: {
    id: 'overcome28',
    name: 'The Overcome — 28mm',
    short: 'Overcome 28',
    detail: 'Deep edge. Volume work — repeaters and density hangs.',
    targetPctBw: null
  }
};

export const DEVICE_ORDER = ['grippul', 'block10', 'overcome28'];

// Week 4 is a deload that ends in a retest; weeks 5–8 re-price off that retest.
// Week 8 tapers into the test that sets up the trip prep.
export const WEEKS = [
  { n: 1, pct: 80, phase: 'Build',   note: 'Introduce load. Stop every set with something left — this week should feel easy.' },
  { n: 2, pct: 85, phase: 'Build',   note: 'Same movements, more load. Form before pounds.' },
  { n: 3, pct: 90, phase: 'Build',   note: 'Hardest week so far. Expect the last set of each exercise to be a fight.' },
  { n: 4, pct: 70, phase: 'Deload',  note: 'Cut the load, keep the movement. RETEST both maxes at the end of this week — weeks 5–8 are priced off those numbers.', retest: true },
  { n: 5, pct: 85, phase: 'Build',   note: 'Rebuild on fresh numbers. If the retest went up, this week is harder than week 2 was.' },
  { n: 6, pct: 90, phase: 'Build',   note: 'Build. Watch the pain scale, not the ego.' },
  { n: 7, pct: 95, phase: 'Peak',    note: 'Heaviest week of the block. Drop a set before you drop form.' },
  { n: 8, pct: 85, phase: 'Taper',   note: 'Volume falls off a cliff so the test is clean. TEST at the end of the week.', retest: true }
];

// Recruitment work runs above the week percentage — short, maximal intent, tiny volume.
const recruitPct = (pct) => Math.min(100, pct + 10);

export const SESSIONS = [
  {
    id: 'd1',
    day: 1,
    weekday: 'Mon',
    title: 'Max Strength',
    focus: 'Heavy, low volume, fully rested between sets. Fingers first — climbing after, never before.',
    climbing: 'Optional limit bouldering after the finger work. 20–30 min, no pump.',
    blocks: [
      {
        label: 'Warm-up',
        kind: 'warmup',
        items: [
          '5 min pulse raise — easy traverse, skipping, or arm circles until warm.',
          'Finger rolls and open/close for 2 min per hand.',
          'Ramp sets on the Grippūl: 5s at 50%, 5s at 70%, 5s at 85% of today\'s working load. 1 min between.'
        ]
      },
      {
        label: 'A. Grippūl max pulls',
        kind: 'work',
        device: 'grippul',
        pctOfWeek: 1,
        sets: 5,
        holdSec: 8,
        perHand: true,
        restSec: 180,
        cue: 'Half-crimp. Build tension over 2s, hold 8s, release under control. If you cannot hold 8s, the load is wrong.'
      },
      {
        label: 'B. Tension Block — 10mm',
        kind: 'work',
        device: 'block10',
        pctOfWeek: 1,
        sets: 4,
        holdSec: 7,
        perHand: true,
        restSec: 150,
        cue: '10mm punishes sloppy position. Set the half-crimp before the weight leaves the floor.'
      },
      {
        label: 'C. Antagonists',
        kind: 'accessory',
        items: [
          'Push-ups or dips — 3 × 10.',
          'Wrist extensor work (band or light bar) — 2 × 15 per side.',
          'Shoulder external rotation — 2 × 12 per side.'
        ]
      }
    ]
  },
  {
    id: 'd2',
    day: 2,
    weekday: 'Wed',
    title: 'Capacity & Recruitment',
    focus: 'Fingers only. No climbing today — this is the session that lets Monday and Saturday stay hard.',
    climbing: null,
    blocks: [
      {
        label: 'Warm-up',
        kind: 'warmup',
        items: [
          '5 min pulse raise.',
          'Ramp sets on the Grippūl: 5s at 50%, 5s at 70% of today\'s recruitment load.'
        ]
      },
      {
        label: 'A. Recruitment pulls',
        kind: 'work',
        device: 'grippul',
        pctFn: recruitPct,
        sets: 5,
        holdSec: 5,
        perHand: true,
        restSec: 180,
        cue: 'Maximal intent from the first instant — this trains the nervous system, not the tissue. Short, violent, fully rested. Stop the set the moment the crimp softens.'
      },
      {
        label: 'B. Density hangs — Overcome 28mm',
        kind: 'work',
        device: 'overcome28',
        pctLiteral: 50,
        sets: 3,
        holdSec: 30,
        perHand: false,
        restSec: 180,
        cue: 'Long and sub-maximal. This builds tissue tolerance, which is what keeps 8 weeks of heavy work from becoming an injury. Should feel boring, never sharp.'
      },
      {
        label: 'C. Forearm & wrist',
        kind: 'accessory',
        items: [
          'Reverse curls — 3 × 12.',
          'Pronation / supination with a hammer or bar — 2 × 12 per side.',
          'Finger extensions against a band — 2 × 20.'
        ]
      }
    ]
  },
  {
    id: 'd3',
    day: 3,
    weekday: 'Sat',
    title: 'Power Endurance + Board',
    focus: 'The session where strength turns into 5.13. Board first while fresh, edge repeaters after.',
    climbing: 'Kilter / Moon / Tension board. Pick problems 2–3 grades below your limit so you can hold form when pumped.',
    blocks: [
      {
        label: 'Warm-up',
        kind: 'warmup',
        items: [
          'Easy climbing, 15 min, progressively harder.',
          'Two boulders at half your limit grade before the first round.'
        ]
      },
      {
        label: 'A. Board intervals (4 × 4)',
        kind: 'interval',
        cue: 'Four boulders back to back, 4 rounds. Rest 3 min between rounds, no rest between the boulders inside a round. Pick problems you can send tired — this is about holding position with a pump, not sending.',
        items: [
          '4 boulders × 4 rounds.',
          '2–3 grades below limit.',
          '3 min rest between rounds.'
        ]
      },
      {
        label: 'B. Repeaters — Overcome 28mm',
        kind: 'work',
        device: 'overcome28',
        pctLiteral: 58,
        sets: 4,
        repScheme: '7s on / 3s off × 6',
        perHand: false,
        restSec: 180,
        cue: 'Both hands. Six reps is one set. If you cannot finish rep 6 in a good half-crimp, drop the load 10% for the remaining sets.'
      },
      {
        label: 'C. Route volume',
        kind: 'accessory',
        items: [
          'If you have wall time left: 2–4 routes at onsight level, or project attempts.',
          'Log anything you send on the Sends tab — that is the number this whole block is for.'
        ]
      }
    ]
  }
];

export const RULES = [
  {
    title: 'Testing protocol',
    body: [
      'Test on a rested day, not after climbing. Warm up exactly as you would for a Monday session.',
      'Grippūl: ramp 50% → 70% → 85% → 95% of your last max, 5s each, 2 min rest. Then attempt a new max for 5s. Add 5 lb and repeat until you fail to hold 5s in a half-crimp. The last successful hold is your max.',
      'Tension Block 10mm: same ramp, 3s lifts. Break the floor and hold 3s — if it does not leave the ground in 2s, it is not your max, it is a grind.',
      'Test each hand. Record the weaker hand as your max so the block is priced off the hand that will actually fail.',
      'Overcome 28mm: hang or lift to a 10s max. This one only sets volume loads, so approximate is fine.'
    ]
  },
  {
    title: 'Autoregulation — RPE',
    body: [
      'RPE 7 — could have done 2 more seconds. Correct for weeks 1, 2, 4.',
      'RPE 8 — could have done 1 more second. Correct for weeks 3, 5, 6.',
      'RPE 9 — nothing left. Correct for week 7 only.',
      'RPE 10 — failed the hold. Drop 5% and move on. Never chase it.',
      'Two sessions in a row where the prescribed load feels like RPE 10: your max is stale in the wrong direction. Deload a week and retest.'
    ]
  },
  {
    title: 'Pain scale — the hard stop',
    body: [
      '0–2: normal training discomfort, dull, fades within the rest period. Continue.',
      '3–4: noticeable, localised, lingers between sets. Finish the session at 10% less load. Log it.',
      '5+: sharp, in a joint or a pulley, or any pop, click or sudden give. STOP the session. No finger work for 72h. If it is still there, it is an injury, not soreness.',
      'Pain on the A2 pulley or a sensation of the tendon lifting off the bone is never something to train through. That is the injury that ends a season.'
    ]
  },
  {
    title: 'Non-negotiables',
    body: [
      '48 hours minimum between finger sessions. No exceptions, even for a good weather window.',
      'Max lifts go before climbing on the same day, never after. Fatigued fingers recruit badly and injure easily.',
      'Wednesday is finger-only. If you climb on Wednesday, the block stops working.',
      'Judge this block by the pounds in the Log, not by percent of bodyweight. The ratio moves when your weight moves; the pounds only move when you get stronger.'
    ]
  }
];

export const GRADES = [
  '5.10a','5.10b','5.10c','5.10d',
  '5.11a','5.11b','5.11c','5.11d',
  '5.12a','5.12b','5.12c','5.12d',
  '5.13a','5.13b','5.13c','5.13d',
  '5.14a'
];

export const STYLES = ['Redpoint', 'Flash', 'Onsight', 'Toprope', 'Attempt'];

// Resolve an exercise's prescribed percentage for a given week.
export function pctFor(item, week) {
  if (item.pctLiteral != null) return item.pctLiteral;
  if (item.pctFn) return item.pctFn(week.pct);
  if (item.pctOfWeek) return week.pct * item.pctOfWeek;
  return null;
}
