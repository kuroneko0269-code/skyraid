// 10-7b: 怪獣の体の下の大きな影（描画だけ）: 床（海面・地面）の少し上に置く水平の板に、ぼやけた楕円の暗さを描く（1 draw call）。
// 影の地図は遠い所まで届かないので、大きさを伝えるために足す。高いほど薄く大きく、日が低いと日の反対へずれる
import { DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';

export interface KaijuShadowSpec {
  /** 体の長さ・幅（m）と一番濃いときの濃さ */
  readonly length: number;
  readonly width: number;
  readonly opacity: number;
  /** この高さ（床から m）で消える */
  readonly fadeHeight: number;
}

const off = new Vector3();

export class KaijuShadow {
  readonly mesh: Mesh;
  private readonly material: MeshBasicMaterial;

  constructor(private readonly spec: KaijuShadowSpec) {
    this.material = new MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vShUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShUv = uv * 2.0 - 1.0;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vShUv;')
        .replace(
          '#include <alphamap_fragment>',
          '#include <alphamap_fragment>\nfloat kd = length(vShUv);\ndiffuseColor.a *= pow(saturate(1.0 - kd), 1.5);',
        );
    };
    this.material.customProgramCacheKey = () => 'kaiju-shadow';
    this.mesh = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = -1;
  }

  /**
   * 置く: center は体の中心、heading は向き（ラジアン。Y 軸回り）、floor は真下の床の高さ、sunDir は日の向き（体から日へ）、
   * strength は 0〜1（日の強さ・倒れて消える）
   */
  update(
    center: Readonly<Vector3>,
    heading: number,
    floor: number,
    sunDir: Readonly<Vector3>,
    strength: number,
  ): void {
    const S = this.spec;
    const h = Math.max(0, center.y - floor);
    const fade = Math.max(0, 1 - h / S.fadeHeight) * strength;
    this.mesh.visible = fade > 0.01;
    if (!this.mesh.visible) return;
    // 日の反対へずらす（日が低いほど遠く。ずれは高さの 0.8 倍まで）
    off.copy(sunDir).normalize();
    const k = off.y > 0.15 ? Math.min(0.8, Math.hypot(off.x, off.z) / off.y) * h : 0.8 * h;
    const len = Math.hypot(off.x, off.z) || 1;
    this.mesh.position.set(center.x - (off.x / len) * k, floor + 2, center.z - (off.z / len) * k);
    this.mesh.rotation.set(0, heading, 0);
    const spread = 1 + h / 1800;
    this.mesh.scale.set(S.width * spread, 1, S.length * spread);
    this.material.opacity = S.opacity * fade;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
