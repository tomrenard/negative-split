// Rough 2D playable bike leg (build step 4). Measures decisions per minute of play.
import { DEFAULT_PLAYER, crowd } from './field.ts'
import {
  type Input, AID_EVERY_M, BONK_G, BOTTLE_G, COURSE_M, DISTRESS_S, GEAR_NAMES, GEL_G, PENALTY_S, REF_SIGHT_M,
  STOMACH_OK_G, ZONE_LIMIT_S, ZONE_M, aidAt, createRace, estimateRun, gradeAt, hashRace, nearestAhead, onCourse,
  runRace, step,
} from './sim.ts'

const params = new URLSearchParams(location.search)
const SEED = Number(params.get('seed') ?? 20261030)
const TEST_X = Number(params.get('x') ?? 1) // test runs only: multiplies the clock
const FIELD = 100
const FAST = 20 // ticks per real second
const SLOW = 3
const WAITING = 120 // before the player's start
const VIEW_M = 240

const css = getComputedStyle(document.documentElement)
const C = {
  bg: css.getPropertyValue('--bg').trim(),
  ink: css.getPropertyValue('--ink').trim(),
  meta: css.getPropertyValue('--meta').trim(),
  accent: css.getPropertyValue('--accent').trim(),
  danger: '#c8102e',
}
const FONT = "'Barlow Condensed', Helvetica, sans-serif"

const entries = () => crowd(DEFAULT_PLAYER, FIELD, SEED)
const race = createRace(SEED, entries())
const me = race.riders[0]
const log: Input[] = []
let pending: Omit<Input, 't'>[] = []
const history: { x: number; power: number; w: number; glycogen: number }[] = []
const stats = { inputs: 0, zoneEntries: 0, aidWindows: 0, refWarnings: 0, playS: 0, slowS: 0, eatenG: 0, distress: 0, exhausted: 0 }
let bonkKm = -1
let started = false
let paused = false
let done = false
let acc = 0
let last = performance.now()
let toasts: { text: string; until: number; color: string }[] = []

// Elevation profile from the course grades.
const profile: { x: number; h: number }[] = [{ x: 0, h: 0 }]
for (const s of race.course) profile.push({ x: s.start + s.length, h: profile[profile.length - 1].h + s.grade * s.length })
const hMin = Math.min(...profile.map((p) => p.h))
const hMax = Math.max(...profile.map((p) => p.h))

function toast(text: string, color = C.ink) {
  toasts.push({ text, until: performance.now() + 2200, color })
}

function input(type: Input['type'], value?: number) {
  if (!started || done || paused) return
  pending.push({ rider: 0, type, value })
  stats.inputs++
}

// Slow down only when a choice is due: entering a zone, its deadline, an aid station.
const tactical = () =>
  (me.zoneS > 0 && (me.zoneS <= 4 || me.zoneS >= ZONE_LIMIT_S - 7)) ||
  aidAt(me.x) > me.aidIdx ||
  (nextAid() - me.x < 100 && nextAid() - me.x > 0)

const nextAid = () => Math.ceil(me.x / AID_EVERY_M) * AID_EVERY_M

