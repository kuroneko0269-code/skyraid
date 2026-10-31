// 夜空の星（7-5）: 手続き生成の点（Points 1 draw call）。カメラに付いて動く天球の上に置き、
// 曇天・霧・雨・昼は薄くして、見えないときは描かない（昼は draw call を増やさない）
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';
import { createRandom } from '../../core/random';
import { NIGHT_CONFIG } from '../../data/weather';

const f = (x: number): string => {
  const s = x.toPrecision(7);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};

const vertexShader = /* glsl */ `
  attribute float aMag;
  attribute vec3 aColor;
  uniform float uRadius;
  uniform float uPixelRatio;
  uniform float uTime;
  varying vec3 vColor;
  void main() {
    vec3 dir = position;
    gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + dir * uRadius, 1.0);
    gl_PointSize = mix(${f(NIGHT_CONFIG.stars.minSize)}, ${f(NIGHT_CONFIG.stars.maxSize)}, aMag) * uPixelRatio;
    // 地平線の近くは大気で消える。少しまたたく
    float horizon = smoothstep(0.0, 0.18, dir.y);
    float twinkle = 0.82 + 0.18 * sin(uTime * (2.0 + 5.0 * fract(aMag * 91.7)) + dir.x * 40.0);
    vColor = aColor * (0.25 + 0.75 * aMag * aMag) * horizon * twinkle;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uBrightness;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = 1.0 - smoothstep(0.15, 0.5, d);
    gl_FragColor = vec4(vColor * uBrightness * a, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** 星の向き（上半球、地平線の少し下まで）・明るさ（暗い星ほど多い）・色（青白〜橙）。少ない数は多い数の先頭と同じ */
export function createStarData(
  count: number,
  seed: number = NIGHT_CONFIG.stars.seed,
): { positions: Float32Array; mags: Float32Array; colors: Float32Array } {
  const random = createRandom(seed);
  const positions = new Float32Array(count * 3);
  const mags = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // 球面上で一様（y は −0.05〜1）
    const y = -0.05 + 1.05 * random();
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    positions.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
    mags[i] = Math.pow(random(), 3);
    const t = random();
    // 色温度の分布をおおまかに: 多くは白、一部が青白・橙
    const c: [number, number, number] =
      t < 0.15 ? [0.75, 0.85, 1.15] : t > 0.85 ? [1.15, 0.9, 0.7] : [1, 1, 1];
    colors.set(c, i * 3);
  }
  return { positions, mags, colors };
}

export class Stars {
  readonly mesh: Points<BufferGeometry, ShaderMaterial>;
  private readonly maxCount: number;

  constructor(maxCount: number) {
    this.maxCount = maxCount;
    const data = createStarData(maxCount);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
    geometry.setAttribute('aMag', new BufferAttribute(data.mags, 1));
    geometry.setAttribute('aColor', new BufferAttribute(data.colors, 3));
    this.mesh = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: {
          uRadius: { value: 1000 },
          uPixelRatio: { value: 1 },
          uTime: { value: 0 },
          uBrightness: { value: 0 },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.mesh.name = 'stars';
    // 雲（renderOrder 0）より先に描き、雲が手前に重なる
    this.mesh.renderOrder = -0.5;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** 画質: 星の数と、置く距離（描画距離の内側）・画素の大きさ */
  setQuality(count: number, drawDistance: number, pixelRatio: number): void {
    this.mesh.geometry.setDrawRange(0, Math.min(count, this.maxCount));
    const u = this.mesh.material.uniforms;
    if (u.uRadius) u.uRadius.value = drawDistance * 0.9;
    if (u.uPixelRatio) u.uPixelRatio.value = pixelRatio;
  }

  /** visibility は 0〜1（夜らしさ × 晴れ具合）。0 なら描かない */
  update(visibility: number, time: number): void {
    const u = this.mesh.material.uniforms;
    if (u.uBrightness) u.uBrightness.value = NIGHT_CONFIG.stars.brightness * visibility;
    if (u.uTime) u.uTime.value = time;
    this.mesh.visible = visibility > 0.01;
  }
}
