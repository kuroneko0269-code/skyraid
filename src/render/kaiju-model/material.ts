// 怪獣の結晶のマテリアル（6-1b）: 半透明の MeshPhysicalMaterial（反射・クリアコート）で、正面を向く面と根元ほど強く光る
// （内側が光って見える）。熱線の前に明るくなる。皮膚は 10-7e で skin-material.ts へ移した
import { Color, MeshPhysicalMaterial, type MeshStandardMaterial } from 'three';
import { KAIJU_MODEL_CONFIG } from '../../data/kaiju-model';

const M = KAIJU_MODEL_CONFIG;

/**
 * 結晶（6-1b）: 半透明の青い結晶。屈折率・クリアコートの反射で硬い面を出し（transmission は使わない）、
 * 発光は「正面を向く面ほど・根元（aGlow）ほど強い」= 縁が暗く芯が光る。明るさは setCrystalGlow で毎フレーム
 */
export function createCrystalMaterial(): MeshPhysicalMaterial {
  const look = M.crystalLook;
  const material = new MeshPhysicalMaterial({
    vertexColors: true,
    roughness: look.roughness,
    metalness: 0,
    ior: look.ior,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    transparent: true,
    opacity: look.opacity,
    emissive: new Color(M.colors.crystalGlow),
    emissiveIntensity: M.crystal.idle,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGlow;\nvarying float vCore;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCore = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCore;')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float kFacing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
        float kInner = ${look.edge.toFixed(3)} + pow(kFacing, ${look.innerPower.toFixed(3)}) * vCore;
        totalEmissiveRadiance *= kInner;`,
      );
  };
  material.customProgramCacheKey = () => 'kaiju-crystal';
  return material;
}

/** 結晶の明るさ（glow 0.15 が常時、1 が熱線の直前。壊れていれば暗く） */
export function setCrystalGlow(m: MeshStandardMaterial, glow: number, broken: boolean): void {
  const c = M.crystal;
  const k = Math.max(0, (glow - 0.15) / 0.85);
  m.emissiveIntensity = (c.idle + (c.max - c.idle) * k) * (broken ? c.brokenScale : 1);
}
