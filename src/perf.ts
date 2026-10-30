// Build step 5: the target 3D scene with placeholder meshes, benchmarked per quality tier.
// Open perf.html on a real phone; results are posted to the dev server (perf-results.jsonl).
// ?tier=low|medium|high skips the benchmark and just shows that tier.
import * as THREE from 'three'
import {
  BloomEffect, DepthOfFieldEffect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode,
  VignetteEffect,
} from 'postprocessing'

type Tier = { name: string; dpr: number; shadowMap: number; bloomScale: number; dof: boolean; msaa: number }
// Design budget: mobile gets DPR max 1.5, half-resolution bloom, no depth of field.
const TIERS: Tier[] = [
  { name: 'high', dpr: 2, shadowMap: 2048, bloomScale: 1, dof: true, msaa: 4 },
  { name: 'medium', dpr: 1.5, shadowMap: 1024, bloomScale: 0.5, dof: false, msaa: 0 },
  { name: 'low', dpr: 1, shadowMap: 0, bloomScale: 0.5, dof: false, msaa: 0 },
]
const RIDERS = 100
const TREES = 3000
const CROWD = 2000
const WARMUP_MS = 1000
const MEASURE_MS = 5000

// ---------- world ----------
const LAKE = new THREE.Vector2(-500, -300)
function heightAt(x: number, z: number) {
  const hills = 18 * Math.sin(x * 0.004) * Math.cos(z * 0.005) + 6 * Math.sin(x * 0.013 + z * 0.011) + 2 * Math.sin(z * 0.04)
  const d2 = (x - LAKE.x) ** 2 + (z - LAKE.y) ** 2
  return hills - 40 * Math.exp(-d2 / 200_000) + 10
}

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false })
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.prepend(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#f2d9b8')
scene.fog = new THREE.Fog('#f2d9b8', 300, 1400)
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 2000)

scene.add(new THREE.HemisphereLight('#fff4e0', '#5a6a4a', 1.2))
const sun = new THREE.DirectionalLight('#ffd1a1', 2.5)
sun.shadow.camera.left = sun.shadow.camera.bottom = -60
sun.shadow.camera.right = sun.shadow.camera.top = 60
sun.shadow.camera.far = 400
scene.add(sun, sun.target)

// Terrain: one heightfield mesh.
const terrainGeo = new THREE.PlaneGeometry(2400, 2400, 256, 256).rotateX(-Math.PI / 2)
const pos = terrainGeo.attributes.position
for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)))
terrainGeo.computeVertexNormals()
const terrain = new THREE.Mesh(terrainGeo, new THREE.MeshStandardMaterial({ color: '#8fa36b', roughness: 1 }))
terrain.receiveShadow = true
scene.add(terrain)

