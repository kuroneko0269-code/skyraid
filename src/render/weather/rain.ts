// 雨（7-5）: 画質「中」以上は線の粒（InstancedMesh 1 draw call）。粒はワールドに固定してカメラのまわりの箱に
// 回り込ませ、カメラに対する相対速度の向きに伸ばす（速く飛ぶほど長い筋）。「低」は全画面の半透明の筋 1 枚
// （画面の歪みなし）。雲の層より上では降らない
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { createRandom } from '../../core/random';
import { smoothstep } from '../../core/weather-state';
import type { RainMode } from '../../data/quality';
import { RAIN_CONFIG } from '../../data/weather';
import type { Vec3 } from '../../flight/math';

const f = (x: number): string => {
  const s = x.toPrecision(7);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};

const streakVertex = /* glsl */ `
  uniform vec3 uBox;
  uniform vec3 uOffset;
  // 筋のベクトル（頭 → 尾。カメラに対する相対速度 × シャッター）
  uniform vec3 uStreak;
  varying float vAlpha;
  varying float vT;
  void main() {
    vec3 seed = instanceMatrix[3].xyz;
    vec3 p = seed * uBox + uOffset;
    vec3 rel = mod(p - cameraPosition + 0.5 * uBox, uBox) - 0.5 * uBox;
    vec3 center = cameraPosition + rel;
    float len = length(uStreak);
    vec3 axis = uStreak / max(len, 1e-4);
    vec3 toCam = normalize(cameraPosition - center);
    vec3 side = cross(axis, toCam);
    side /= max(length(side), 1e-4);
    float dist = length(rel);
    float w = max(${f(RAIN_CONFIG.width)}, dist * ${f(RAIN_CONFIG.widthPerMeter)});
    vec3 wp = center - uStreak * position.y + side * (position.x * w);
    vAlpha = (1.0 - smoothstep(${f(RAIN_CONFIG.fadeDistance * 0.5)}, ${f(RAIN_CONFIG.fadeDistance)}, dist))
      * smoothstep(1.5, 4.0, dist);
    vT = position.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }
`;

const streakFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  varying float vAlpha;
  varying float vT;
  void main() {
    float a = uAlpha * vAlpha * (1.0 - 0.7 * vT);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const sheetVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const sheetFragment = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uAngle;
  uniform float uSpeed;
  uniform float uAspect;
  uniform vec3 uColor;
  varying vec2 vUv;
  float sheetHash(float x) {
    return fract(sin(x * 127.1) * 43758.5453);
  }
  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    float c = cos(uAngle);
    float s = sin(uAngle);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    float u = p.x * ${f(RAIN_CONFIG.sheet.columns)};
    float col = floor(u);
    float h = sheetHash(col);
    float y = p.y + uTime * uSpeed * (0.75 + 0.5 * h) + h * 13.0;
    float seg = fract(y * (1.5 + h));
    float streak = smoothstep(0.0, 0.04, seg) * (1.0 - smoothstep(0.06, 0.3, seg));
    float line = 1.0 - smoothstep(0.03, 0.12, abs(fract(u) - 0.5));
    float a = uAlpha * streak * line * step(0.35, h);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const camVel = new Vector3();
const tmp = new Vector3();

export class Rain {
  readonly streaks: InstancedMesh<BufferGeometry, ShaderMaterial>;
  readonly sheet: Mesh<PlaneGeometry, ShaderMaterial>;
  private mode: RainMode = 'streaks';
  private drops = 0;
  private readonly offset = new Vector3();
  private readonly lastCam = new Vector3();
  private hasLast = false;
  private readonly color = new Color();

  constructor(maxDrops: number) {
    const geometry = new BufferGeometry();
    // x = 横（−0.5〜0.5）、y = 頭 0 → 尾 1
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3),
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const b = RAIN_CONFIG.box;
    this.streaks = new InstancedMesh(
      geometry,
      new ShaderMaterial({
        uniforms: {
          uBox: { value: new Vector3(b.x, b.y, b.z) },
          uOffset: { value: this.offset },
          uStreak: { value: new Vector3(0, -1, 0) },
          uColor: { value: this.color },
          uAlpha: { value: RAIN_CONFIG.alpha },
        },
        vertexShader: streakVertex,
        fragmentShader: streakFragment,
        transparent: true,
        depthWrite: false,
      }),
      Math.max(1, maxDrops),
    );
    const random = createRandom(31);
    const m = new Matrix4();
    for (let i = 0; i < Math.max(1, maxDrops); i++) {
      m.makeTranslation(random(), random(), random());
      this.streaks.setMatrixAt(i, m);
    }
    this.streaks.name = 'rain';
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;

    this.sheet = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAlpha: { value: 0 },
          uAngle: { value: 0 },
          uSpeed: { value: 2 },
          uAspect: { value: 1 },
          uColor: { value: this.color },
        },
        vertexShader: sheetVertex,
        fragmentShader: sheetFragment,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.sheet.name = 'rain-sheet';
    this.sheet.renderOrder = 999;
    this.sheet.frustumCulled = false;
    this.sheet.visible = false;
  }

  setQuality(mode: RainMode, drops: number): void {
    this.mode = mode;
    this.drops = Math.min(drops, this.streaks.instanceMatrix.count);
  }

  /** 雨の色（空の光で照らした水。リニア） */
  setColor(r: number, g: number, b: number): void {
    this.color.setRGB(r, g, b);
  }

  /**
   * 描画フレームごと。amount は雨の強さ（0〜1）、windX / windZ は風で流される速さ（m/s）、dt は秒
   */
  update(
    camera: PerspectiveCamera,
    amount: number,
    windX: number,
    windZ: number,
    dt: number,
    time: number,
  ): void {
    const cfg = RAIN_CONFIG;
    const p: Readonly<Vec3> = camera.position;
    // カメラの速度（前フレームとの差。リスポーン等の瞬間移動は無視）
    if (this.hasLast && dt > 0) {
      camVel.set(p.x - this.lastCam.x, p.y - this.lastCam.y, p.z - this.lastCam.z).divideScalar(dt);
      if (camVel.lengthSq() > 1000 * 1000) camVel.set(0, 0, 0);
    } else camVel.set(0, 0, 0);
    this.lastCam.set(p.x, p.y, p.z);
    this.hasLast = true;
    const k = amount * (1 - smoothstep(cfg.ceilingFrom, cfg.ceilingTo, p.y));
    const shown = k > 0.01;
    this.streaks.visible = shown && this.mode === 'streaks' && this.drops > 0;
    this.sheet.visible = shown && this.mode === 'sheet';
    if (!shown) return;
    // 粒の速度（ワールド）と、カメラに対する相対速度
    const vx = windX;
    const vy = -cfg.fallSpeed;
    const vz = windZ;
    const b = cfg.box;
    this.offset.set(
      (this.offset.x + vx * dt) % b.x,
      (this.offset.y + vy * dt) % b.y,
      (this.offset.z + vz * dt) % b.z,
    );
    tmp.set(vx - camVel.x, vy - camVel.y, vz - camVel.z);
    const speed = tmp.length();
    const len = Math.min(cfg.maxLength, Math.max(cfg.minLength, speed * cfg.shutter));
    if (this.streaks.visible) {
      this.streaks.count = Math.max(1, Math.round(this.drops * k));
      const u = this.streaks.material.uniforms;
      (u.uStreak?.value as Vector3).copy(tmp).multiplyScalar(len / Math.max(speed, 1e-3));
    }
    if (this.sheet.visible) {
      // 画面の上での粒の流れる向き（カメラの空間の xy）。ロールしても雨は世界の下へ落ちる
      tmp.transformDirection(camera.matrixWorldInverse);
      const u = this.sheet.material.uniforms;
      if (u.uAngle) u.uAngle.value = Math.atan2(tmp.x, -tmp.y);
      if (u.uSpeed) u.uSpeed.value = 1.2 + Math.min(speed, 300) / 90;
      if (u.uTime) u.uTime.value = time;
      if (u.uAlpha) u.uAlpha.value = cfg.sheet.alpha * k;
      if (u.uAspect) u.uAspect.value = camera.aspect;
    }
  }
}
