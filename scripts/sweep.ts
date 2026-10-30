// Run: pnpm sweep. Races a grid of fixed player strategies against a crowd over several seeds,
// to find dominant strategies (design risk 2) and count draft-zone events (risk 1).
import { DEFAULT_PLAYER, crowd } from '../src/field.ts'
import {
  type Persona, ENDURANCE, GEAR_NAMES, SURGE, TEMPO, THRESHOLD, createRace, estimateRun, step,
} from '../src/sim.ts'

const SEEDS = [11, 22, 33, 44, 55, 66]
const FIELD_SIZE = Number(process.argv[2] ?? 100)
type Row = { name: string; places: number[]; totals: number[]; bonks: number; penalties: number; zoneEntries: number }
const strategies: Persona[] = []
for (const plan of [ENDURANCE, TEMPO, THRESHOLD])
  for (let climbGear = plan; climbGear <= SURGE; climbGear++)
    for (const fuelGph of [30, 45, 60, 75, 90])
      for (const aggression of [0.3, 0.9]) strategies.push({ plan, climbGear, aggression, fuelGph, grabMiss: 0 })

const short = (g: number) => GEAR_NAMES[g].slice(0, 5)
const rows: Row[] = strategies.map((s) => ({
  name: `${short(s.plan)}/${short(s.climbGear)} ${s.fuelGph}g/h ${s.aggression > 0.5 ? 'aggr' : 'calm'}`,
  places: [],
  totals: [],
  bonks: 0,
  penalties: 0,
  zoneEntries: 0,
}))

const started = performance.now()
let hours = 0
for (const seed of SEEDS)
  strategies.forEach((persona, i) => {
    const race = createRace(seed, crowd({ ...DEFAULT_PLAYER, persona }, FIELD_SIZE, seed))
    const me = race.riders[0]
    let inZone = false
    while (race.riders.some((r) => r.finishT < 0) && race.t < 6 * 3600) {
      step(race)
      if (me.zoneS === 1 && !inZone) rows[i].zoneEntries++
      inZone = me.zoneS > 0
    }
    const totals = race.riders.map((r) => {
      const run = estimateRun(r, (r.persona as Persona).fuelGph)
      if (r === me && run.bonked) rows[i].bonks++
      return r.finishT - r.startT + run.t
    })
    rows[i].totals.push(totals[0])
    rows[i].places.push(1 + totals.filter((t) => t < totals[0]).length)
    rows[i].penalties += me.penalties
    hours += (me.finishT - me.startT) / 3600
  })

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const hms = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
const table = (rs: Row[]) =>
  console.table(
    rs.map((r) => ({
      strategy: r.name,
      'mean place': mean(r.places).toFixed(1),
      'mean total': hms(Math.round(mean(r.totals))),
      'run bonks': `${r.bonks}/${SEEDS.length}`,
      penalties: r.penalties,
    })),
  )

const ranked = [...rows].sort((a, b) => mean(a.places) - mean(b.places))
console.log(`\n${strategies.length} strategies x ${SEEDS.length} seeds, field ${FIELD_SIZE}, ${((performance.now() - started) / 1000).toFixed(1)} s\n\nTop 10`)
table(ranked.slice(0, 10))
console.log('Bottom 5')
table(ranked.slice(-5))

// Mean place per value of one strategy dimension.
const marginal = (label: string, key: (s: Persona) => string) => {
  const groups = new Map<string, number[]>()
  strategies.forEach((s, i) => groups.set(key(s), [...(groups.get(key(s)) ?? []), ...rows[i].places]))
  console.log(`${label}: ${[...groups].map(([k, v]) => `${k} ${mean(v).toFixed(1)}`).join(' | ')}`)
}
marginal('Flat gear', (s) => GEAR_NAMES[s.plan])
marginal('Climb gear', (s) => GEAR_NAMES[s.climbGear])
marginal('Fuel', (s) => `${s.fuelGph} g/h`)
marginal('Aggression', (s) => (s.aggression > 0.5 ? 'aggr' : 'calm'))

// Same winner on every seed means a dominant strategy.
const winners = SEEDS.map((_, k) => rows.reduce((best, r) => (r.totals[k] < best.totals[k] ? r : best)).name)
console.log(`\nBest strategy per seed: ${winners.join(' | ')}`)
const entries = rows.reduce((a, r) => a + r.zoneEntries, 0)
const pens = rows.reduce((a, r) => a + r.penalties, 0)
// One bike hour is 3 min of play at 20x.
console.log(`Player draft-zone entries: ${(entries / hours).toFixed(1)} per bike hour (${(entries / hours / 3).toFixed(1)} per minute of play at 20x), penalties ${pens} in ${rows.length * SEEDS.length} races`)