// Road: a ribbon along a winding curve.
const curve = new THREE.CatmullRomCurve3(
  Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2
    const x = Math.cos(a) * 650 + Math.sin(a * 3) * 120
    const z = Math.sin(a) * 520 + Math.cos(a * 2) * 90
    return new THREE.Vector3(x, 0, z)
  }),
  true,
)
const SAMPLES = 4000
const roadPts = curve.getSpacedPoints(SAMPLES)
const roadDir: THREE.Vector3[] = []
for (let i = 0; i < SAMPLES; i++) {
  const p = roadPts[i]
  p.y = heightAt(p.x, p.z) + 0.25
  roadDir.push(new THREE.Vector3())
}
for (let i = 0; i < SAMPLES; i++) roadDir[i].subVectors(roadPts[(i + 1) % SAMPLES], roadPts[i]).normalize()
{
  const verts: number[] = []
  const idx: number[] = []
  for (let i = 0; i < SAMPLES; i++) {
    const side = new THREE.Vector3(-roadDir[i].z, 0, roadDir[i].x).multiplyScalar(4)
    const p = roadPts[i]
    verts.push(p.x + side.x, p.y, p.z + side.z, p.x - side.x, p.y, p.z - side.z)
    const a = i * 2
    const b = ((i + 1) % SAMPLES) * 2
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  const road = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#3b3b3e', roughness: 0.9, side: THREE.DoubleSide }))
  road.receiveShadow = true
  scene.add(road)
}

// Lake: Gerstner-style vertex waves plus fresnel and sun glint.
const water = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uSun: { value: new THREE.Vector3() } },
  vertexShader: /* glsl */ `
    uniform float uTime;
    varying vec3 vWorld;
    varying vec3 vNormal;
    vec3 wave(vec2 dir, float len, float amp, vec3 p, inout vec3 t, inout vec3 b) {
      float k = 6.2831 / len; float c = sqrt(9.8 / k); float f = k * (dot(dir, p.xz) - c * uTime);
      t += vec3(-dir.x * dir.x * amp * k * sin(f), dir.x * amp * k * cos(f), -dir.x * dir.y * amp * k * sin(f));
      b += vec3(-dir.x * dir.y * amp * k * sin(f), dir.y * amp * k * cos(f), -dir.y * dir.y * amp * k * sin(f));
      return vec3(dir.x * amp * cos(f), amp * sin(f), dir.y * amp * cos(f));
    }
    void main() {
      vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
      vec3 t = vec3(1, 0, 0), b = vec3(0, 0, 1);
      p += wave(normalize(vec2(1, 0.3)), 18.0, 0.35, p, t, b);
      p += wave(normalize(vec2(-0.4, 1)), 9.0, 0.18, p, t, b);
      p += wave(normalize(vec2(0.7, -0.6)), 4.0, 0.08, p, t, b);
      vNormal = normalize(cross(b, t));
      vWorld = p;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uSun;
    varying vec3 vWorld;
    varying vec3 vNormal;
    void main() {
      vec3 v = normalize(cameraPosition - vWorld);
      float fres = pow(1.0 - max(dot(v, vNormal), 0.0), 4.0);
      vec3 col = mix(vec3(0.05, 0.22, 0.28), vec3(0.95, 0.82, 0.68), fres);
      float glint = pow(max(dot(reflect(-uSun, vNormal), v), 0.0), 180.0);
      gl_FragColor = vec4(col + glint * 4.0, 1.0);
    }`,
})
const lake = new THREE.Mesh(new THREE.PlaneGeometry(900, 700, 160, 128).rotateX(-Math.PI / 2), water)
lake.position.set(LAKE.x, -18, LAKE.y)
scene.add(lake)

// Instanced placeholders: riders (body + bike), trees, crowd.
const dummy = new THREE.Object3D()
const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.28, 0.7, 4, 8), new THREE.MeshStandardMaterial({ roughness: 0.6 }), RIDERS)
const bikes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.75, 1.7), new THREE.MeshStandardMaterial({ color: '#222' }), RIDERS)
bodies.castShadow = bikes.castShadow = true
const kit = ['#ff5a00', '#2e5aac', '#c8102e', '#1f7a4d', '#e8c547', '#6b4fa0', '#f2f2f2', '#141414']
for (let i = 0; i < RIDERS; i++) bodies.setColorAt(i, new THREE.Color(i === 0 ? '#ff5a00' : kit[1 + (i % 7)]))
scene.add(bodies, bikes)
const riderU = Array.from({ length: RIDERS }, (_, i) => (i * 37) % SAMPLES)
const riderV = Array.from({ length: RIDERS }, () => 10 + Math.random() * 3)
const riderLane = Array.from({ length: RIDERS }, () => (Math.random() < 0.7 ? 1.5 : -1.5))

