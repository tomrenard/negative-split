// Deterministic race simulation (bike leg for now). One tick = 1 s of race time.
// Only + - * /, Math.sqrt/min/max/floor/round/abs/imul here: they give the same bits in every
// JS engine, so a seed plus an input log replays identically. scripts/check.ts enforces this.

export const GEARS = [0.55, 0.68, 0.8, 0.95, 1.25] // fraction of CP
export const GEAR_NAMES = ['Recover', 'Endurance', 'Tempo', 'Threshold', 'Surge']
export const RECOVER = 0
export const ENDURANCE = 1
export const TEMPO = 2
export const THRESHOLD = 3
export const SURGE = 4

export const COURSE_M = 90_000
export const AID_EVERY_M = 15_000
export const ZONE_M = 12
export const ZONE_LIMIT_S = 25
export const PENALTY_S = 300
export const REF_SIGHT_M = 150
export const GEL_G = 25
export const BOTTLE_G = 40
export const MAX_GELS = 6
export const MAX_BOTTLES = 2
export const BONK_G = 45
export const BONK_FRAC = 0.55
export const STOMACH_OK_G = 40 // above this, each gram waiting costs STOMACH_COST of power
export const STOMACH_COST = 0.002
export const DISTRESS_G = 90
export const DISTRESS_S = 120
// Durability: strain = kJ x (P/CP)^4, so hard riding tires you far more than steady riding.
export const STRAIN_FREE_KJ = 500
export const STRAIN_KJ_PER_PCT = 50
const MIN_GAP_M = 1.5
const AID_WINDOW_M = 30
const MAX_DRAFT = 0.3
const RHO = 1.2
const GRAV = 9.81
const CRR = 0.004
const MAX_V = 25 // riders brake above 90 km/h
const REF_SPEED = 20
const REF_RETARGET_S = 300

export type Athlete = {
  name: string
  cp: number // W
  wPrime: number // J
  mass: number // rider + bike, kg
  cda: number
  gutGph: number
  glycogen: number // g
}

// Scripted behaviour for rivals (and for the player in strategy sweeps).
export type Persona = {
  plan: number // gear on flats
  climbGear: number // gear above 4% grade
  aggression: number // 0..1, >= 0.5 passes when in a zone
  fuelGph: number
  grabMiss: number // 0..1 chance to miss an aid station grab
}

export type Entry = { athlete: Athlete; persona: Persona | null; startT: number; gels: number; bottles: number }

export type Rider = {
  id: number
  athlete: Athlete
  persona: Persona | null
  startT: number
  x: number
  lane: number // 0 keep right, 1 passing
  v: number
  gear: number
  power: number
  w: number
  glycogen: number
  stomach: number
  kj: number
  strain: number
  gels: number
  bottles: number
  lastEatT: number
  aidIdx: number
  zoneS: number
  penaltyS: number
  distressS: number
  exhausted: boolean
  penalties: number
  finishT: number
}

export type Input = { t: number; rider: number; type: 'gear' | 'lane' | 'gel' | 'drink' | 'grab'; value?: number }
export type Segment = { start: number; length: number; grade: number }
export type Race = {
  t: number
  rngState: number
  course: Segment[]
  riders: Rider[]
  ref: { x: number; target: number }
}

// mulberry32: integer-only, so identical everywhere.
export function rand(s: { rngState: number }): number {
  let x = (s.rngState = (s.rngState + 0x6d2b79f5) | 0)
  x = Math.imul(x ^ (x >>> 15), x | 1)
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296
}

export function makeCourse(seed: number): Segment[] {
  const s = { rngState: seed }
  const segments: Segment[] = []
  for (let x = 0; x < COURSE_M; ) {
    const length = Math.min(1000 + Math.floor(rand(s) * 4) * 1000, COURSE_M - x)
    // Triangular -5..+5%, mostly near flat: about 750 m of climbing, like a hilly 70.3.
    segments.push({ start: x, length, grade: Math.round((rand(s) + rand(s) - 1) * 10) / 200 })
    x += length
  }
  return segments
}

