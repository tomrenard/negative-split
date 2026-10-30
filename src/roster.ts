// Pro roster and gear catalogue from data/*.json, turned into sim entries.
import athleteData from '../data/athletes.json' with { type: 'json' }
import gearData from '../data/gear.json' with { type: 'json' }
import { RIVALS } from './field.ts'
import { type Athlete, type Entry, type Persona, rand } from './sim.ts'

export type GearItem = { id: string; slot: string; brand: string; model: string; cdaDelta?: number; massKg?: number; runEconomy?: number }
export type Profile = 'fish' | 'diesel' | 'hammer' | 'closer' | 'rookie'
export type ProAthlete = (typeof athleteData.athletes)[number] & { profile: Profile }

export const ATHLETES = athleteData.athletes as ProAthlete[]
export const GEAR: GearItem[] = gearData.gear
const BIKE_KG = 8

// Pacing style per profile from the rival cast; pros eat more.
const PERSONAS: Record<Profile, Persona> = {
  fish: RIVALS[0].persona!,
  diesel: RIVALS[1].persona!,
  hammer: RIVALS[2].persona!,
  closer: RIVALS[3].persona!,
  rookie: RIVALS[4].persona!,
}

export function toAthlete(p: ProAthlete): Athlete {
  const items = p.gear.map((id) => {
    const g = GEAR.find((x) => x.id === id)
    if (!g) throw new Error(`${p.id}: unknown gear ${id}`)
    return g
  })
  return {
    name: p.name,
    cp: p.cp,
    wPrime: p.wPrime,
    mass: p.riderKg + BIKE_KG + items.reduce((s, g) => s + (g.massKg ?? 0), 0),
    cda: p.cda + items.reduce((s, g) => s + (g.cdaDelta ?? 0), 0),
    gutGph: p.gutGph,
    glycogen: p.sex === 'f' ? 450 : 550,
    runPace: p.runPace,
    runEconomy: items.reduce((e, g) => e * (g.runEconomy ?? 1), 1),
  }
}

// One pro race field (one sex). The player's athlete is rider 0 with no persona.
// Mass swim start: bike start gaps stand in for swim splits, fish out first.
export function proField(playerId: string, seed: number): Entry[] {
  const player = ATHLETES.find((a) => a.id === playerId)
  if (!player) throw new Error(`unknown athlete ${playerId}`)
  const s = { rngState: seed }
  const swimGap = (p: ProAthlete) => Math.floor((p.profile === 'fish' ? 0 : 30) + rand(s) * 90)
  const entry = (p: ProAthlete, persona: Persona | null): Entry => ({
    athlete: toAthlete(p),
    persona: persona && { ...persona, fuelGph: Math.min(p.gutGph, persona.fuelGph + 30) },
    startT: swimGap(p),
    gels: 4,
    bottles: 2,
  })
  return [
    entry(player, null),
    ...ATHLETES.filter((a) => a.sex === player.sex && a !== player).map((a) => entry(a, PERSONAS[a.profile])),
  ]
}
