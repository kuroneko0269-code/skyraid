// 10-7e: ヴォルガスの熱線（描画だけ。判定の向き・長さを読む）: 円柱 1 つ（描く回数 1）で、カメラへ向く真ん中ほど白い芯・縁ほど青い外側に
// し、口から先へ流れる筋と太さの揺らぎを付ける（6-1 は青い円柱 1 色）。先へ行くほど少し太く薄く
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { KAIJU_ATTACK_CONFIG } from '../../data/kaiju';
import { KAIJU_MODEL_CONFIG } from '../../data/kaiju-model';
import { VORGAS_VISUAL } from '../../data/vorgas-visual';
import type { KaijuEffectsView } from '../../entities/kaiju-display';
import { f, vec } from '../kaiju-look/glsl';

const M = KAIJU_MODEL_CONFIG;
const B = VORGAS_VISUAL.beam;
const yAxis = new Vector3(0, 1, 0);
const dir = new Vector3();
const quat = new Quaternion();

export class VorgasBeam {
  readonly mesh: Mesh;
  private readonly material: MeshBasicMaterial;
  private readonly uTime = { value: 0 };

  constructor() {
    this.material = new MeshBasicMaterial({
      color: new Color(1, 1, 1),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vFace;\nvarying float vAlong;',
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          vAlong = position.y;
          // 先ほど少し太く
          transformed.xz *= 1.0 + 0.6 * position.y;`,
        )
        .replace(
          '#include <project_vertex>',
          /* glsl */ `#include <project_vertex>
          vec3 kN = normalize(normalMatrix * normal);
          vFace = abs(dot(kN, normalize(-mvPosition.xyz)));`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vFace;\nvarying float vAlong;\nuniform float uTime;',
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          float kCore = pow(vFace, ${f(B.corePower)});
          float kFlow = 0.75 + 0.25 * sin(vAlong * 90.0 - uTime * ${f(B.flow * 6.2832)}) * sin(vAlong * 23.0 - uTime * 13.0);
          vec3 kC = mix(${vec(M.colors.beamOuter)} * 1.6, ${vec(M.colors.beamCore)} * 4.0, kCore);
          float kEnd = 1.0 - smoothstep(0.75, 1.0, vAlong);
          float kStart = smoothstep(0.0, 0.01, vAlong);
          diffuseColor.rgb = kC * kFlow;
          diffuseColor.a = (0.18 + 0.82 * kCore) * kEnd * kStart * (1.0 - 0.3 * vAlong);`,
        );
    };
    this.material.customProgramCacheKey = () => 'vorgas-beam';
    this.mesh = new Mesh(
      new CylinderGeometry(1, 1, 1, 16, 8, true).translate(0, 0.5, 0),
      this.material,
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  update(fx: KaijuEffectsView | null, visible: boolean, time: number): void {
    const b = fx?.beam;
    this.mesh.visible = visible && (b?.on ?? false);
    if (!b || !this.mesh.visible) return;
    this.uTime.value = time;
    const r =
      KAIJU_ATTACK_CONFIG.beam.width * M.beam.radiusScale * (1 + B.flicker * Math.sin(time * 53));
    dir.set(b.direction.x, b.direction.y, b.direction.z);
    quat.setFromUnitVectors(yAxis, dir);
    this.mesh.position.set(b.origin.x, b.origin.y, b.origin.z);
    this.mesh.quaternion.copy(quat);
    this.mesh.scale.set(r, b.length, r);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