function tick() {
  const before = { gels: me.gels, bottles: me.bottles, penalties: me.penalties, aidIdx: me.aidIdx, exhausted: me.exhausted }
  const now = pending.map((i) => ({ ...i, t: race.t }))
  pending = []
  log.push(...now)
  const inAid = aidAt(me.x) > me.aidIdx
  step(race, now)

  // Feedback and counters.
  for (const i of now) {
    if (i.type === 'gel' && me.gels < before.gels) { stats.eatenG += GEL_G; toast('Gel, 25 g') }
    if (i.type === 'drink' && me.bottles < before.bottles) { stats.eatenG += BOTTLE_G; toast('Bottle, 40 g') }
    if ((i.type === 'gel' && me.gels === before.gels) || (i.type === 'drink' && me.bottles === before.bottles)) toast('Nothing left to eat', C.meta)
    if (i.type === 'grab') toast(me.aidIdx > before.aidIdx ? `Grabbed a ${i.value ? 'bottle' : 'gel'}` : 'No aid station here', C.meta)
  }
  if (me.zoneS === 1) stats.zoneEntries++
  if (!inAid && aidAt(me.x) > me.aidIdx) stats.aidWindows++
  if (me.zoneS === 10 && Math.abs(race.ref.x - me.x) < REF_SIGHT_M * 2) stats.refWarnings++
  if (me.penalties > before.penalties) toast('Draft penalty: 5 min in the box', C.danger)
  if (me.distressS === DISTRESS_S) { stats.distress++; toast('Stomach trouble: easy for 2 min', C.danger) }
  if (me.exhausted && !before.exhausted) { stats.exhausted++; toast('Out of matches', C.danger) }
  if (bonkKm < 0 && me.glycogen < BONK_G) { bonkKm = me.x / 1000; toast('Bonk', C.danger) }
  if (race.t % 30 === 0 && race.t >= me.startT) history.push({ x: me.x, power: me.power, w: me.w / me.athlete.wPrime, glycogen: me.glycogen })
  if (me.finishT >= 0) finish()
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000) * TEST_X
  last = now
  if (started && !paused && !done) {
    const slow = race.t >= me.startT && tactical()
    acc += dt * (race.t < me.startT ? WAITING : slow ? SLOW : FAST)
    if (race.t >= me.startT) {
      stats.playS += dt
      if (slow) stats.slowS += dt
    }
    while (acc >= 1 && !done) {
      acc--
      tick()
    }
  }
  draw()
  requestAnimationFrame(frame)
}

