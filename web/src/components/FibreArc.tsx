/* Fibre Arc — Originkit source, adapted for VYRA.
 *
 * The vertex shader, fragment shader, strand math, mirrored bundle, pointer
 * interaction and uniforms are preserved from the supplied component. Changes
 * are limited to: responsive sizing (no 1200x800 minimum), full WebGL resource
 * cleanup, context-loss handling, pause on hidden/offscreen, reduced-motion
 * support, a non-WebGL fallback, and pointer events that never block the UI.
 */

import * as React from 'react'
import { useEffect, useRef, useState } from 'react'

const MAX_DPR = 2

const VERT_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

const FRAG_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  uRes;
uniform float uTime;
uniform vec2  uMouse;
uniform float uHover;

const float PI  = 3.14159265;
const float TAU = 6.28318531;

float sat(float x){ return clamp(x, 0.0, 1.0); }
float pw(float x, float e){ return pow(max(x, 1e-5), e); }
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 34.56); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm3(vec2 p){ float s = 0.0, a = 0.5; for(int i = 0; i < 3; i++){ s += a * vnoise(p); p = p * 2.07 + vec2(4.1, 2.3); a *= 0.5; } return s; }

uniform vec3 uBg, uBase, uAccent, uHigh;
uniform float uStrands, uCurve, uSpread, uThin, uComb, uReach, uDir;

void computeBundle(vec2 ps, float t, out float coreOut, out float haloOut) {
  coreOut = 0.0;
  haloOut = 0.0;
  vec2 apex = vec2(0.34, 0.20);
  for(int i = 0; i < 26; i++){
    float fi = float(i);
    float f = fi / 25.0;
    float on = sat(uStrands - fi);
    float jit = hash21(vec2(fi, 1.7));
    float k = uCurve * (0.55 + 1.30 * f + 0.10 * jit);
    float ax = apex.x + (f - 0.5) * uSpread * 0.18;
    float ay = apex.y + (f - 0.5) * uSpread * 0.14 + 0.012 * sin(t * 0.5 + fi);
    float dx = ps.x - ax;
    float yc = ay - k * dx * dx;
    float sl = -2.0 * k * dx;
    float dd = abs(ps.y - yc) / sqrt(1.0 + sl * sl);
    float w = uThin * (0.0016 + 0.0032 * jit);
    coreOut += on * pw(w / (w + dd), 3.2);
    haloOut += on * pw(w * 11.0 / (w * 11.0 + dd), 1.9) * 0.085;
  }
  float env = mix(0.20, 1.0, sat((ps.x + 0.52) / 0.95));
  coreOut *= env;
  haloOut *= env;
}

void main(){
  float ar = uRes.x / max(uRes.y, 1.0);
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (uv - 0.5) * vec2(ar, 1.0);
  float t = uTime;

  float cs = cos(uDir), sn = sin(uDir);
  mat2 rot = mat2(cs, sn, -sn, cs);
  vec2 q  = rot * p;
  vec2 mouseWorld = rot * ((uMouse - 0.5) * vec2(ar, 1.0));

  // Original bundle coordinate space
  vec2 pm1 = q - mouseWorld;
  vec2 ps1 = q - normalize(pm1 + vec2(1e-5)) * uComb * 0.10 * sat(uHover)
            * exp(-dot(pm1, pm1) / max(uReach * uReach, 1e-4));

  // Mirrored bundle coordinate space (negate x coordinate for mirroring)
  vec2 qMirrored = vec2(-q.x, q.y);
  vec2 mouseWorldMirrored = vec2(-mouseWorld.x, mouseWorld.y);
  vec2 pm2 = qMirrored - mouseWorldMirrored;
  vec2 ps2 = qMirrored - normalize(pm2 + vec2(1e-5)) * uComb * 0.10 * sat(uHover)
            * exp(-dot(pm2, pm2) / max(uReach * uReach, 1e-4));

  float core1 = 0.0, halo1 = 0.0;
  float core2 = 0.0, halo2 = 0.0;

  computeBundle(ps1, t, core1, halo1);
  computeBundle(ps2, t, core2, halo2);

  float core = core1 + core2;
  float halo = halo1 + halo2;

  vec3 col = uBg;
  col += uBase * halo * 1.5;
  col += mix(uAccent, uHigh, sat(core * 0.75)) * core * 1.4;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('FibreArc shader:', gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

function parseColor(input: string | undefined, fb: [number, number, number]): [number, number, number] {
  if (!input) return fb
  const str = String(input).trim()
  if (str.charAt(0) === '#') {
    let hex = str.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) return [r / 255, g / 255, b / 255]
    }
    return fb
  }
  const m = str.match(/[\d.]+/g)
  if (m && m.length >= 3) {
    return [
      Math.min(255, parseFloat(m[0])) / 255,
      Math.min(255, parseFloat(m[1])) / 255,
      Math.min(255, parseFloat(m[2])) / 255,
    ]
  }
  return fb
}

