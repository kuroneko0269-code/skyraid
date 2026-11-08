// 10-7b: 怪獣の光の入力（10-7a のネフィルガの kaiju2-object.ts から共通にした）: シーンの日（DirectionalLight）と空
// （HemisphereLight）を探し、日の向き・色（強さを掛ける）と空の色を毎フレーム読む（縁の光・透け・白い体の照り）
import { Color, DirectionalLight, HemisphereLight, Vector3, type Object3D } from 'three';

export class KaijuLights {
  private sun: DirectionalLight | null = null;
  private hemi: HemisphereLight | null = null;
  readonly sunDir = new Vector3(0.4, 0.8, 0.3);
  readonly sunColor = new Color(1, 1, 1);
  readonly skyColor = new Color(0.5, 0.6, 0.8);

  /** 日と空の光をシーンから探す */
  attach(scene: { readonly children: readonly Object3D[] }): void {
    for (const o of scene.children) {
      if (o instanceof DirectionalLight) this.sun ??= o;
      if (o instanceof HemisphereLight) this.hemi ??= o;
    }
  }

  /** 今の値を読む（無ければ決まった値） */
  read(): this {
    const s = this.sun;
    if (s) {
      this.sunDir.subVectors(s.position, s.target.position);
      this.sunColor.copy(s.color).multiplyScalar(s.intensity);
    } else {
      this.sunDir.set(0.4, 0.8, 0.3);
      this.sunColor.setRGB(1, 1, 1);
    }
    const h = this.hemi;
    if (h) this.skyColor.copy(h.color).multiplyScalar(h.intensity);
    else this.skyColor.setRGB(0.5, 0.6, 0.8);
    return this;
  }
}
