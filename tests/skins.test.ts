// スキン・デカール（7-3）: 価格と解放条件・セーブ v7 → v8・塗装の直列化（16 バイト以内）・全パターン × 4 機種のテクスチャ
// 生成（例外なし。時間の計測は 8-1 で `npm run bench`（scripts/bench-skins.ts）に移した）・性能に影響しないこと（loadout が塗装で変わらない）・機体の塗装の UV
import { describe, expect, it } from 'vitest';
import { AIRCRAFT_MODELS } from '../src/data/aircraft';
import { COURSES } from '../src/data/courses';
import { MISSIONS } from '../src/data/missions';
import { SAVE_CONFIG } from '../src/data/save';
import { SKIN_TEXTURE } from '../src/data/skin-texture';
import {
  DECALS,
  DECAL_IDS,
  SKIN_CONFIG,
  SKIN_PALETTE,
  SKIN_PATTERNS,
  SKIN_PATTERN_IDS,
} from '../src/data/skins';
import { ByteReader, ByteWriter } from '../src/net/codec';
import { readPaint, writePaint } from '../src/net/codec-lobby';
import { netLoadout } from '../src/net/loadout';
import { Hangar } from '../src/progression/hangar';
import {
  PAINT_BYTES,
  decodePaint,
  defaultPaint,
  encodePaint,
  paintFromHex,
  paintToHex,
  type Paint,
} from '../src/progression/paint';
import { Paintshop, isSkinUnlocked } from '../src/progression/paintshop';
import { createInitialSave, migrateSave } from '../src/progression/save';
import { SaveStore } from '../src/progression/save-store';
import { buildAircraft } from '../src/render/aircraft-model/build';
import { decalShape, shapePath } from '../src/render/skin/decal-shapes';
import { rasterizeShape } from '../src/render/skin/decal-raster';
import { clearSkinCache, paintSkinPixels, skinPixelCount } from '../src/render/skin/skin-texture';

function store(credits = 0): SaveStore {
  const s = SaveStore.open(null).store;
  s.transact((d) => {
    d.credits = credits;
    for (const m of AIRCRAFT_MODELS)
      d.aircraft.owned[m.id] = { engine: 2, airframe: 3, weapons: 1, avionics: 4 };
    return true;
  });
  return s;
}

const first = AIRCRAFT_MODELS[0];
if (!first) throw new Error('機体がありません');
const kestrel = first;

function fancyPaint(pattern: Paint['pattern'], decal: Paint['wing']['decal']): Paint {
  return {
    ...defaultPaint(kestrel.shape, 42),
    pattern,
    base: 9,
    accent: 5,
    marking: 7,
    wing: { decal, x: 30, y: 220, size: 255, rotation: 40 },
    fin: { decal, x: 200, y: 20, size: 0, rotation: 250 },
  };
}

