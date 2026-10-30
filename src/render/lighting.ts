// 太陽光（平行光源 + シャドウマップ）と空の半球ライト（4-1）。色・強さは大気散乱から計算する
import { DirectionalLight, HemisphereLight, type Object3D, type Scene } from 'three';
import { SHADOW_CONFIG } from '../data/sky';
import type { Vec3 } from '../flight/math';
import type { Atmosphere } from './atmosphere';
import type { Rgb } from './atmosphere-model';
import { installStableShadowFilter } from './shadow-filter';

/**
 * 太陽光と半球ライト。影は機体を中心にした range 四方だけを計算し、光源を中心に追従させる
 * （シャドウマップの画素単位に揃えて、動いたときの影のちらつきを防ぐ）
 */
export class SceneLights {
  readonly sun = new DirectionalLight();
  readonly hemi = new HemisphereLight();
  private texel = 1;

  constructor(
    scene: Scene,
    private readonly atmosphere: Atmosphere,
  ) {
    const s = SHADOW_CONFIG;
    const half = s.range / 2;
    const cam = this.sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = s.distance * 2;
    this.sun.shadow.bias = s.bias;
    this.sun.shadow.normalBias = s.normalBias;
    this.sun.shadow.radius = s.radius;
    // 縁を点のディザにしない（4-12b）。最初の描画でシェーダーをコンパイルする前に
    installStableShadowFilter();
    this.sun.shadow.autoUpdate = true;
    scene.add(this.sun, this.sun.target, this.hemi);
    this.applyLighting();
    atmosphere.onChange(() => {
      this.applyLighting();
    });
  }

  /** 影の有無とシャドウマップの解像度（画質設定） */
  setShadows(enabled: boolean, mapSize: number): void {
    this.sun.castShadow = enabled;
    // 影なしのときは解像度を変えない（光源の追従の丸めは前の値のまま）
    if (!enabled || mapSize <= 0) return;
    const shadow = this.sun.shadow;
    if (shadow.mapSize.x !== mapSize) {
      shadow.mapSize.set(mapSize, mapSize);
      // 解像度を変えたら作り直す
      shadow.map?.dispose();
      shadow.map = null;
    }
    this.texel = SHADOW_CONFIG.range / mapSize;
  }

  /** 影の中心（機体の位置）。描画フレームごとに呼ぶ */
  follow(center: Readonly<Vec3>): void {
    const d = this.atmosphere.sun;
    // 光の向きに垂直な面（right, up）での位置をシャドウマップの画素単位に丸める
    const rl = Math.hypot(d.x, d.z) || 1;
    const rx = -d.z / rl;
    const rz = d.x / rl;
    // up = right × d
    const ux = -rz * d.y;
    const uy = rz * d.x - rx * d.z;
    const uz = rx * d.y;
    const t = this.texel;
    const a = Math.round((center.x * rx + center.z * rz) / t) * t;
    const b = Math.round((center.x * ux + center.y * uy + center.z * uz) / t) * t;
    const w = center.x * d.x + center.y * d.y + center.z * d.z;
    const x = rx * a + ux * b + d.x * w;
    const y = uy * b + d.y * w;
    const z = rz * a + uz * b + d.z * w;
    const dist = SHADOW_CONFIG.distance;
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + d.x * dist, y + d.y * dist, z + d.z * dist);
  }

  private applyLighting(): void {
    const l = this.atmosphere.lighting;
    setLight(this.sun, l.sun);
    // 半球ライトの irradiance = 色 × 強さ（Three.js の物理単位ではそのまま放射照度）
    const sky = l.skyIrradiance;
    const ground = l.groundIrradiance;
    const k = Math.max(sky[0], sky[1], sky[2], 1e-6);
    this.hemi.intensity = k;
    this.hemi.color.setRGB(sky[0] / k, sky[1] / k, sky[2] / k);
    this.hemi.groundColor.setRGB(ground[0] / k, ground[1] / k, ground[2] / k);
  }
}

function setLight(light: DirectionalLight, c: Readonly<Rgb>): void {
  const k = Math.max(c[0], c[1], c[2], 1e-6);
  light.intensity = k;
  light.color.setRGB(c[0] / k, c[1] / k, c[2] / k);
}

/** 影を落とす・受ける設定（子孫のメッシュすべて） */
export function setShadowFlags(object: Object3D, cast: boolean, receive: boolean): void {
  object.traverse((o) => {
    o.castShadow = cast;
    o.receiveShadow = receive;
  });
}
