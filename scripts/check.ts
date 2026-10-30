// Run: pnpm check. Fails loudly if a sim rule breaks.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_PLAYER, FIXTURE_INPUTS, PLAYER, field, fixtureHash } from '../src/field.ts'
import {
  type Entry, AGE_GROUP, BONK_FRAC, BONK_G, GEAR_NAMES, RECOVER, SURGE, TEMPO,
  createRace, runRace, speedFor, step,
} from '../src/sim.ts'

const kmh = (v: number) => v * 3.6
const solo = (over: Partial<Entry> = {}): Entry => ({ ...DEFAULT_PLAYER, startT: 0, ...over })

// Physics
assert.ok(kmh(speedFor(200, 0, 80, 0.25)) > 36 && kmh(speedFor(200, 0, 80, 0.25)) < 41, 'flat 200 W')
assert.ok(kmh(speedFor(250, 0.06, 80, 0.25)) < 18, '6% climb')
assert.ok(kmh(speedFor(150, -0.06, 80, 0.25)) > 55, '6% descent')
assert.equal(speedFor(400, -0.2, 80, 0.25), 25, 'speed cap')

// W': Surge drains it, then the rider is forced to Recover and refills.
{
  const race = createRace(1, [solo()])
  const r = race.riders[0]
  r.gear = SURGE
  let exhaustedAt = -1
  for (let t = 0; t < 600 && exhaustedAt < 0; t++) {
    step(race)
    if (r.exhausted) exhaustedAt = race.t
  }
  assert.ok(exhaustedAt > 250 && exhaustedAt < 400, `W' empty after ~320 s at Surge, got ${exhaustedAt}`)
  step(race)
  assert.ok(r.power <= PLAYER.cp * 0.56, 'forced to Recover when empty')
  r.gear = RECOVER
  for (let t = 0; t < 120; t++) step(race)
  assert.ok(!r.exhausted && r.w > 0.25 * PLAYER.wPrime, 'W\' refills')
}

// Bonk: low glycogen caps power.
{
  const race = createRace(1, [solo({ athlete: { ...PLAYER, glycogen: 100 }, gels: 0, bottles: 0 })])
  const r = race.riders[0]
  r.gear = TEMPO
  for (let t = 0; t < 3600 && r.glycogen >= BONK_G; t++) step(race)
  step(race)
  assert.ok(r.glycogen < BONK_G && r.power <= PLAYER.cp * BONK_FRAC + 1e-9, 'bonk caps power')
}

// Gut: 4 gels at once is GI distress, 1 gel is fine.
{
  const one = runRace(1, [solo()], [{ t: 10, rider: 0, type: 'gel' }], AGE_GROUP, 20).riders[0]
  assert.equal(one.distressS, 0, 'one gel is fine')
  const four = runRace(1, [solo()], [0, 1, 2, 3].map(() => ({ t: 10, rider: 0, type: 'gel' as const })), AGE_GROUP, 20).riders[0]
  assert.ok(four.distressS > 0 && four.power <= PLAYER.cp * 0.56, 'four gels cause distress')
  const two = runRace(1, [solo()], [0, 1].map(() => ({ t: 10, rider: 0, type: 'gel' as const })), AGE_GROUP, 20).riders[0]
  assert.ok(two.distressS === 0 && two.power < PLAYER.cp * 0.8, 'a full stomach costs power')
}

// Draft zone: a rider stuck behind a slow rider gets a penalty near the referee, none when the referee is far.
const stuck = (refFar: boolean) => {
  const race = createRace(1, [solo({ startT: 0 }), solo({ startT: 3 })])
  race.riders[0].gear = RECOVER
  race.riders[1].gear = TEMPO
  for (let t = 0; t < 120; t++) {
    if (refFar) race.ref.x = -1e6
    step(race)
  }
  return race.riders[1].penalties
}
assert.ok(stuck(false) >= 1, 'penalty when the referee sees it')
assert.equal(stuck(true), 0, 'no penalty when the referee is far')

// Full bike leg with the cast.
{
  const race = runRace(7, field({ ...DEFAULT_PLAYER, persona: { plan: TEMPO, climbGear: TEMPO, aggression: 0.5, fuelGph: 70, grabMiss: 0 } }))
  const results = [...race.riders].sort((a, b) => a.finishT - b.finishT)
  for (const r of race.riders) assert.ok(r.finishT > 2 * 3600 && r.finishT < 3.5 * 3600, `${r.athlete.name} time ${r.finishT}`)
  const startOrder = [...race.riders].sort((a, b) => a.startT - b.startT).map((r) => r.id).join()
  assert.notEqual(results.map((r) => r.id).join(), startOrder, 'someone overtook')
  const hms = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  console.table(
    results.map((r) => ({
      name: r.athlete.name,
      bike: hms(r.finishT - r.startT),
      gear: GEAR_NAMES[r.gear],
      'glycogen g': Math.round(r.glycogen),
      kJ: Math.round(r.kj),
      penalties: r.penalties,
    })),
  )
}

// Determinism.
assert.equal(fixtureHash(), fixtureHash(), 'same seed and inputs, same hash')
assert.notEqual(fixtureHash(), fixtureHash([...FIXTURE_INPUTS, { t: 5000, rider: 0, type: 'gel' }]), 'one more input changes the hash')

// Engine-dependent math is banned in the sim.
const banned = readFileSync(new URL('../src/sim.ts', import.meta.url), 'utf8').match(
  /Math\.(exp|expm1|pow|sin|cos|tan|atan2?|log\w*|cbrt|hypot|random)\b|\*\*|Date\b/g,
)
assert.equal(banned, null, `banned in sim.ts: ${banned}`)

console.log(`ok, fixture hash ${fixtureHash()}`)

// Pro field: roster loads, gear applies, the 70.3 bike leg lands in a pro time range.
{
  const { ATHLETES, proField, toAthlete } = await import('../src/roster.ts')
  const { PRO } = await import('../src/sim.ts')
  for (const a of ATHLETES) toAthlete(a) // throws on unknown gear
  const base = ATHLETES[0]
  assert.ok(toAthlete(base).cda < base.cda, 'aero gear lowers CdA')
  const race = runRace(7, proField(base.id, 7), [], PRO)
  for (const r of race.riders)
    assert.ok(r.finishT - r.startT > 1.8 * 3600 && r.finishT - r.startT < 2.6 * 3600, `${r.athlete.name} pro bike ${r.finishT - r.startT}`)
  const best = Math.min(...race.riders.map((r) => r.finishT - r.startT))
  console.log(`pro field ${race.riders.length}, fastest bike ${(best / 3600).toFixed(2)} h, penalties ${race.riders.reduce((n, r) => n + r.penalties, 0)}`)
}
