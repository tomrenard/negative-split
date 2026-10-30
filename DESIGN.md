# Negative Split: design

A browser triathlon game about strategy. You are the athlete's brain, not their legs. You win by spending energy and food at the right time.

## Format

- Simulated race: 70.3 (1.9 km swim, 90 km bike, 21.1 km run).
- Time compression: about 20x. One race takes about 14 min.
- Rules: age group, no drafting on the bike.
- Platforms: desktop and mobile (landscape only).

## Athlete model

The player and the AI use the same model. All numbers are starting values for tuning.

| Stat | Example | Effect |
|---|---|---|
| CP (threshold) | 250 W, 4:15/km, 1:35/100 m | Effort above CP drains matches. |
| Matches (W') | 20 kJ | Skiba W'bal. Drains at (P - CP). Refills faster the further below CP you go. |
| Glycogen | 450 g | Carb burn = kJ/h x carb fraction / 4. About 90 g/h at 65% CP, about 200 g/h at CP. |
| Gut capacity | 75 g/h | Absorption is slower at high effort. Run multiplier: 0.7. Food arrives after about 15 min. |
| Durability | -1% CP per 500 kJ above a set point | Late race fade. |

Failure states:

- Bonk (glycogen below 10%): effort capped at 55% CP until carbs arrive.
- GI distress (gut queue above capacity): forced easy pace for 2 min (game time).
- Matches empty: forced recovery pace until W' refills.

Information shown to the player:

- Matches: exact bar.
- Fuel and gut: blurred. Shown as words, icons and body tells ("heavy legs").
- The post-race debrief shows the true curves (see Risks).

Heat is a course modifier, not a gauge. It only matters on hot courses.

## Controls

| Action | Desktop | Mobile |
|---|---|---|
| Effort gear (Recover, Endurance, Tempo, Threshold, Surge) | W / S | Swipe up / down |
| Lane change | A / D | Swipe left / right |
| Gel | E | Thumb button |
| Drink | Q | Thumb button |
| Aid station grab | Timing prompt | Hold |
| Sight (swim) | Space | Tap |

Auto slow-mo: compression drops to 2x or 3x at tactical moments (pass, aid station, rival attack, referee near).

## Legs

### Swim (about 2 min of play)

- Rolling start. You pick front, middle or back.
- Drafting: feet saves about 15%, hip about 8%.
- Sighting: skip it and you drift off line. Too often and you lose rhythm.
- Buoy turns: inside line is short with contact events. Outside line is clean and long.
- Wetsuit: legal below 24.5 C. Warm water plus hard effort causes overheating.

### T1 and T2 (a few seconds each)

- 3-key prompt sequence.
- Optional flying mount or dismount: saves about 5 s, a fumble costs about 10 s.
- T2 is a fuel window: a gel here has no gut penalty.

### Bike

- Draft zone: 12 m behind each rider.
- Entering a zone starts a 25 s timer. Complete the pass or drop back.
- When a rider passes you, you must drop out of their zone.
- A referee moto patrols and shows on the minimap. A zone breach near the referee gives a penalty box stop.
- Terrain changes the cost of a pass: cheap distance but high matches on a climb, almost free on a descent.
- Crosswind pushes riders with deep wheels.
- Aid stations: grab a bottle or gel. A miss means no food.

### Run (about 5 min of play)

- Aid stations every 1.6 km: water, gel, cola (fast sugar, small boost, heavy on the gut), ice or sponge (lowers core temperature).
- Shoulder running: within 2 m of a rival, cost is about 3% lower. The rival can surge to drop you.
- Last 2 km: Surge has no cap. Spend all remaining matches.
- Gut absorption is low on the run, so bike fueling decides the run.

## Rivals

Each rival uses the athlete model plus three traits: race plan (effort per leg), aggression (response to a pass), fuel discipline. The AI picks a gear every few seconds with simple scored rules.

Tells:

- Heavy breathing: matches below 30%.
- Form breaks down: low fuel.
- Head down: at threshold.

| Rival | Style | How to beat them |
|---|---|---|
| The Fish | Leads out of the water, fades on the run | Let them go, catch them on the run |
| The Diesel | Even pace, never surges, never bonks | Pace better |
| The Hammer | Attacks every climb, fuels badly | Do not follow, they bonk at km 60 to 70 |
| The Closer | Slow start, strong run | Build a big bike gap |
| The Rookie | Strong numbers, bad choices, improves over the season | Changes over time |
| The Nemesis | Copies your profile, counters your last race tactic | Shown in a pre-race quote, so it reads as story, not as a cheat |

## Pre-race

- Race plan: target effort per leg.
- Nutrition loadout: gels and bottles. Weight and carry slots limit them.
- Kit, each with a trade-off: disc wheel (fast, bad in crosswind), aero helmet (fast, hotter), carbon-plate shoes (fast, more leg damage).
- Course preview: climbs, wind, aid stations.

## Season (light)

- 6 races, then Worlds. Age group placing gives qualifying points.
- Between races: pick one training focus (CP, W', durability, gut +10 g/h, swim technique).
- Prize money buys kit.
- Later: load points, fatigue, taper.

## Online

The simulation is deterministic, so a race is a seed plus an input log.

- Daily race: same seed and course for all players. The server replays the input logs to check leaderboard scores.
- Ghosts: race your best run or a friend's run.
- Replays share as a URL.

## Look and feel

- Style: stylized TV broadcast.
- First course: alpine lake. Dawn swim, climbs and descents on the bike, lakeside run.
- Light follows the race clock: 7:00 golden hour, crisp mid-morning, harsh midday.
- Athletes: stylized, no faces, bold trisuit colors. Procedural swim, pedal and run animation that scales with effort. Form breaks down with low fuel.
- Water: wave shader, foam trails, instanced splashes.
- Post: ACES tone mapping, soft bloom, vignette, depth of field on heli and finish shots, speed lines on descents.
- Camera: moto cam by default, heli on climbs, slow-mo finish chute.
- Audio: breathing gets heavier as matches drain.
- Brand: Barlow Condensed, off-white and ink base, safety orange for the player, muted colors for rivals.

### HUD

```
┌────────────────────────────────────────────────────────────┐
│ 1 ROSSI     .      │                       ▲ ref  ◆ aid    │
│ 2 YOU     +0:42    │      [ 3D scene ]     ╱╲__╱╲___ profile│
│ 3 KANE    +1:10 ↓  │                       ●you  ○rivals   │
│                                                            │
│  MATCHES ▓▓▓▓▓▓░░░    ◀ Endurance [TEMPO] Threshold ▶      │
│  GUT ◐  LEGS: "heavy"         238 W · 36.4 km/h            │
└────────────────────────────────────────────────────────────┘
```

HTML and CSS overlay. The draft zone timer is a ring on the 3D rider, shown only when active.

## Tech

- Vite, TypeScript, vanilla Three.js, pmndrs `postprocessing`.
- Simulation: plain TypeScript, fixed time step, deterministic, no dependency on the renderer. It runs in Node.
- Performance budget: 60 fps on an M1, under 150 draw calls, instanced athletes and crowd, spline road, heightfield terrain, KTX2 textures.
- Graphics tiers from a short GPU benchmark. Mobile: DPR max 1.5, half resolution bloom, no depth of field, baked shadows, optional 30 fps cap.

## Risks

| # | Risk | Test |
|---|---|---|
| 1 | Strategy turns into waiting at 20x. | Headless sim plus a rough 2D view. Count real decisions per minute (target: 3 or more). |
| 2 | A fixed strategy beats clever play. | Run thousands of scripted strategies headless. Tune numbers until adaptive play wins. |
| 3 | Blurred fuel feels random. | Post-race debrief with power, matches and true fuel curves, plus notes ("bonked at km 14: 40 g/h short on the bike"). A playtester must explain their own bonk. |
| 4 | Replays differ across browsers (`Math.exp`, `Math.sin`). | Run one seed in Chrome, Safari, Firefox and Node. Compare a state hash. No built-in transcendental math in the sim. Integer time steps. |
| 5 | Mobile cannot hold the look. | Target scene with placeholder meshes on a real mid-range Android before any art. |
| 6 | Bike overtaking is hard to read. | Slow-mo on zone entry, ring timer, playtest with a non-triathlete. |
| 7 | Swim and run are weaker than the bike. | Keep the swim short. In the strategy sweep, check that bike fueling changes the run result. |
| 8 | The Nemesis feels like cheating. | Pre-race quote that names the counter. |
| 9 | Art scope takes over. | One course, fixed art budget, procedural where possible. No second course before v1 is fun. |

## Build order

1. Simulation with one check script (athlete model, gears, fueling, draft rules, rivals).
2. Determinism check across browsers and Node (risk 4).
3. Strategy sweep (risk 2).
4. Rough 2D playable bike leg. Count decisions per minute (risk 1).
5. Mobile performance test with placeholder meshes (risk 5).
6. 3D bike slice.
7. Run, swim, transitions.
8. Season, daily race, ghosts.

## Open topics

- Onboarding: how a non-triathlete learns matches, fueling and the draft rule.
- Difficulty: rival strength, assists, bonk harshness.
- Feel and moments: camera cuts, sound, the finish.
- Milestones: scope of v0.1, v0.5 and v1.
- Name: check trademarks and domains.
