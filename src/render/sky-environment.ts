// 機体の環境マップ（4-10 事前修正）: 4-1 の大気散乱のスカイドームを PMREM にして、影側を空の色で持ち上げる。
// 7-5: 天候・時刻が変わったら焼き直す（夜に昼の空が機体に映らないように）
import {
  Mesh,
  PMREMGenerator,
  Scene,
  Vector3,
  Vector4,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { SKY_CONFIG } from '../data/sky';
import type { Atmosphere } from './atmosphere';

/**
 * 空のドームを低解像度のキューブに描き、PMREM（粗さごとのぼかし）にする。
 * 太陽・月の円盤とまぶしさは消して描く（直射光と鏡面の照り返しは平行光源の担当）。
 * 地平線より下はドームが描く遠くの海の色になるので、機体の腹は海の色で少し照らされる
 */
export class SkyEnvironment {
  private target: WebGLRenderTarget | null = null;
  private readonly scene = new Scene();
  private readonly position: Vector3;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly atmosphere: Atmosphere,
  ) {
    this.position = new Vector3(0, SKY_CONFIG.environment.height, 0);
    const sky = new Mesh(atmosphere.mesh.geometry, atmosphere.mesh.material);
    sky.position.copy(this.position);
    this.scene.add(sky);
  }

  /** 今の空を焼いて新しいテクスチャを返す。前のテクスチャは release で捨てる（付け替えの後） */
  bake(): Texture {
    const u = this.atmosphere.mesh.material.uniforms;
    const disc = u.uDiscRadiance?.value as number;
    const glow = (u.uGlow?.value as Vector4).clone();
    const moon = (u.uMoonDisc?.value as Vector4).clone();
    if (u.uDiscRadiance) u.uDiscRadiance.value = 0;
    (u.uGlow?.value as Vector4).set(0, 1, 0, 1);
    (u.uMoonDisc?.value as Vector4).setZ(0).setW(0);

    const pmrem = new PMREMGenerator(this.renderer);
    const old = this.target;
    this.target = pmrem.fromScene(this.scene, 0, 1, SKY_CONFIG.radius * 2, {
      size: SKY_CONFIG.environment.size,
      position: this.position,
    });
    pmrem.dispose();

    if (u.uDiscRadiance) u.uDiscRadiance.value = disc;
    (u.uGlow?.value as Vector4).copy(glow);
    (u.uMoonDisc?.value as Vector4).copy(moon);
    this.pending = old;
    return this.target.texture;
  }

  private pending: WebGLRenderTarget | null = null;

  /** 前に焼いたテクスチャを捨てる（新しいテクスチャをマテリアルに付けた後に呼ぶ） */
  release(): void {
    this.pending?.dispose();
    this.pending = null;
  }
}

/** 起動時に 1 回焼く（4-10 事前修正からの入口） */
export function createSkyEnvironment(renderer: WebGLRenderer, atmosphere: Atmosphere): Texture {
  return new SkyEnvironment(renderer, atmosphere).bake();
}
