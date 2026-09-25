/**
 * The composer's orb button: plasma churning inside a lit glass sphere,
 * rendered with one small WebGL fragment shader per canvas.
 *
 * Every mounted orb shares a single animation frame loop capped at 30fps, and
 * the loop stops whenever no orb is visible, so an idle window pays nothing.
 */

const VERTEX_SHADER = `attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos,0.0,1.0); }`;

const FRAGMENT_SHADER = `
precision mediump float;

uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_center;      // x, y, radius in device pixels
uniform float u_focus;      // 0..1, sharpens the folds on hover
uniform vec3 u_deep, u_mid, u_hot, u_glint;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
      mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
      mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}

float fbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 4; i++) {
    s += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

// Warping noise by more noise is what makes the cloud fold rather than slide.
float cloud(vec3 p, float t, float dens, float warp) {
  vec3 q = vec3(
    fbm(p * dens + vec3(0.0, 0.0, t * 0.14)),
    fbm(p * dens + vec3(5.2, 1.3, t * 0.11)),
    fbm(p * dens + vec3(1.7, 9.2, t * 0.09))
  );
  return fbm(p * dens + warp * q + vec3(0.0, 0.0, t * 0.07));
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 d = (frag - u_center.xy) / u_center.z;
  float rr = dot(d, d);
  if (rr > 2.1) discard;

  float t = u_time * 5.94;
  float bright = 1.98;

  if (rr > 1.0) {
    float g = smoothstep(2.1, 1.0, rr);
    gl_FragColor = vec4(mix(u_mid, u_hot, 0.4) * g * g * 0.40 * bright, g * g * 0.48);
    return;
  }

  float z = sqrt(max(0.0, 1.0 - rr));
  float r = sqrt(rr);
  float dens = 1.85 * (1.0 + 0.18 * u_focus);

  vec3 p = vec3(d, z);
  vec3 pb = vec3(d * 0.88, -z * 0.55) + vec3(3.1, 2.7, 0.0);

  float ff = clamp((cloud(p, t, dens, 1.8) - 0.5) * 1.45 + 0.5, 0.0, 1.0);
  float fb = clamp((cloud(pb, -t * 0.62, dens * 0.72, 1.44) - 0.5) * 1.23 + 0.5, 0.0, 1.0);

  vec3 back = u_deep;
  back = mix(back, u_mid, smoothstep(0.28, 0.64, fb));
  back = mix(back, u_hot, smoothstep(0.52, 0.82, fb) * 0.75);
  back *= exp(-0.3 * (0.25 + 0.55 * ff)) * 1.11;

  vec3 front = u_deep;
  front = mix(front, u_mid, smoothstep(0.22, 0.54, ff));
  front = mix(front, u_hot, smoothstep(0.48, 0.76, ff));
  front = mix(front, u_glint, smoothstep(0.70, 0.94, ff) * 0.85);

  vec3 col = mix(back, front, clamp(smoothstep(0.38, 0.72, ff) * 1.62, 0.0, 1.0));
  col *= bright;
  col *= 0.62 + 0.38 * z;
  col *= 1.0 - 0.46 * smoothstep(0.82, 1.0, r);

  // Fresnel, then the lit arc where the glass curves away.
  col += mix(u_hot, u_glint, 0.4) * pow(1.0 - z, 5.0) * 0.55;
  float facing = max(0.0, dot(normalize(d + 1e-5), normalize(vec2(-0.55, -0.62))));
  float meniscus = smoothstep(0.86, 0.975, r) * smoothstep(1.0, 0.975, r);
  col += u_glint * meniscus * pow(facing, 1.6) * 1.4;

  vec2 s1 = d - vec2(-0.34, -0.38);
  col += vec3(1.0) * exp(-dot(s1 * vec2(1.0, 1.25), s1 * vec2(1.0, 1.25)) * 30.0) * 0.78;
  vec2 s2 = d - vec2(0.26, 0.46);
  col += mix(u_hot, vec3(1.0), 0.45) * exp(-dot(s2, s2) * 15.0) * 0.20;

  col = col / (col + 1.45);
  col = pow(col, vec3(0.78));
  col = clamp((col - 0.45) * (1.87 + 0.55 * u_focus) + 0.45, 0.0, 1.0);

  gl_FragColor = vec4(col, smoothstep(1.0, 0.972, r));
}
`;

export interface OrbPalette {
  readonly deep: readonly [number, number, number];
  readonly mid: readonly [number, number, number];
  readonly hot: readonly [number, number, number];
  readonly glint: readonly [number, number, number];
}

function hexToRgb(hex: string): [number, number, number] {
  const value =
    hex.length === 4 ? `#${hex[1]!.repeat(2)}${hex[2]!.repeat(2)}${hex[3]!.repeat(2)}` : hex;
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const span = max - min;
  const s = l > 0.5 ? span / (2 - max - min) : span / (max + min);
  const h =
    max === r
      ? (g - b) / span + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / span + 2
        : (r - g) / span + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 1) + 1) % 1;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (offset: number) => {
    const t = ((((hue + offset) % 1) + 1) % 1) as number;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(1 / 3), channel(0), channel(-1 / 3)];
}

