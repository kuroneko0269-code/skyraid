// セーブデータの塗装の部分（7-3。v8 から。Three.js・DOM 非依存）: 所持パターン・所持デカール・PvP の累計撃墜・
// 機体ごとの今の塗装。save.ts が 300 行を超えないよう分けた
import { findAircraftModel } from '../data/aircraft';
import {
  DECAL_IDS,
  SKIN_PATTERNS,
  SKIN_PATTERN_IDS,
  type DecalId,
  type SkinPatternId,
} from '../data/skins';
import { defaultPaint, normalizePaint, type Paint } from './paint';

export interface SaveSkins {
  /** 持っている塗装パターン（全機体共通。価格 0 のパターンは常に持っている） */
  patterns: SkinPatternId[];
  /** 持っているデカール（全機体共通） */
  decals: DecalId[];
  /** PvP（個人戦・チーム戦）の累計撃墜（海洋迷彩の解放条件） */
  pvpKills: number;
  /** 機体 id → 今の塗装（まだ塗っていない機体はない。初めて使うときに機体番号をランダムで決めて足す） */
  paints: Record<string, Paint>;
}

export function freePatterns(): SkinPatternId[] {
  return SKIN_PATTERNS.filter((p) => p.price === 0).map((p) => p.id);
}

export function defaultSkins(): SaveSkins {
  return { patterns: freePatterns(), decals: [], pvpKills: 0, paints: {} };
}

/** 読み込んだ値を確かめる（壊れた項目は捨てる・初期値に直す） */
export function normalizeSkins(v: unknown): SaveSkins {
  const out = defaultSkins();
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  const d = v as Record<string, unknown>;
  const list = (x: unknown): readonly unknown[] => (Array.isArray(x) ? (x as unknown[]) : []);
  for (const id of list(d.patterns)) {
    const p = SKIN_PATTERN_IDS.find((k) => k === id);
    if (p && !out.patterns.includes(p)) out.patterns.push(p);
  }
  for (const id of list(d.decals)) {
    const k = DECAL_IDS.find((x) => x === id);
    if (k && !out.decals.includes(k)) out.decals.push(k);
  }
  if (typeof d.pvpKills === 'number' && Number.isFinite(d.pvpKills))
    out.pvpKills = Math.min(1_000_000, Math.max(0, Math.floor(d.pvpKills)));
  if (typeof d.paints === 'object' && d.paints !== null && !Array.isArray(d.paints)) {
    for (const [id, p] of Object.entries(d.paints)) {
      const model = findAircraftModel(id);
      if (!model) continue;
      const fallback = defaultPaint(model.shape, 0);
      out.paints[id] = normalizePaint(p, fallback);
    }
  }
  return out;
}