function scatter(mesh: THREE.InstancedMesh, near: (i: number) => [number, number], scale: () => number) {
  for (let i = 0; i < mesh.count; i++) {
    const [x, z] = near(i)
    dummy.position.set(x, heightAt(x, z), z)
    dummy.rotation.set(0, Math.random() * 6.28, 0)
    dummy.scale.setScalar(scale())
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  scene.add(mesh)
}
const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(2, 7, 7).translate(0, 3.5, 0), new THREE.MeshStandardMaterial({ color: '#3f5a36', roughness: 1 }), TREES)
trees.castShadow = true
scatter(
  trees,
  () => {
    for (;;) {
      const x = (Math.random() - 0.5) * 2200
      const z = (Math.random() - 0.5) * 2200
      if (heightAt(x, z) > 2 && roadPts.every((p, k) => k % 40 || Math.abs(p.x - x) + Math.abs(p.z - z) > 14)) return [x, z]
    }
  },
  () => 0.7 + Math.random() * 0.8,
)
const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.7, 0.3).translate(0, 0.85, 0), new THREE.MeshStandardMaterial({ roughness: 0.8 }), CROWD)
for (let i = 0; i < CROWD; i++) crowd.setColorAt(i, new THREE.Color(kit[i % kit.length]))
scatter(
  crowd,
  (i) => {
    const k = (i * 7) % 600 // crowd lines both sides of the first 600 road samples (finish area)
    const p = roadPts[k]
    const side = (i % 2 ? 1 : -1) * (6 + Math.random() * 3)
    return [p.x - roadDir[k].z * side, p.z + roadDir[k].x * side]
  },
  () => 0.9 + Math.random() * 0.2,
)

// ---------- tiers ----------
let composer: EffectComposer | null = null
function applyTier(t: Tier) {
  renderer.setPixelRatio(Math.min(t.dpr, devicePixelRatio))
  renderer.shadowMap.enabled = t.shadowMap > 0
  sun.castShadow = t.shadowMap > 0
  sun.shadow.mapSize.set(t.shadowMap || 1, t.shadowMap || 1)
  sun.shadow.map?.dispose()
  sun.shadow.map = null
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) (o.material as THREE.Material).needsUpdate = true
  })
  composer?.dispose()
  composer = new EffectComposer(renderer, { multisampling: Math.min(t.msaa, renderer.capabilities.maxSamples) })
  composer.addPass(new RenderPass(scene, camera))
  const effects = [
    new BloomEffect({ intensity: 0.6, luminanceThreshold: 0.85, mipmapBlur: true, resolutionScale: t.bloomScale }),
    ...(t.dof ? [new DepthOfFieldEffect(camera, { worldFocusDistance: 9, worldFocusRange: 12, bokehScale: 2 })] : []),
    new VignetteEffect({ darkness: 0.35 }),
    new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
  ]
  composer.addPass(new EffectPass(camera, ...effects))
  composer.setSize(innerWidth, innerHeight)
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  composer?.setSize(innerWidth, innerHeight)
})

// ---------- frame ----------
const clock = new THREE.Clock()
const camPos = new THREE.Vector3()
function update(dt: number, time: number) {
  water.uniforms.uTime.value = time
  for (let i = 0; i < RIDERS; i++) {
    riderU[i] = (riderU[i] + (riderV[i] * dt) / ((curve.getLength() / SAMPLES) || 1)) % SAMPLES
    const k = Math.floor(riderU[i])
    const p = roadPts[k]
    const d = roadDir[k]
    dummy.position.set(p.x - d.z * riderLane[i], p.y + 0.95 + Math.sin(time * 9 + i) * 0.03, p.z + d.x * riderLane[i])
    dummy.rotation.set(0.35, Math.atan2(d.x, d.z), 0)
    dummy.scale.setScalar(1)
    dummy.updateMatrix()
    bodies.setMatrixAt(i, dummy.matrix)
    dummy.position.y -= 0.55
    dummy.rotation.set(0, Math.atan2(d.x, d.z), 0)
    dummy.updateMatrix()
    bikes.setMatrixAt(i, dummy.matrix)
  }
  bodies.instanceMatrix.needsUpdate = bikes.instanceMatrix.needsUpdate = true

  // Moto cam behind the player (rider 0); sun and its shadow box follow.
  const k = Math.floor(riderU[0])
  const p = roadPts[k]
  const d = roadDir[k]
  camPos.set(p.x - d.x * 9 - d.z * 3, p.y + 3.2, p.z - d.z * 9 + d.x * 3)
  camera.position.lerp(camPos, Math.min(1, dt * 4))
  camera.lookAt(p.x + d.x * 6, p.y + 1, p.z + d.z * 6)
  sun.position.set(p.x + 120, p.y + 90, p.z + 60)
  sun.target.position.copy(p)
  water.uniforms.uSun.value.copy(sun.position).sub(p).normalize()
}