export function gradeAt(course: Segment[], x: number): number {
  for (const s of course) if (x < s.start + s.length) return s.grade
  return 0
}

// Solve b·v³ + a·v = P with Newton from above the root (f is convex there, so it converges).
// ponytail: small-angle grade, no wind, no inertia. Add wind with the crosswind/disc wheel trade-off.
export function speedFor(power: number, grade: number, mass: number, cda: number): number {
  const a = mass * GRAV * (CRR + grade)
  const b = 0.5 * RHO * cda
  let v = 40
  for (let i = 0; i < 20; i++) v -= (b * v * v * v + a * v - power) / (3 * b * v * v + a)
  return Math.max(0, Math.min(MAX_V, v))
}

export function createRace(seed: number, entries: Entry[]): Race {
  return {
    t: 0,
    rngState: seed ^ 0x9e3779b9,
    course: makeCourse(seed),
    ref: { x: 0, target: 0 },
    riders: entries.map((e, id) => ({
      id,
      athlete: e.athlete,
      persona: e.persona,
      startT: e.startT,
      x: 0,
      lane: 0,
      v: 0,
      gear: e.persona ? e.persona.plan : TEMPO,
      power: 0,
      w: e.athlete.wPrime,
      glycogen: e.athlete.glycogen,
      stomach: 0,
      kj: 0,
      strain: 0,
      gels: e.gels,
      bottles: e.bottles,
      lastEatT: 0,
      aidIdx: 0,
      zoneS: 0,
      penaltyS: 0,
      distressS: 0,
      exhausted: false,
      penalties: 0,
      finishT: -1,
    })),
  }
}

export function onCourse(race: Race, r: Rider): boolean {
  return race.t >= r.startT && r.finishT < 0 && r.penaltyS === 0
}

// Closest rider ahead, in one lane or in any lane (lane = -1).
export function nearestAhead(race: Race, r: Rider, lane: number): Rider | null {
  let best: Rider | null = null
  for (const o of race.riders) {
    if (o === r || !onCourse(race, o) || o.x <= r.x || (lane >= 0 && o.lane !== lane)) continue
    if (!best || o.x < best.x) best = o
  }
  return best
}

export function aidAt(x: number): number {
  const idx = Math.round(x / AID_EVERY_M)
  return idx >= 1 && idx * AID_EVERY_M < COURSE_M && Math.abs(x - idx * AID_EVERY_M) <= AID_WINDOW_M ? idx : 0
}

function eat(race: Race, r: Rider, grams: number) {
  r.stomach += grams
  r.lastEatT = race.t
  if (r.stomach > DISTRESS_G) r.distressS = DISTRESS_S
}

export function applyInput(race: Race, r: Rider, input: Omit<Input, 't' | 'rider'>) {
  const value = input.value ?? 0
  switch (input.type) {
    case 'gear':
      r.gear = Math.max(RECOVER, Math.min(SURGE, value))
      break
    case 'lane':
      r.lane = value ? 1 : 0
      break
    case 'gel':
      if (r.gels > 0) {
        r.gels--
        eat(race, r, GEL_G)
      }
      break
    case 'drink':
      if (r.bottles > 0) {
        r.bottles--
        eat(race, r, BOTTLE_G)
      }
      break
    case 'grab': {
      const idx = aidAt(r.x)
      if (idx <= r.aidIdx) break
      r.aidIdx = idx
      if (value) r.bottles = Math.min(MAX_BOTTLES, r.bottles + 1)
      else r.gels = Math.min(MAX_GELS, r.gels + 1)
    }
  }
}

