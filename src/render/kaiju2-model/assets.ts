// 10-7a: ネフィルガの形と絵を作る（9-6a の buildKaiju2Geometries を kaiju2-object.ts から移した）: 皮膚と膜のジオメトリ
// （膜は絵の座標 uv 付き）と、見た目の段ごとの絵（起動時に作って使い回す）
import { Float32BufferAttribute, type BufferGeometry, type DataTexture } from 'three';
import type { AircraftDetail } from '../../data/aircraft-model';
import { KAIJU2_MODEL_CONFIG } from '../../data/kaiju2-model';
import type { Kaiju2Tier } from '../../data/kaiju2-visual';
import { buildKaiju2Membrane, buildKaiju2Skin } from './parts';
import { buildKaiju2MembranePixels, buildKaiju2SkinPixels, makeKaiju2Texture } from './textures';

const M = KAIJU2_MODEL_CONFIG;

/** 皮膚と膜のジオメトリ（テストで三角形を数える）。extra は 10-7a のとげの作り込み（高画質だけ） */
export function buildKaiju2Geometries(
  detail: AircraftDetail,
  extra = false,
): {
  skin: BufferGeometry;
  membrane: BufferGeometry;
  triangles: number;
} {
  const d = M.detail[detail];
  const s = buildKaiju2Skin(d, extra);
  const m = buildKaiju2Membrane(d);
  const membrane = m.builder.build();
  membrane.setAttribute('uv', new Float32BufferAttribute(m.uv, 2));
  return {
    skin: s.build(),
    membrane,
    triangles: s.triangleCount + m.builder.triangleCount,
  };
}

/** 段ごとの絵（作ったら使い回す。一辺 0 は作らない） */
const textureCache = new Map<number, { skin: DataTexture; membrane: DataTexture }>();
export function kaiju2Textures(size: number): { skin: DataTexture; membrane: DataTexture } | null {
  if (size <= 0) return null;
  let t = textureCache.get(size);
  if (!t) {
    t = {
      skin: makeKaiju2Texture(buildKaiju2SkinPixels(size), size, true),
      membrane: makeKaiju2Texture(buildKaiju2MembranePixels(size), size, false),
    };
    textureCache.set(size, t);
  }
  return t;
}

/** 画質の機体の細かさ（9-6a）か見た目の段 */
export function toTier(d: AircraftDetail | Kaiju2Tier): Kaiju2Tier {
  return d === 'low' ? 'low' : d === 'medium' ? 'medium' : 'high';
}