/** Four stops from one accent: dark body, mass, lit fold, glint. */
export function orbPalette(hex: string): OrbPalette {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  const sat = Math.max(0.45, Math.min(1, s));
  return {
    deep: hslToRgb(h - 0.02, sat, Math.max(0.08, l * 0.24)),
    mid: hslToRgb(h, Math.min(1, sat * 1.05), 0.54),
    hot: hslToRgb(h + 0.02, Math.min(1, sat * 0.9), 0.8),
    glint: hslToRgb(h + 0.04, Math.min(1, sat * 0.5), 0.95),
  };
}

export interface OrbHandle {
  setColor: (hex: string) => void;
  setFocused: (focused: boolean) => void;
  destroy: () => void;
}

interface Orb {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGLRenderingContext;
  readonly uniforms: Record<string, WebGLUniformLocation | null>;
  palette: OrbPalette;
  focus: number;
  focusTarget: number;
  visible: boolean;
  width: number;
  height: number;
}

const orbs = new Set<Orb>();
const FRAME_MS = 1000 / 30;
let frame = 0;
let clock = 0;
let lastFrameAt = 0;

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function draw(orb: Orb, time: number) {
  const { gl, canvas } = orb;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(canvas.clientWidth * dpr);
  const height = Math.round(canvas.clientHeight * dpr);
  if (width === 0 || height === 0) return;
  if (width !== orb.width || height !== orb.height) {
    canvas.width = width;
    canvas.height = height;
    orb.width = width;
    orb.height = height;
    gl.viewport(0, 0, width, height);
  }
  gl.uniform2f(orb.uniforms.res!, width, height);
  gl.uniform1f(orb.uniforms.time!, time);
  gl.uniform3f(orb.uniforms.center!, width / 2, height / 2, (Math.min(width, height) / 2) * 0.9);
  gl.uniform1f(orb.uniforms.focus!, orb.focus);
  gl.uniform3fv(orb.uniforms.deep!, orb.palette.deep as unknown as Float32List);
  gl.uniform3fv(orb.uniforms.mid!, orb.palette.mid as unknown as Float32List);
  gl.uniform3fv(orb.uniforms.hot!, orb.palette.hot as unknown as Float32List);
  gl.uniform3fv(orb.uniforms.glint!, orb.palette.glint as unknown as Float32List);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function tick(now: number) {
  frame = 0;
  const delta = Math.min(0.1, (now - lastFrameAt) / 1000);
  if (now - lastFrameAt >= FRAME_MS) {
    lastFrameAt = now;
    if (!reducedMotion()) clock += delta;
    for (const orb of orbs) {
      if (!orb.visible) continue;
      orb.focus += (orb.focusTarget - orb.focus) * Math.min(1, delta * 9);
      draw(orb, clock);
    }
  }
  schedule();
}

function schedule() {
  if (frame !== 0 || typeof document === "undefined" || document.hidden) return;
  let anyVisible = false;
  for (const orb of orbs) if (orb.visible) anyVisible = true;
  if (!anyVisible) return;
  frame = requestAnimationFrame(tick);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    } else {
      lastFrameAt = performance.now();
      schedule();
    }
  });
}

/** Returns null when WebGL is unavailable, so callers can fall back. */
export function mountOrb(canvas: HTMLCanvasElement, hex: string): OrbHandle | null {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
  });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const orb: Orb = {
    canvas,
    gl,
    uniforms: {
      res: gl.getUniformLocation(program, "u_res"),
      time: gl.getUniformLocation(program, "u_time"),
      center: gl.getUniformLocation(program, "u_center"),
      focus: gl.getUniformLocation(program, "u_focus"),
      deep: gl.getUniformLocation(program, "u_deep"),
      mid: gl.getUniformLocation(program, "u_mid"),
      hot: gl.getUniformLocation(program, "u_hot"),
      glint: gl.getUniformLocation(program, "u_glint"),
    },
    palette: orbPalette(hex),
    focus: 0,
    focusTarget: 0,
    visible: true,
    width: 0,
    height: 0,
  };
  orbs.add(orb);

  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) orb.visible = entry.isIntersecting;
          lastFrameAt = performance.now();
          schedule();
        })
      : null;
  observer?.observe(canvas);

  lastFrameAt = performance.now();
  draw(orb, clock);
  schedule();

  return {
    setColor: (next) => {
      orb.palette = orbPalette(next);
      if (!orb.visible) draw(orb, clock);
    },
    setFocused: (focused) => {
      orb.focusTarget = focused ? 1 : 0;
      schedule();
    },
    destroy: () => {
      observer?.disconnect();
      orbs.delete(orb);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