function decide(race: Race, r: Rider, p: Persona) {
  // Aid stations are checked every tick so a fast rider cannot skip the window.
  const idx = aidAt(r.x)
  if (idx > r.aidIdx) {
    if (rand(race) >= p.grabMiss) applyInput(race, r, { type: 'grab', value: r.gels < 3 ? 0 : 1 })
    else r.aidIdx = idx
  }
  if ((race.t + r.id) % 10 !== 0) return

  const a = r.athlete
  if (race.t - r.lastEatT >= (3600 * GEL_G) / p.fuelGph)
    applyInput(race, r, { type: r.gels > 0 ? 'gel' : 'drink' })

  let gear = gradeAt(race.course, r.x) > 0.04 ? p.climbGear : p.plan
  if (r.w < 0.3 * a.wPrime) gear = Math.min(gear, ENDURANCE)

  const ahead = nearestAhead(race, r, -1)
  if (ahead && ahead.x - r.x < ZONE_M && r.zoneS >= 5) {
    const pass = r.w > (p.aggression >= 0.5 ? 0.3 : 0.7) * a.wPrime
    if (pass && ahead.lane === 0) {
      r.lane = 1
      gear = Math.max(gear, p.aggression > 0.8 ? SURGE : THRESHOLD)
    } else gear = RECOVER // drop back out of the zone
  } else if (r.lane === 1) {
    // Back to the right once the passed rider is clear behind and nobody is close ahead.
    let clear = true
    for (const o of race.riders)
      if (o !== r && onCourse(race, o) && o.lane === 0 && o.x - r.x > -3 && o.x - r.x < ZONE_M) clear = false
    if (clear) r.lane = 0
  }
  r.gear = gear
}

export const fade = (r: Rider) => 1 - (0.01 * Math.max(0, r.strain - STRAIN_FREE_KJ)) / STRAIN_KJ_PER_PCT

function move(race: Race, r: Rider) {
  if (race.t < r.startT || r.finishT >= 0) return
  const a = r.athlete
  const cp = a.cp * fade(r)
  let frac = GEARS[r.exhausted || r.distressS > 0 ? RECOVER : r.gear]
  if (r.glycogen < BONK_G) frac = Math.min(frac, BONK_FRAC)
  if (r.stomach > STOMACH_OK_G) frac *= 1 - STOMACH_COST * (r.stomach - STOMACH_OK_G)
  const p = r.penaltyS > 0 ? 0 : cp * frac
  r.power = p

  // W'bal, Skiba 2 differential model.
  if (p > cp) r.w -= p - cp
  else r.w += ((a.wPrime - r.w) * (cp - p)) / a.wPrime
  if (r.w <= 0) {
    r.w = 0
    r.exhausted = true
  } else if (r.exhausted && r.w > 0.25 * a.wPrime) r.exhausted = false

  // 1 kJ of work burns about 1 kcal (24% efficiency cancels 4.184 kJ/kcal).
  const kj = p / 1000
  r.kj += kj
  const f = p / a.cp
  r.strain += kj * f * f * f * f
  r.glycogen = Math.max(0, r.glycogen - (kj * Math.min(1, 0.2 + (0.75 * p) / a.cp)) / 4)
  const absorbed = Math.min(r.stomach, (a.gutGph / 3600) * (p > 0.75 * a.cp ? 0.7 : 1))
  r.stomach -= absorbed
  r.glycogen += absorbed
  if (r.distressS > 0) r.distressS--

  if (r.penaltyS > 0) {
    r.penaltyS--
    r.v = 0
    return
  }
  const ahead = nearestAhead(race, r, r.lane)
  const gap = ahead ? ahead.x - r.x : ZONE_M
  const draft = gap < ZONE_M ? MAX_DRAFT * (1 - gap / ZONE_M) : 0
  let x = r.x + speedFor(p, gradeAt(race.course, r.x), a.mass, a.cda * (1 - draft))
  if (ahead && x > ahead.x - MIN_GAP_M) x = Math.max(r.x, ahead.x - MIN_GAP_M) // blocked in this lane
  r.v = x - r.x
  r.x = x
  if (r.x >= COURSE_M) {
    r.x = COURSE_M
    r.finishT = race.t
  }
}