// ---------- benchmark ----------
const hud = document.getElementById('hud')!
const forced = new URLSearchParams(location.search).get('tier')
type Result = { tier: string; medianMs: number; p95Ms: number; fps: number; calls: number; triangles: number }
const results: Result[] = []
let tierIdx = 0
let tierStart = performance.now()
let frames: number[] = []
let last = performance.now()
let calls = 0
let triangles = 0

const gl = renderer.getContext()
const dbg = gl.getExtension('WEBGL_debug_renderer_info')
const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown'

applyTier(forced ? (TIERS.find((t) => t.name === forced) ?? TIERS[0]) : TIERS[0])
renderer.info.autoReset = false

function loop(now: number) {
  const dt = Math.min(0.1, clock.getDelta())
  update(dt, clock.elapsedTime)
  renderer.info.reset()
  composer!.render(dt)
  calls = renderer.info.render.calls
  triangles = renderer.info.render.triangles

  const frameMs = now - last
  last = now
  const tier = forced ?? TIERS[tierIdx].name
  if (!forced && now - tierStart > WARMUP_MS) frames.push(frameMs)
  hud.textContent = `tier ${tier}   ${Math.round(1000 / frameMs)} fps   ${frameMs.toFixed(1)} ms\ndraw calls ${calls}   triangles ${(triangles / 1000).toFixed(0)}k\n${gpu}`

  if (!forced && now - tierStart > WARMUP_MS + MEASURE_MS) {
    frames.sort((a, b) => a - b)
    const median = frames[Math.floor(frames.length / 2)]
    results.push({
      tier,
      medianMs: +median.toFixed(1),
      p95Ms: +frames[Math.floor(frames.length * 0.95)].toFixed(1),
      fps: Math.round(1000 / median),
      calls,
      triangles,
    })
    tierIdx++
    if (tierIdx === TIERS.length) return finish()
    applyTier(TIERS[tierIdx])
    tierStart = performance.now()
    frames = []
  }
  requestAnimationFrame(loop)
}

function finish() {
  // Pick the best tier that holds 60 fps (p95 under 20 ms), else the best that holds 30 (p95 under 40 ms).
  const pick60 = results.find((r) => r.p95Ms <= 20)
  const pick30 = results.find((r) => r.p95Ms <= 40)
  const verdict = pick60 ? `${pick60.tier} at 60 fps` : pick30 ? `${pick30.tier} at 30 fps (cap)` : 'no tier holds 30 fps'
  const report = { ua: navigator.userAgent, gpu, screen: `${screen.width}x${screen.height}@${devicePixelRatio}`, verdict, results }
  document.getElementById('result-text')!.textContent =
    `Verdict: ${verdict}\n\n` +
    results.map((r) => `${r.tier.padEnd(7)} median ${r.medianMs} ms  p95 ${r.p95Ms} ms  ${r.fps} fps  ${r.calls} calls  ${(r.triangles / 1000).toFixed(0)}k tris`).join('\n') +
    `\n\n${gpu}\n${report.screen}`
  document.getElementById('result')!.hidden = false
  fetch('/perf-report', { method: 'POST', body: JSON.stringify(report) })
}

requestAnimationFrame(loop)
