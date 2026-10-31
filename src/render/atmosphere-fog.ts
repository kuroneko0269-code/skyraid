// 空気遠近の霧（4-1）。atmosphere.ts が 300 行を超えたので分けた（7-5b）
import { Fog, SRGBColorSpace, Vector3 } from 'three';
import type { Vec3 } from '../flight/math';

/**
 * 霧の uniform を大気散乱に読み替える Fog。color = 太陽の向き × 放射照度、near / far = 描画距離の果てで
 * 空の色に溶かしきる範囲（atmosphere-glsl.ts の installAtmosphereChunks）
 */
export class AtmosphereFog extends Fog {
  private readonly packed = new Vector3();
  private toScreen = false;

  constructor() {
    super(0x000000, 1, 2);
  }

  setSun(sun: Readonly<Vec3>, irradiance: number): void {
    this.packed.set(sun.x * irradiance, sun.y * irradiance, sun.z * irradiance);
    this.writeColor();
  }

  /**
   * 画面に直接描くか（ポストエフェクトなし = 画質「低」）。Three.js は画面に直接描くとき fogColor を
   * sRGB に変換して渡すので、その逆変換をしておく（どちらの変換も負の値を含めて正確に戻る）
   */
  setOutputToScreen(toScreen: boolean): void {
    if (toScreen === this.toScreen) return;
    this.toScreen = toScreen;
    this.writeColor();
  }

  private writeColor(): void {
    const p = this.packed;
    if (this.toScreen) this.color.setRGB(p.x, p.y, p.z, SRGBColorSpace);
    else this.color.setRGB(p.x, p.y, p.z);
  }
}
