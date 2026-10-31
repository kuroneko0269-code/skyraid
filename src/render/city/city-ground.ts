// 街の地面と道路（6-4）: 街の範囲を覆う平らな板 1 枚（draw call 1）。道路・歩道・区画の地面・岸壁は
// layout.ts と同じ格子（中心線の間隔・幅・主要道路の間隔）からフラグメントシェーダーで描く。画像なし
import { Color, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { CITY_CONFIG } from '../../data/city';
import type { CityLayout } from './layout';

const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));
const rgb = (hex: number): string => {
  const c = new Color(hex);
  return `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`;
};

export function createCityGround(layout: CityLayout): Mesh {
  const c = CITY_CONFIG;
  const r = layout.rect;
  const margin = 30;
  const w = r.maxX - r.minX + margin * 2;
  const d = r.maxZ - r.minZ + margin;
  const geometry = new PlaneGeometry(w, d).rotateX(-Math.PI / 2);
  geometry.translate((r.minX + r.maxX) / 2, c.groundHeight + 0.2, r.minZ - margin + d / 2);
  const material = new MeshStandardMaterial({
    roughness: 0.92,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const rd = c.road;
  const nx = layout.roadX.length;
  const nz = layout.roadZ.length;
  const g = c.ground;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCityXZ;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvCityXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec2 vCityXZ;
        // 中心線 i の道路の半分の幅（主要道路は mainEvery 本ごとと最後の線）
        float cityHalf(float i, float n) {
          return (mod(i, ${f(rd.mainEvery)}) < 0.5 || i > n - 1.5) ? ${f(rd.mainWidth / 2)} : ${f(rd.width / 2)};
        }
        float cityHashG(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec2 p = vCityXZ;
        float portLine = ${f(layout.portLine)};
        float ix = clamp(floor((p.x - ${f(r.minX)}) / ${f(rd.spacing)} + 0.5), 0.0, ${f(nx - 1)});
        float lx = ${f(r.minX)} + ix * ${f(rd.spacing)};
        float hx = cityHalf(ix, ${f(nx)});
        bool mainX = hx > ${f(rd.width / 2 + 1)};
        float iz = clamp(floor((p.y - ${f(r.minZ)}) / ${f(rd.spacing)} + 0.5), 0.0, ${f(nz - 1)});
        float lz = ${f(r.minZ)} + iz * ${f(rd.spacing)};
        float hz = cityHalf(iz, ${f(nz)});
        float dX = abs(p.x - lx);
        float dZ = abs(p.y - lz);
        bool roadX = dX < hx && (p.y < portLine + ${f(rd.mainWidth / 2)} || mainX);
        bool roadZ = dZ < hz && p.y < portLine + ${f(rd.mainWidth / 2 + 1)};
        vec3 col = ${rgb(g.lot)} * (0.85 + 0.3 * cityHashG(floor(p / 9.0)));
        // 歩道（道路の縁から setback m）
        bool walkX = dX < hx + ${f(rd.setback)} && (p.y < portLine + ${f(rd.mainWidth / 2)} || mainX);
        bool walkZ = dZ < hz + ${f(rd.setback)} && p.y < portLine + ${f(rd.mainWidth / 2 + rd.setback)};
        if (walkX || walkZ) col = ${rgb(g.sidewalk)};
        // 倉庫の帯と岸壁はコンクリート
        if (p.y > portLine + ${f(rd.mainWidth / 2 + rd.setback)}) col = ${rgb(g.sidewalk)} * (0.8 + 0.15 * cityHashG(floor(p / 12.0)));
        if (roadX || roadZ) {
          col = ${rgb(g.asphalt)} * (0.92 + 0.12 * cityHashG(floor(p / 3.0)));
          // 中央の破線（主要道路）
          float dash = step(0.5, fract((roadX ? p.y : p.x) / 12.0));
          float center = roadX ? dX : dZ;
          float hw = roadX ? hx : hz;
          if (hw > ${f(rd.width / 2 + 1)} && center < 0.35 && dash > 0.5 && !(roadX && roadZ)) col = ${rgb(g.line)};
        }
        diffuseColor.rgb = col;`,
      );
  };
  material.customProgramCacheKey = () => 'city-ground';
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'city-ground';
  return mesh;
}
