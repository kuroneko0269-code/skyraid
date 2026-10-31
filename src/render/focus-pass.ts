// フォトモード（7-A）の被写界深度（画質「高」のみ）: three/examples/jsm の BokehPass。
// 奥行きの描画でシャドウマップを描き直さないよう、その間だけ影の自動更新を止める
import type { Camera, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { PHOTO_FOCUS } from '../data/photo';

export interface FocusSettings {
  /** ピントの距離（m） */
  distance: number;
  /** ボケの強さ（0〜1） */
  blur: number;
}

export class FocusPass extends BokehPass {
  constructor(scene: Scene, camera: Camera) {
    super(scene, camera, { focus: 30, aperture: 0, maxblur: PHOTO_FOCUS.maxBlur });
  }

  apply(f: Readonly<FocusSettings>): void {
    const u = this.uniforms as Record<string, { value: unknown } | undefined>;
    const focus = u.focus;
    const aperture = u.aperture;
    if (focus) focus.value = f.distance;
    if (aperture) aperture.value = Math.min(1, Math.max(0, f.blur)) * PHOTO_FOCUS.maxAperture;
  }

  override render(
    renderer: WebGLRenderer,
    writeBuffer: WebGLRenderTarget,
    readBuffer: WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    const auto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    renderer.shadowMap.autoUpdate = auto;
  }
}