function num(v: unknown, fb: number): number {
  return typeof v === 'number' && isFinite(v) ? v : fb
}

function clampN(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

type BundleGroup = { curve?: number; spread?: number; thickness?: number; comb?: number }
const BUNDLE_DEFAULTS: Required<BundleGroup> = { curve: 150, spread: 100, thickness: 100, comb: 170 }

export interface FibreArcProps {
  style?: React.CSSProperties
  className?: string
  background?: string
  baseColor?: string
  accentColor?: string
  highlight?: string
  density?: number
  speed?: number
  direction?: number
  hover?: number
  reach?: number
  bundle?: BundleGroup
  /** Visual weight of the whole layer, 0–1. */
  intensity?: number
  /** Freeze the animation (draws a single frame); respects reduced motion too. */
  paused?: boolean
}

export default function FibreArc(props: FibreArcProps) {
  const {
    style,
    className,
    background = '#0B0D12',
    baseColor = '#FF7548',
    accentColor = '#F5B66B',
    highlight = '#FFF4E8',
    density = 26,
    speed = 48,
    direction = 180,
    hover = 140,
    reach = 30,
    bundle = { comb: 150, curve: 330, spread: 280, thickness: 74 },
    intensity = 1,
    paused = false,
  } = props

  const bundle_ = { ...BUNDLE_DEFAULTS, ...(bundle || {}) }

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const wakeRef = useRef<(() => void) | null>(null)

  const vRef = useRef<Record<string, number | string>>({})
  vRef.current = {
    background,
    baseColor,
    accentColor,
    highlight,
    density: clampN(num(density, 26), 4, 26),
    speed: clampN(num(speed, 50), 0, 100) / 50,
    direction: (clampN(num(direction, 180), 0, 360) * Math.PI) / 180,
    hover: clampN(num(hover, 100), 0, 200) / 100,
    reach: clampN(num(reach, 30), 5, 100) / 100,
    curve: clampN(num(bundle_.curve, 150), 20, 400) / 100,
    spread: clampN(num(bundle_.spread, 100), 0, 300) / 100,
    thickness: clampN(num(bundle_.thickness, 100), 20, 400) / 100,
    comb: clampN(num(bundle_.comb, 170), 0, 400) / 100,
  }

  const ptrRef = useRef({ x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, on: 0, onTarget: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    let gl: WebGLRenderingContext | null = null
    try {
      gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, powerPreference: 'low-power' })
    } catch {
      gl = null
    }
    if (!gl) {
      setFailed(true)
      return
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let vs: WebGLShader | null = null
    let fs: WebGLShader | null = null
    let prog: WebGLProgram | null = null
    let buf: WebGLBuffer | null = null
    let raf = 0
    let disposed = false
    let visible = true
    let clock = 0
    let last = performance.now()
    let needsFrame = true

    const cleanupGL = () => {
      if (!gl) return
      if (buf) gl.deleteBuffer(buf)
      if (prog) gl.deleteProgram(prog)
      if (vs) gl.deleteShader(vs)
      if (fs) gl.deleteShader(fs)
      vs = fs = null
      prog = null
      buf = null
    }

    const fail = () => {
      cleanupGL()
      setFailed(true)
    }

    vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC)
    fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC)
    if (!vs || !fs) {
      fail()
      return
    }
    prog = gl.createProgram()
    if (!prog) {
      fail()
      return
    }
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('FibreArc link:', gl.getProgramInfoLog(prog))
      fail()
      return
    }
    gl.useProgram(prog)

    buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const posLoc = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    const locs: Record<string, WebGLUniformLocation | null> = {}
    const u = (name: string) => {
      if (!(name in locs)) locs[name] = gl!.getUniformLocation(prog!, name)
      return locs[name]
    }

    const draw = (now: number) => {
      if (!gl || !prog || disposed) return
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      const v = vRef.current

      clock = (clock + dt * (v.speed as number)) % 3600

      const ptr = ptrRef.current
      const k = 1 - Math.exp(-6 * Math.max(dt, 0.016))
      ptr.on += (ptr.onTarget - ptr.on) * k
      ptr.x += ((ptr.onTarget > 0 ? ptr.tx : 0.5) - ptr.x) * k
      ptr.y += ((ptr.onTarget > 0 ? ptr.ty : 0.5) - ptr.y) * k

      const cw = canvas.clientWidth || wrap.clientWidth || 1
      const ch = canvas.clientHeight || wrap.clientHeight || 1
      // Full-viewport use: cap the raster to a fixed pixel budget so a 4K frame
      // does not run 26 strands × 2 bundles for 8M pixels every frame.
      const budget = Math.sqrt(3_200_000 / Math.max(1, cw * ch))
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR, budget)
      const bw = Math.max(1, Math.round(cw * dpr))
      const bh = Math.max(1, Math.round(ch * dpr))
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw
        canvas.height = bh
      }
      gl.viewport(0, 0, bw, bh)

      const cBg = parseColor(v.background as string, [0.043, 0.051, 0.071])
      const cBase = parseColor(v.baseColor as string, [1.0, 0.46, 0.28])
      const cAccent = parseColor(v.accentColor as string, [0.96, 0.71, 0.42])
      const cHigh = parseColor(v.highlight as string, [1.0, 0.96, 0.91])

      gl.uniform2f(u('uRes'), bw, bh)
      gl.uniform1f(u('uTime'), clock)
      gl.uniform2f(u('uMouse'), ptr.x, 1 - ptr.y)
      gl.uniform1f(u('uHover'), Math.min(1, ptr.on) * (v.hover as number))
      gl.uniform3f(u('uBg'), cBg[0], cBg[1], cBg[2])
      gl.uniform3f(u('uBase'), cBase[0], cBase[1], cBase[2])
      gl.uniform3f(u('uAccent'), cAccent[0], cAccent[1], cAccent[2])
      gl.uniform3f(u('uHigh'), cHigh[0], cHigh[1], cHigh[2])
      gl.uniform1f(u('uStrands'), v.density as number)
      gl.uniform1f(u('uReach'), v.reach as number)
      gl.uniform1f(u('uDir'), v.direction as number)
      gl.uniform1f(u('uCurve'), v.curve as number)
      gl.uniform1f(u('uSpread'), v.spread as number)
      gl.uniform1f(u('uThin'), v.thickness as number)
      gl.uniform1f(u('uComb'), v.comb as number)

      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const shouldAnimate = () => visible && !document.hidden && !reduced.matches && !disposed && !pausedRef.current

    const tick = (now: number) => {
      if (disposed) return
      draw(now)
      if (shouldAnimate()) {
        raf = requestAnimationFrame(tick)
      } else {
        raf = 0
      }
    }

    const wake = () => {
      if (disposed) return
      needsFrame = true
      if (!raf && shouldAnimate()) {
        last = performance.now()
        raf = requestAnimationFrame(tick)
      } else if (!shouldAnimate() && needsFrame) {
        draw(performance.now())
        needsFrame = false
      }
    }

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf)
        raf = 0
      } else {
        wake()
      }
    }

    const onMotionChange = () => {
      cancelAnimationFrame(raf)
      raf = 0
      wake()
    }

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true
        if (!visible) {
          cancelAnimationFrame(raf)
          raf = 0
        } else {
          wake()
        }
      },
      { rootMargin: '120px' },
    )
    io.observe(wrap)

    const onPointer = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      if (!inside) {
        ptrRef.current.onTarget = 0
        return
      }
      ptrRef.current.tx = clampN((e.clientX - r.left) / r.width, 0, 1)
      ptrRef.current.ty = clampN((e.clientY - r.top) / r.height, 0, 1)
      ptrRef.current.onTarget = 1
    }
    const onLeave = () => {
      ptrRef.current.onTarget = 0
    }

    const onContextLost = (event: Event) => {
      event.preventDefault()
      cancelAnimationFrame(raf)
      raf = 0
      cleanupGL()
    }
    const onContextRestored = () => {
      window.location.reload()
    }

    window.addEventListener('pointermove', onPointer, { passive: true })
    window.addEventListener('pointerdown', onPointer, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    document.addEventListener('visibilitychange', onVisibility)
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
    if (typeof reduced.addEventListener === 'function') reduced.addEventListener('change', onMotionChange)
    else reduced.addListener(onMotionChange)

    draw(performance.now())
    if (shouldAnimate()) {
      raf = requestAnimationFrame(tick)
    }

    wakeRef.current = wake

    return () => {
      disposed = true
      wakeRef.current = null
      cancelAnimationFrame(raf)
      io.disconnect()
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      if (typeof reduced.removeEventListener === 'function') reduced.removeEventListener('change', onMotionChange)
      else reduced.removeListener(onMotionChange)
      cleanupGL()
      const lose = gl?.getExtension('WEBGL_lose_context')
      lose?.loseContext()
      gl = null
    }
  }, [])

  useEffect(() => {
    wakeRef.current?.()
  }, [paused])

  return (
    <div
      ref={wrapRef}
      className={['fibre-arc', className].filter(Boolean).join(' ')}
      aria-hidden="true"
      style={{
        position: 'relative',
        overflow: 'hidden',
        background,
        width: '100%',
        height: '100%',
        opacity: intensity,
        ...style,
      }}
    >
      {failed ? (
        <div className="fibre-arc__fallback" />
      ) : (
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
        />
      )}
    </div>
  )
}