describe('7-3 価格と解放条件', () => {
  it('パターンは単色（最初から）以外 1,500〜4,000 CR、デカールは 500 CR、色は 12 色', () => {
    expect(SKIN_PATTERNS).toHaveLength(8);
    for (const p of SKIN_PATTERNS) {
      if (p.id === 'solid') expect(p.price).toBe(0);
      else {
        expect(p.price).toBeGreaterThanOrEqual(1500);
        expect(p.price).toBeLessThanOrEqual(4000);
      }
    }
    expect(DECALS).toHaveLength(10);
    for (const d of DECALS) expect(d.price).toBe(500);
    expect(SKIN_PALETTE).toHaveLength(12);
    // 4 機種の元の色はパレットにある（初期の塗装が 4-3 の見た目のまま）
    for (const m of AIRCRAFT_MODELS) {
      expect(SKIN_PALETTE.some((c) => c.hex === m.shape.bodyColor)).toBe(true);
      expect(SKIN_PALETTE.some((c) => c.hex === m.shape.accentColor)).toBe(true);
    }
  });

  it('金属地は全ミッション S、海洋迷彩は PvP 10 撃墜、ストライプはレース 4 コース全部 A 以上', () => {
    const save = createInitialSave();
    const metal = SKIN_PATTERNS.find((p) => p.id === 'metal')?.unlock ?? null;
    const ocean = SKIN_PATTERNS.find((p) => p.id === 'camoOcean')?.unlock ?? null;
    const stripe = SKIN_PATTERNS.find((p) => p.id === 'stripe')?.unlock ?? null;
    expect(isSkinUnlocked(metal, save)).toBe(false);
    expect(isSkinUnlocked(ocean, save)).toBe(false);
    expect(isSkinUnlocked(stripe, save)).toBe(false);
    for (const [i, m] of MISSIONS.entries())
      save.missions[m.id] = { unlocked: true, bestRank: i === 0 ? 'A' : 'S' };
    expect(isSkinUnlocked(metal, save)).toBe(false);
    for (const m of MISSIONS) save.missions[m.id] = { unlocked: true, bestRank: 'S' };
    expect(isSkinUnlocked(metal, save)).toBe(true);
    save.skins.pvpKills = 9;
    expect(isSkinUnlocked(ocean, save)).toBe(false);
    save.skins.pvpKills = 10;
    expect(isSkinUnlocked(ocean, save)).toBe(true);
    // 9-8: 対象は初めの 4 本のまま（新しいコースは条件に入らない）
    const first4 = COURSES.slice(0, 4);
    expect(first4.map((c) => c.id)).toEqual(['coast', 'canyon', 'harbor-speed', 'acro']);
    for (const [i, c] of first4.entries())
      save.races[c.id] = { bestRank: i === 0 ? 'B' : 'A', clears: 1, times: [], ghost: null };
    expect(isSkinUnlocked(stripe, save)).toBe(false);
    for (const c of first4) save.races[c.id] = { bestRank: 'S', clears: 1, times: [], ghost: null };
    expect(isSkinUnlocked(stripe, save)).toBe(true);
  });

  it('購入: 残高不足・未解放・所持済みは何も変えない。買えば残高が減り全機体共通で持つ', () => {
    const s = store(1000);
    const shop = new Paintshop(s);
    expect(shop.patternStatus('solid')).toBe('owned');
    expect(shop.buyPattern('twoTone')).toBe('insufficient');
    expect(shop.buyPattern('metal')).toBe('locked');
    expect(shop.buyDecal('star')).toBe('ok');
    expect(s.credits).toBe(500);
    expect(shop.buyDecal('star')).toBe('owned');
    s.transact((d) => ((d.credits = 10_000), true));
    expect(shop.buyPattern('twoTone')).toBe('ok');
    expect(s.credits).toBe(8500);
    expect(shop.patternStatus('twoTone')).toBe('owned');
    shop.addPvpKills(4);
    shop.addPvpKills(6);
    expect(s.snapshot.skins.pvpKills).toBe(10);
    expect(shop.buyPattern('camoOcean')).toBe('ok');
    expect(s.credits).toBe(5500);
  });

  it('持っていないパターン・デカールの塗装は保存しない。初期の塗装は機体番号がランダムで保存される', () => {
    const s = store(0);
    const shop = new Paintshop(s, () => 0.374);
    const p = shop.paint('swift');
    expect(p.number).toBe(37);
    expect(p.pattern).toBe('solid');
    expect(s.snapshot.skins.paints.swift?.number).toBe(37);
    expect(shop.setPaint('swift', { ...p, pattern: 'metal' })).toBe(false);
    expect(shop.setPaint('swift', { ...p, wing: { ...p.wing, decal: 'bolt' } })).toBe(false);
    expect(shop.setPaint('swift', { ...p, base: 11, number: 5 })).toBe(true);
    expect(shop.paint('swift').base).toBe(11);
    expect(shop.paint('swift').number).toBe(5);
  });
});

