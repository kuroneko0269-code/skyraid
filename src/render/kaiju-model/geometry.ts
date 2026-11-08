// 10-7e: ヴォルガスの形をまとめる: 6-1 の部位ごとの皮膚（胴・頭・腕・脚・尾）と背の骨板を 1 つのジオメトリにし（描く回数 5 → 1。
// 影の描く回数も同じ）、頂点に部位の番号（aPart）を持たせる（壊れた部位の亀裂だけ消すのは uniform の配列で）。結晶は別（半透明）
import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Uint16BufferAttribute,
} from 'three';
import type { AircraftDetail } from '../../data/aircraft-model';
import { KAIJU_MODEL_CONFIG } from '../../data/kaiju-model';
import { toKaijuTier, type KaijuTier } from '../../data/kaiju-look';
import { VORGAS_VISUAL } from '../../data/vorgas-visual';
import type { KaijuMeshBuilder } from './builder';
import { buildArms, buildCrystals, buildHead, buildLegs, buildTail, buildTorso } from './parts';
import { buildScutes } from './scutes';

/** 皮膚の部位（aPart の番号の順）と、部位 HP の部位（KAIJU_PARTS の番号。腕は無し・脚は左右の 2 つ） */
export const SKIN_PARTS = [
  { build: buildTorso, part: 1 },
  { build: buildHead, part: 0 },
  { build: buildArms, part: -1 },
  { build: buildLegs, part: 2 },
  { build: buildTail, part: 4 },
] as const;

/** 位置・法線・色・発光・骨（aRest は使わない。静止姿勢の位置は position のまま） */
const KEEP = ['position', 'normal', 'color', 'aGlow', 'skinWeight'] as const;

/** ジオメトリを 1 つにまとめる（part は頂点ごとの aPart） */
export function mergeSkin(list: readonly { g: BufferGeometry; part: number }[]): BufferGeometry {
  let verts = 0;
  let idx = 0;
  for (const { g } of list) {
    verts += g.getAttribute('position').count;
    idx += g.index?.count ?? 0;
  }
  const out = new BufferGeometry();
  for (const name of KEEP) {
    const size = list[0]?.g.getAttribute(name).itemSize ?? 1;
    const arr = new Float32Array(verts * size);
    let o = 0;
    for (const { g } of list) {
      const a = g.getAttribute(name);
      for (let i = 0; i < a.count * size; i++) arr[o++] = a.array[i] ?? 0;
    }
    out.setAttribute(name, new Float32BufferAttribute(arr, size));
  }
  const si = new Uint16Array(verts * 4);
  const part = new Float32Array(verts);
  const index = verts > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
  let vo = 0;
  let io = 0;
  for (const { g, part: p } of list) {
    const a = g.getAttribute('skinIndex');
    for (let i = 0; i < a.count * 4; i++) si[vo * 4 + i] = a.array[i] ?? 0;
    const n = g.getAttribute('position').count;
    part.fill(p, vo, vo + n);
    const gi = g.index;
    if (gi) for (let i = 0; i < gi.count; i++) index[io++] = (gi.array[i] ?? 0) + vo;
    vo += n;
  }
  out.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
  out.setAttribute('aPart', new Float32BufferAttribute(part, 1));
  out.setIndex(new BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

export interface VorgasGeometries {
  /** 皮膚（部位 5 つ + 骨板）を 1 つに */
  readonly skin: BufferGeometry;
  readonly crystals: BufferGeometry;
  /** 骨板だけ（無ければ null。テストで今の体の面からの距離を測る） */
  readonly scutes: BufferGeometry | null;
  readonly triangles: number;
}

/** 全部位のジオメトリ（機体の細かさ（9-6a）か見た目の段。骨板は段の scutes） */
export function buildKaijuGeometries(detail: AircraftDetail | KaijuTier): VorgasGeometries {
  const tier = toKaijuTier(detail);
  const d = KAIJU_MODEL_CONFIG.detail[tier === 'low' ? 'low' : 'high'];
  let triangles = 0;
  const done = (b: KaijuMeshBuilder): BufferGeometry => {
    triangles += b.triangleCount;
    return b.build();
  };
  const list = SKIN_PARTS.map((p, i) => ({ g: done(p.build(d)), part: i }));
  const scutes = VORGAS_VISUAL.tiers[tier].scutes ? done(buildScutes(d)) : null;
  if (scutes) list.push({ g: scutes, part: 0 });
  const skin = mergeSkin(list);
  for (const { g } of list) if (g !== scutes) g.dispose();
  const crystals = done(buildCrystals(d));
  return { skin, crystals, scutes, triangles };
}
