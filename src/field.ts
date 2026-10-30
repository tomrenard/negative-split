import {
  type Athlete, type Entry, type Input, type Persona,
  ENDURANCE, SURGE, TEMPO, THRESHOLD, hashRace, rand, runRace,
} from './sim.ts'

export const PLAYER: Athlete = { name: 'You', cp: 250, wPrime: 20_000, mass: 80, cda: 0.25, gutGph: 75, glycogen: 450 }

const rival = (name: string, cp: number, wPrime: number, startT: number, persona: Persona): Entry => ({
  athlete: { ...PLAYER, name, cp, wPrime },
  persona,
  startT,
  gels: 3,
  bottles: 2,
})

// Start times stand in for the swim gaps until the swim exists.
export const RIVALS: Entry[] = [
  rival('The Fish', 235, 18_000, 0, { plan: TEMPO, climbGear: THRESHOLD, aggression: 0.6, fuelGph: 50, grabMiss: 0.05 }),
  rival('The Diesel', 245, 16_000, 120, { plan: TEMPO, climbGear: TEMPO, aggression: 0.3, fuelGph: 80, grabMiss: 0 }),
  rival('The Hammer', 255, 26_000, 90, { plan: TEMPO, climbGear: SURGE, aggression: 0.9, fuelGph: 35, grabMiss: 0.1 }),
  rival('The Closer', 240, 18_000, 150, { plan: ENDURANCE, climbGear: TEMPO, aggression: 0.4, fuelGph: 85, grabMiss: 0 }),
  rival('The Rookie', 260, 20_000, 60, { plan: THRESHOLD, climbGear: SURGE, aggression: 0.7, fuelGph: 45, grabMiss: 0.3 }),
]

export const DEFAULT_PLAYER: Entry = { athlete: PLAYER, persona: null, startT: 100, gels: 4, bottles: 2 }

// The player is always rider 0.
export const field = (player: Entry = DEFAULT_PLAYER): Entry[] => [player, ...RIVALS]

// A bigger field: the 5 rival types repeated with seeded CP and start time spread.
export function crowd(player: Entry, size: number, seed: number): Entry[] {
  const s = { rngState: seed }
  const entries = [player]
  for (let i = 1; i < size; i++) {
    const base = RIVALS[(i - 1) % RIVALS.length]
    const cp = base.athlete.cp - 15 + Math.floor(rand(s) * 31)
    entries.push({ ...base, athlete: { ...base.athlete, cp }, startT: Math.floor(rand(s) * 600) })
  }
  return entries
}

// Shared by scripts/check.ts and the browser determinism page.
export const FIXTURE_SEED = 20261030
export const FIXTURE_INPUTS: Input[] = [
  { t: 200, rider: 0, type: 'gear', value: THRESHOLD },
  { t: 900, rider: 0, type: 'lane', value: 1 },
  { t: 1500, rider: 0, type: 'gel' },
  { t: 2400, rider: 0, type: 'gear', value: SURGE },
  { t: 4000, rider: 0, type: 'drink' },
]
export const fixtureHash = (inputs = FIXTURE_INPUTS) =>
  hashRace(
    runRace(
      FIXTURE_SEED,
      field({ ...DEFAULT_PLAYER, persona: { plan: TEMPO, climbGear: THRESHOLD, aggression: 0.5, fuelGph: 70, grabMiss: 0 } }),
      inputs,
    ),
  )