describe('7-3 性能に影響しない', () => {
  it('塗装・購入で loadout（飛行・武装の数値）が変わらない', () => {
    const s = store(100_000);
    const hangar = new Hangar(s, () => true);
    const shop = new Paintshop(s);
    const before = AIRCRAFT_MODELS.map((m) => hangar.loadout(m.id));
    const net = AIRCRAFT_MODELS.map((m) => netLoadout(m.id, hangar.levels(m.id)));
    for (const id of ['twoTone', 'splitter', 'camoForest', 'camoDesert'] as const)
      expect(shop.buyPattern(id)).toBe('ok');
    for (const id of DECAL_IDS) expect(shop.buyDecal(id)).toBe('ok');
    for (const m of AIRCRAFT_MODELS) {
      const p = fancyPaint('splitter', 'bolt');
      expect(shop.setPaint(m.id, p)).toBe(true);
    }
    expect(AIRCRAFT_MODELS.map((m) => hangar.loadout(m.id))).toEqual(before);
    expect(AIRCRAFT_MODELS.map((m) => netLoadout(m.id, hangar.levels(m.id)))).toEqual(net);
  });
});

describe('7-3 セーブ v7 → v8', () => {
  it('v7 のデータに塗装（単色だけ所持・撃墜 0・塗装なし）を足す。ほかはそのまま', () => {
    expect(SAVE_CONFIG.version).toBe(10);
    const v8 = createInitialSave();
    const v7: Record<string, unknown> = { ...v8, version: 7, credits: 777, pilotName: 'ACE' };
    delete v7.skins;
    const save = migrateSave(v7);
    expect(save?.version).toBe(SAVE_CONFIG.version);
    expect(save?.credits).toBe(777);
    expect(save?.pilotName).toBe('ACE');
    expect(save?.skins).toEqual({ patterns: ['solid'], decals: [], pvpKills: 0, paints: {} });
  });

  it('v8 の壊れた値は捨てる・直す（知らないパターン・機体・範囲外の色）', () => {
    const v8 = createInitialSave() as unknown as Record<string, unknown>;
    v8.skins = {
      patterns: ['metal', 'nope', 'metal'],
      decals: ['star', 3],
      pvpKills: -5,
      paints: {
        kestrel: {
          pattern: 'stripe',
          base: 99,
          accent: 3,
          number: 120,
          wing: { decal: 'bird', x: 300 },
        },
        ghost: { pattern: 'solid' },
      },
    };
    const save = migrateSave(v8);
    expect(save?.skins.patterns).toEqual(['solid', 'metal']);
    expect(save?.skins.decals).toEqual(['star']);
    expect(save?.skins.pvpKills).toBe(0);
    expect(Object.keys(save?.skins.paints ?? {})).toEqual(['kestrel']);
    const k = save?.skins.paints.kestrel;
    expect(k?.pattern).toBe('stripe');
    expect(k?.accent).toBe(3);
    expect(k?.base).toBe(defaultPaint(kestrel.shape, 0).base);
    expect(k?.number).toBe(0);
    expect(k?.wing.decal).toBe('bird');
    expect(k?.wing.x).toBe(SKIN_CONFIG.defaultPlacement.wing.x);
  });
});

describe('7-3 塗装の直列化', () => {
  it('14 バイト（1 人 16 バイト以内）で往復する', () => {
    expect(PAINT_BYTES).toBeLessThanOrEqual(16);
    for (const pattern of SKIN_PATTERN_IDS) {
      for (const decal of [null, ...DECAL_IDS]) {
        const p = fancyPaint(pattern, decal);
        const bytes = encodePaint(p);
        expect(bytes.length).toBe(PAINT_BYTES);
        expect(decodePaint(bytes)).toEqual(p);
        expect(paintFromHex(paintToHex(p))).toEqual(p);
      }
    }
  });

  it('通信の名簿に書くと 16 バイト以内・読むと同じ値。壊れた値は読めない / 既定値', () => {
    const p = fancyPaint('metal', 'number');
    const w = new ByteWriter();
    writePaint(w, p);
    const buf = w.finish();
    expect(buf.byteLength).toBeLessThanOrEqual(16);
    expect(readPaint(new ByteReader(buf))).toEqual(p);
    const bad = encodePaint(p);
    bad[0] = 200;
    expect(decodePaint(bad)).toBeNull();
    expect(decodePaint(new Uint8Array(3))).toBeNull();
    expect(paintFromHex('zz')).toBeNull();
    expect(paintFromHex(undefined)).toBeNull();
  });
});