function checkZone(race: Race, r: Rider) {
  if (!onCourse(race, r)) {
    r.zoneS = 0
    return
  }
  const ahead = nearestAhead(race, r, -1)
  r.zoneS = ahead && ahead.x - r.x < ZONE_M ? r.zoneS + 1 : 0
  if (r.zoneS > ZONE_LIMIT_S && Math.abs(race.ref.x - r.x) < REF_SIGHT_M) {
    r.penaltyS = PENALTY_S
    r.penalties++
    r.zoneS = 0
    r.lane = 0
  }
}

function moveRef(race: Race) {
  const live = race.riders.filter((r) => onCourse(race, r))
  if (!live.length) return
  if (race.t % REF_RETARGET_S === 0 || !onCourse(race, race.riders[race.ref.target]))
    race.ref.target = live[Math.floor(rand(race) * live.length)].id
  const d = race.riders[race.ref.target].x - race.ref.x
  race.ref.x += Math.max(-REF_SPEED, Math.min(REF_SPEED, d))
}

export function step(race: Race, inputs: Input[] = []) {
  for (const r of race.riders) if (r.persona && onCourse(race, r)) decide(race, r, r.persona)
  for (const i of inputs) applyInput(race, race.riders[i.rider], i)
  // Leaders move first, so a blocked rider sees where the rider ahead is now.
  for (const r of [...race.riders].sort((a, b) => b.x - a.x || a.id - b.id)) move(race, r)
  for (const r of race.riders) checkZone(race, r)
  moveRef(race)
  race.t++
}

export function runRace(seed: number, entries: Entry[], inputs: Input[] = [], maxT = 6 * 3600): Race {
  const race = createRace(seed, entries)
  const sorted = [...inputs].sort((a, b) => a.t - b.t)
  let i = 0
  while (race.t < maxT && race.riders.some((r) => r.finishT < 0)) {
    const now: Input[] = []
    while (i < sorted.length && sorted[i].t === race.t) now.push(sorted[i++])
    step(race, now)
  }
  return race
}

// FNV-1a over the float bits of all state.
export function hashRace(race: Race): string {
  const nums = [race.t, race.rngState, race.ref.x, race.ref.target]
  for (const r of race.riders)
    nums.push(
      r.x, r.lane, r.v, r.gear, r.power, r.w, r.glycogen, r.stomach, r.kj, r.strain, r.gels, r.bottles,
      r.lastEatT, r.aidIdx, r.zoneS, r.penaltyS, r.distressS, r.exhausted ? 1 : 0, r.penalties, r.finishT,
    )
  const view = new DataView(new ArrayBuffer(8))
  let h = 0x811c9dc5
  for (const n of nums) {
    view.setFloat64(0, n)
    for (let b = 0; b < 8; b++) h = Math.imul(h ^ view.getUint8(b), 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const RUN_M = 21_100
const RUN_THRESHOLD_MS = 1000 / 255 // 4:15/km at CP 250 W
const RUNNER_KG = 72

// ponytail: run estimate until the run leg exists (build step 7). Flat course, 80% of threshold pace,
// bike fade carries over, food passes through the gut at 70% capacity, same bonk and stomach rules.
export function estimateRun(r: Rider, fuelGph: number): { t: number; bonked: boolean } {
  const absorb = (r.athlete.gutGph * 0.7) / 3600
  let g = r.glycogen
  let stomach = r.stomach
  let bonked = false
  let x = 0
  let t = 0
  while (x < RUN_M) {
    let frac = g < BONK_G ? BONK_FRAC : 0.8
    if (g < BONK_G) bonked = true
    if (stomach > STOMACH_OK_G) frac *= 1 - STOMACH_COST * (stomach - STOMACH_OK_G)
    const v = RUN_THRESHOLD_MS * (r.athlete.cp / 250) * frac * fade(r)
    const kcal = (RUNNER_KG * v) / 1000 // running costs about 1 kcal/kg/km
    stomach += fuelGph / 3600
    const a = Math.min(stomach, absorb)
    stomach -= a
    g = Math.max(0, g - (kcal * (0.2 + 0.75 * frac)) / 4 + a)
    x += v
    t++
  }
  return { t, bonked }
}
