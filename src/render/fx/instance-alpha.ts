// インスタンスごとの不透明度（4-4）: InstancedMesh の色（instanceColor）に加えて、属性 aAlpha でインスタンスごとに
// 薄くする。MeshBasicMaterial / MeshStandardMaterial のシェーダーに onBeforeCompile で足す（draw call は増えない）
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  type InstancedMesh,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
} from 'three';

/** マテリアルの頂点シェーダーで aAlpha を受け、フラグメントで diffuseColor.a に掛ける */
export function useInstanceAlpha<M extends MeshBasicMaterial | MeshStandardMaterial>(
  material: M,
): M {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aAlpha;\nvarying float vInstanceAlpha;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceAlpha = aAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vInstanceAlpha;')
      .replace(
        '#include <alphamap_fragment>',
        '#include <alphamap_fragment>\ndiffuseColor.a *= vInstanceAlpha;',
      );
  };
  material.customProgramCacheKey = () => 'instance-alpha';
  return material;
}

/** InstancedMesh に aAlpha 属性（1 インスタンス 1 つ）を付けて返す */
export function addAlphaAttribute(mesh: InstancedMesh, capacity: number): InstancedBufferAttribute {
  const attr = new InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
  attr.setUsage(DynamicDrawUsage);
  mesh.geometry.setAttribute('aAlpha', attr);
  return attr;
}