describe('7-3 テクスチャの生成', () => {
  it('全パターン × 4 機種（デカールあり）が例外なく作れて、不透明に塗りつぶされる（時間は npm run bench）', () => {
    const out = new Uint8Array(skinPixelCount());
    for (const m of AIRCRAFT_MODELS) {
      for (const [i, pattern] of SKIN_PATTERN_IDS.entries()) {
        const decal = DECAL_IDS[i % DECAL_IDS.length] ?? null;
        const p = { ...fancyPaint(pattern, decal), number: (i * 13) % 100 };
        clearSkinCache();
        paintSkinPixels(m.shape, p, out);
        for (let i = 0; i * 4 < out.length; i += 1021) expect(out[i * 4 + 3]).toBe(255);
      }
    }
  });

  it('同じ塗装なら同じ画素（決定的）。色・デカール・番号を変えると画素が変わる', () => {
    const a = paintSkinPixels(kestrel.shape, fancyPaint('camoForest', 'claws'));
    const b = paintSkinPixels(kestrel.shape, fancyPaint('camoForest', 'claws'));
    const same = (x: Uint8Array, y: Uint8Array): boolean =>
      x.length === y.length && x.every((v, i) => v === y[i]);
    expect(same(a, b)).toBe(true);
    const c = paintSkinPixels(kestrel.shape, { ...fancyPaint('camoForest', 'claws'), number: 1 });
    expect(same(c, a)).toBe(false);
    expect(a.length).toBe(SKIN_TEXTURE.width * SKIN_TEXTURE.height * 4);
  });

  it('デカール 10 種と数字の図形は空でなく、SVG のパスにもなる', () => {
    for (const id of DECAL_IDS) {
      const s = decalShape(id, 7);
      const m = rasterizeShape(s, 64);
      const covered = m.data.reduce((sum, v) => sum + v, 0) / (m.width * m.height);
      expect(covered).toBeGreaterThan(0.08);
      expect(covered).toBeLessThan(0.9);
      expect(shapePath(s)).toMatch(/^M/);
    }
  });
});

describe('7-3 機体の塗装の UV（draw call は増やさない）', () => {
  it('自機系は頂点の色を白にして uv1（0〜1）を持つ。三角形の数は敵機と同じ形で変わらない', () => {
    for (const m of AIRCRAFT_MODELS) {
      const plain = buildAircraft(m.shape, { detail: 'high', missiles: 4, mergeCanopy: false });
      const skin = buildAircraft(m.shape, {
        detail: 'high',
        missiles: 4,
        mergeCanopy: false,
        skinned: true,
      });
      expect(skin.triangles).toBe(plain.triangles);
      const uv1 = skin.body.getAttribute('uv1');
      expect(uv1.count).toBe(skin.body.getAttribute('position').count);
      for (let i = 0; i < uv1.count; i++) {
        expect(uv1.getX(i)).toBeGreaterThanOrEqual(0);
        expect(uv1.getX(i)).toBeLessThanOrEqual(1);
        expect(uv1.getY(i)).toBeGreaterThanOrEqual(0);
        expect(uv1.getY(i)).toBeLessThanOrEqual(1);
      }
      const color = skin.body.getAttribute('color');
      let white = 0;
      for (let i = 0; i < color.count; i++) if (color.getX(i) === 1 && color.getY(i) === 1) white++;
      expect(white / color.count).toBeGreaterThan(0.5);
    }
  });
});
