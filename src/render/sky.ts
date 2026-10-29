import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { SKY_CONFIG } from '../data/terrain';
import type { Vec3 } from '../flight/math';

const DEG = Math.PI / 180;

/** SKY_CONFIG の方位・仰角から太陽の方向（単位ベクトル、太陽へ向かう向き） */
export function sunDirection(azimuthDeg: number, elevationDeg: number): Vec3 {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  // 方位 0 = -Z（初期の進行方向）、90 = +X（右）
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
}

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uZenithColor;
  uniform vec3 uHorizonColor;
  uniform float uExponent;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uSunCos;
  uniform float uSunEdgeCos;
  uniform float uGlowStrength;
  uniform float uGlowExponent;
  varying vec3 vDir;
  #include <common>
  void main() {
    vec3 dir = normalize(vDir);
    // 地平線より下は地平線の色のまま（霧の色と同じなので、海の果てと空がつながる）
    float t = pow(clamp(dir.y, 0.0, 1.0), uExponent);
    vec3 color = mix(uHorizonColor, uZenithColor, t);
    float c = dot(dir, uSunDirection);
    color += uSunColor * pow(max(c, 0.0), uGlowExponent) * uGlowStrength;
    color = mix(color, uSunColor, smoothstep(uSunEdgeCos, uSunCos, c));
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * グラデーションの空（天頂と地平線で色が違う）と太陽の円盤。カメラに追従するドームで、
 * 深度を使わず最初に描く。HDR の空は 4-1
 */
export class Sky {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  readonly sunDirection: Vec3;

  constructor() {
    const cfg = SKY_CONFIG;
    this.sunDirection = sunDirection(cfg.sun.azimuth, cfg.sun.elevation);
    const d = this.sunDirection;
    const material = new ShaderMaterial({
      uniforms: {
        uZenithColor: { value: new Color(cfg.zenithColor) },
        uHorizonColor: { value: new Color(cfg.horizonColor) },
        uExponent: { value: cfg.exponent },
        uSunDirection: { value: new Vector3(d.x, d.y, d.z) },
        uSunColor: { value: new Color(cfg.sun.color) },
        uSunCos: { value: Math.cos(cfg.sun.discRadius * DEG) },
        // 円盤の縁を少しぼかす
        uSunEdgeCos: { value: Math.cos(cfg.sun.discRadius * 1.3 * DEG) },
        uGlowStrength: { value: cfg.sun.glowStrength },
        uGlowExponent: { value: cfg.sun.glowExponent },
      },
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(cfg.radius, 32, 16), material);
    this.mesh.name = 'sky';
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  /** 霧と背景に使う地平線の色 */
  get horizonColor(): Color {
    return new Color(SKY_CONFIG.horizonColor);
  }

  update(camera: Readonly<Vec3>): void {
    this.mesh.position.set(camera.x, camera.y, camera.z);
  }
}