// ---------- drawing ----------
const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
let W = 0
let H = 0
function resize() {
  const dpr = Math.min(2, devicePixelRatio)
  W = innerWidth
  H = innerHeight
  canvas.width = W * dpr
  canvas.height = H * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
addEventListener('resize', resize)
resize()

function text(s: string, x: number, y: number, size = 16, color = C.ink, align: CanvasTextAlign = 'left', weight = 500) {
  ctx.font = `${weight} ${size}px ${FONT}`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.fillText(s, x, y)
}
const hline = (y: number, x0 = 16, x1 = W - 16) => ctx.fillRect(x0, y, x1 - x0, 1)
const clock = (s: number) =>
  `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function draw() {
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)
  const pad = 16
  const wide = W - pad * 2

  // Profile with all riders.
  const pTop = 40
  const pH = Math.max(40, H * 0.12)
  const px = (x: number) => pad + (x / COURSE_M) * wide
  const py = (h: number) => pTop + pH - ((h - hMin) / (hMax - hMin || 1)) * pH
  const elev = (x: number) => {
    for (let i = 1; i < profile.length; i++)
      if (x <= profile[i].x) return profile[i - 1].h + ((profile[i].h - profile[i - 1].h) * (x - profile[i - 1].x)) / (profile[i].x - profile[i - 1].x)
    return profile[profile.length - 1].h
  }
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 1
  ctx.beginPath()
  profile.forEach((p, i) => (i ? ctx.lineTo(px(p.x), py(p.h)) : ctx.moveTo(px(p.x), py(p.h))))
  ctx.stroke()
  for (let a = AID_EVERY_M; a < COURSE_M; a += AID_EVERY_M) text('◆', px(a), pTop + pH + 16, 12, C.meta, 'center')
  ctx.fillStyle = C.meta
  for (const r of race.riders) if (r !== me && onCourse(race, r)) ctx.fillRect(px(r.x) - 1, py(elev(r.x)) - 1, 2, 2)
  text('▼', px(race.ref.x), py(elev(race.ref.x)) - 6, 12, C.ink, 'center')
  ctx.fillStyle = C.accent
  ctx.beginPath()
  ctx.arc(px(me.x), py(elev(me.x)), 5, 0, Math.PI * 2)
  ctx.fill()
  text('NEGATIVE SPLIT', pad, 24, 16, C.ink, 'left', 700)
  const onRoad = race.riders.filter((r) => r !== me && (r.finishT >= 0 || (onCourse(race, r) && r.x > me.x))).length + 1
  text(`${(me.x / 1000).toFixed(1)} / 90 km   ·   ${onRoad} on the road of ${FIELD}   ·   bike ${clock(Math.max(0, race.t - me.startT))}`, W - pad, 24, 16, C.ink, 'right')

  // Road view centred on the player.
  const rTop = pTop + pH + 40
  const rH = Math.max(120, H * 0.36)
  const laneH = rH / 2
  const m = wide / VIEW_M
  const rx = (x: number) => pad + wide * 0.6 + (x - me.x) * m
  const ry = (lane: number) => rTop + (lane ? laneH * 0.5 : laneH * 1.5)
  ctx.fillStyle = C.ink
  hline(rTop)
  hline(rTop + rH)
  ctx.fillStyle = C.meta
  for (let x = Math.floor((me.x - VIEW_M) / 20) * 20; x < me.x + VIEW_M; x += 20) ctx.fillRect(rx(x), rTop + laneH, 6, 1)
  for (let a = AID_EVERY_M; a < COURSE_M; a += AID_EVERY_M)
    if (Math.abs(a - me.x) < VIEW_M) {
      ctx.fillStyle = 'rgba(20,20,20,0.08)'
      ctx.fillRect(rx(a - 30), rTop, 60 * m, rH)
      text(`AID ${a / AID_EVERY_M}`, rx(a), rTop - 8, 14, C.ink, 'center', 700)
    }
  const ahead = nearestAhead(race, me, -1)
  const zoneOf = ahead && ahead.x - me.x < ZONE_M ? ahead : null
  for (const r of race.riders) {
    if (!onCourse(race, r) || Math.abs(r.x - me.x) > VIEW_M) continue
    const y = ry(r.lane)
    ctx.fillStyle = r === zoneOf ? 'rgba(255,90,0,0.18)' : 'rgba(20,20,20,0.05)'
    ctx.fillRect(rx(r.x - ZONE_M), y - laneH * 0.3, ZONE_M * m, laneH * 0.6)
    ctx.fillStyle = r === me ? C.accent : C.ink
    ctx.fillRect(rx(r.x) - 2 * m, y - 5, 2 * m, 10)
  }
  if (Math.abs(race.ref.x - me.x) < VIEW_M) text('REF', rx(race.ref.x), rTop + rH + 18, 14, C.danger, 'center', 700)
  else text(`REF ${race.ref.x > me.x ? '→' : '←'} ${Math.round(Math.abs(race.ref.x - me.x))} m`, race.ref.x > me.x ? W - pad : pad, rTop + rH + 18, 14, C.meta, race.ref.x > me.x ? 'right' : 'left')

  if (me.penaltyS > 0) text(`PENALTY BOX  ${Math.ceil(me.penaltyS / 60)} min`, W / 2, rTop + rH / 2 + 10, 40, C.danger, 'center', 700)
  else if (me.zoneS > 0) {
    const refClose = Math.abs(race.ref.x - me.x) < REF_SIGHT_M * 2
    text(`DRAFT ZONE ${me.zoneS} / ${ZONE_LIMIT_S} s${refClose ? '  ·  REF CLOSE' : ''}`, rx(me.x), ry(me.lane) - laneH * 0.4, 22, refClose ? C.danger : C.accent, 'center', 700)
  }
  const aidAhead = nextAid() - me.x
  if (nextAid() < COURSE_M && aidAt(me.x) > me.aidIdx) text('AID STATION: 1 grab gel · 2 grab bottle', W / 2, rTop + rH + 44, 22, C.accent, 'center', 700)
  else if (nextAid() < COURSE_M && aidAhead < 600 && aidAhead > 0) text(`Aid station in ${Math.round(aidAhead)} m`, W / 2, rTop + rH + 44, 18, C.meta, 'center')

  // HUD.
  const hTop = H - 120
  ctx.fillStyle = C.ink
  hline(hTop)
  const col = wide / 3
  const matches = me.w / me.athlete.wPrime
  text('MATCHES', pad, hTop + 24, 14, C.meta)
  ctx.fillStyle = 'rgba(20,20,20,0.12)'
  ctx.fillRect(pad, hTop + 32, col - 32, 12)
  ctx.fillStyle = matches < 0.3 ? C.danger : C.ink
  ctx.fillRect(pad, hTop + 32, (col - 32) * matches, 12)
  const gut = me.stomach < 10 ? 'empty' : me.stomach < STOMACH_OK_G ? 'settled' : me.stomach < 70 ? 'full' : 'sloshing'
  const legs = me.glycogen < BONK_G ? 'empty' : me.glycogen < 120 ? 'heavy' : me.glycogen < 300 ? 'steady' : 'fresh'
  text(`GUT ${gut}   ·   LEGS ${legs}`, pad, hTop + 72, 20, me.glycogen < 120 || me.stomach >= 70 ? C.danger : C.ink)
  text(`Gels ${me.gels}  ·  Bottles ${me.bottles}`, pad, hTop + 100, 18, C.meta)

  GEAR_NAMES.forEach((g, i) => {
    const forced = me.exhausted || me.distressS > 0
    const x = pad + col + (col / 5) * (i + 0.5)
    const active = i === me.gear
    text(g.toUpperCase(), x, hTop + 48, active ? 22 : 15, active ? (forced ? C.meta : C.accent) : C.meta, 'center', active ? 700 : 500)
  })
  if (me.exhausted || me.distressS > 0) text(me.exhausted ? 'Forced to recover: matches empty' : 'Forced to recover: stomach', pad + col * 1.5, hTop + 84, 16, C.danger, 'center')

  const grade = gradeAt(race.course, me.x)
  text(`${Math.round(me.power)} W`, W - pad, hTop + 44, 32, C.ink, 'right', 700)
  text(`${(me.v * 3.6).toFixed(1)} km/h   ·   ${grade >= 0 ? '+' : ''}${(grade * 100).toFixed(1)}%`, W - pad, hTop + 72, 18, C.ink, 'right')
  const speedLabel = race.t < me.startT ? `Start in ${me.startT - race.t} s` : paused ? 'PAUSED' : tactical() ? `${SLOW}x  slow-mo` : `${FAST}x`
  text(speedLabel, W - pad, hTop + 100, 16, C.meta, 'right')

  const now = performance.now()
  toasts = toasts.filter((t) => t.until > now)
  toasts.forEach((t, i) => text(t.text, W / 2, rTop + rH / 2 - 30 - i * 28, 24, t.color, 'center', 700))
}

// ---------- end of race ----------
function finish() {
  done = true
  const bikeH = (me.finishT - me.startT) / 3600
  const myFuel = Math.min(90, stats.eatenG / bikeH)
  while (race.riders.some((r) => r.finishT < 0) && race.t < 6 * 3600) step(race)
  const totals = race.riders.map((r) => r.finishT - r.startT + estimateRun(r, r === me ? myFuel : (r.persona?.fuelGph ?? 60)).t)
  const run = estimateRun(me, myFuel)
  const place = 1 + totals.filter((t) => t < totals[0]).length
  const replay = hashRace(runRace(SEED, entries(), log)) === hashRace(race)
  const min = stats.playS / 60

  document.getElementById('debrief-title')!.textContent = `${place}th of ${FIELD}`
  const rows: [string, string][] = [
    ['Bike', clock(me.finishT - me.startT)],
    ['Run (estimate)', `${clock(run.t)}${run.bonked ? ', bonked' : ''}`],
    ['Total', clock(totals[0])],
    ['Fuel on the bike', `${Math.round(stats.eatenG / bikeH)} g/h`],
    ['Penalties', String(me.penalties)],
    ['Your inputs', `${(stats.inputs / min).toFixed(1)} per minute (${stats.inputs} in ${min.toFixed(1)} min)`],
    ['Situations', `${((stats.zoneEntries + stats.aidWindows) / min).toFixed(1)} per minute: ${stats.zoneEntries} draft zones, ${stats.aidWindows} aid stations`],
    ['Slow-mo', `${Math.round((stats.slowS / stats.playS) * 100)}% of play time`],
    ['Replay check', replay ? 'input log replays to the same race' : 'MISMATCH'],
  ]
  document.getElementById('debrief-stats')!.innerHTML = rows.map(([k, v]) => `<dt class="label">${k}</dt><dd>${v}</dd>`).join('')

  const notes: string[] = []
  if (bonkKm >= 0) notes.push(`You bonked at km ${bonkKm.toFixed(0)}: you ate ${Math.round(stats.eatenG / bikeH)} g/h, about 60 g/h holds at Tempo.`)
  else if (run.bonked) notes.push(`You bonked on the run: ${Math.round(me.glycogen)} g left at T2 was not enough.`)
  if (stats.distress) notes.push(`Stomach trouble ${stats.distress}x: you ate faster than your gut absorbs (about 50 g/h above Tempo).`)
  if (stats.exhausted) notes.push(`Out of matches ${stats.exhausted}x: each time you were forced to recover.`)
  if (me.penalties) notes.push(`${me.penalties} draft penalty (${PENALTY_S / 60} min each).`)
  if (!notes.length) notes.push('Clean race: no bonk, no stomach trouble, no penalty.')
  document.getElementById('debrief-notes')!.innerHTML = notes.map((n) => `<p>${n}</p>`).join('')
  document.getElementById('debrief')!.hidden = false
  drawChart()
}

function drawChart() {
  const c = document.getElementById('debrief-chart') as HTMLCanvasElement
  const g = c.getContext('2d')!
  const w = c.clientWidth
  const h = c.clientHeight
  c.width = w * 2
  c.height = h * 2
  g.scale(2, 2)
  const series: [string, (p: (typeof history)[0]) => number, string][] = [
    ['power', (p) => p.power / (me.athlete.cp * 1.3), C.ink],
    ['matches', (p) => p.w, C.accent],
    ['fuel', (p) => p.glycogen / me.athlete.glycogen, C.danger],
  ]
  for (const [, f, color] of series) {
    g.strokeStyle = color
    g.lineWidth = 1.5
    g.beginPath()
    history.forEach((p, i) => {
      const x = (p.x / COURSE_M) * w
      const y = h - Math.max(0, Math.min(1, f(p))) * (h - 4) - 2
      i ? g.lineTo(x, y) : g.moveTo(x, y)
    })
    g.stroke()
  }
  g.font = `500 13px ${FONT}`
  series.forEach(([name, , color], i) => {
    g.fillStyle = color
    g.fillText(name, 4 + i * 64, 12)
  })
}

// ---------- input ----------
const keys: Record<string, () => void> = {
  w: () => input('gear', Math.min(4, me.gear + 1)),
  arrowup: () => input('gear', Math.min(4, me.gear + 1)),
  s: () => input('gear', Math.max(0, me.gear - 1)),
  arrowdown: () => input('gear', Math.max(0, me.gear - 1)),
  a: () => input('lane', 1),
  arrowleft: () => input('lane', 1),
  d: () => input('lane', 0),
  arrowright: () => input('lane', 0),
  e: () => input('gel'),
  q: () => input('drink'),
  '1': () => input('grab', 0),
  '2': () => input('grab', 1),
  p: () => started && !done && (paused = !paused),
  escape: () => started && !done && (paused = !paused),
}
addEventListener('keydown', (e) => {
  const k = keys[e.key.toLowerCase()]
  if (!k || e.repeat) return
  e.preventDefault()
  k()
})

let touch: { x: number; y: number } | null = null
canvas.addEventListener('pointerdown', (e) => (touch = { x: e.clientX, y: e.clientY }))
canvas.addEventListener('pointerup', (e) => {
  if (!touch) return
  const dx = e.clientX - touch.x
  const dy = e.clientY - touch.y
  touch = null
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return
  if (Math.abs(dy) > Math.abs(dx)) (dy < 0 ? keys.w : keys.s)()
  else (dx < 0 ? keys.a : keys.d)()
})
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-input]'))
  b.addEventListener('click', () => {
    const t = b.dataset.input
    if (t === 'gel') input('gel')
    else if (t === 'drink') input('drink')
    else input('grab', t === 'grab-bottle' ? 1 : 0)
  })

document.getElementById('start')!.addEventListener('click', () => {
  document.getElementById('intro')!.hidden = true
  started = true
})
document.getElementById('again')!.addEventListener('click', () => location.reload())

// Debug hooks for automated play tests.
Object.assign(window, { __ns: { race, me, stats, log } })

requestAnimationFrame(frame)
