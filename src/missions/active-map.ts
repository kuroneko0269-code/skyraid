// 今のマップ（6-4。Three.js 非依存）: 地形の高さ関数・街（配置と壊れる状態）を持ち、マップを切り替えると作り直す。
// 機体・敵・武器・怪獣に渡す地面の高さは ground（切り替えても同じ関数。中で今のマップを引く）。
// 爆弾・ロケットの着弾は ordnanceGround（立っている建物の屋根・壁でも起爆）。描画は onChange で地形・街を作り直す
import { BuildingField } from '../combat/buildings';
import { findMap, ISLAND_MAP, type MapDef } from '../data/maps';
import type { GroundHeightFn } from '../entities/aircraft';
import { generateCity, type CityLayout } from '../render/city/layout';
import { createHeightField, defaultHeightField, type HeightField } from '../render/terrain-height';

export interface LoadedMap {
  readonly def: MapDef;
  readonly field: HeightField;
  readonly city: CityLayout | null;
  readonly buildings: BuildingField | null;
  /** 地形（浸食込み）と街の生成にかかった時間（ms） */
  readonly terrainMs: number;
  readonly cityMs: number;
}

/** マップを作る。島は起動時に作った既定の高さ関数を使い回す（作り直さない） */
export function loadMap(def: MapDef): LoadedMap {
  const t0 = performance.now();
  const field = def.id === ISLAND_MAP.id ? defaultHeightField : createHeightField(def.terrain);
  const t1 = performance.now();
  const city = def.city ? generateCity() : null;
  const t2 = performance.now();
  return {
    def,
    field,
    city,
    buildings: city ? new BuildingField(city) : null,
    terrainMs: t1 - t0,
    cityMs: t2 - t1,
  };
}

export class ActiveMap {
  private loaded: LoadedMap;
  private readonly listeners: ((m: LoadedMap, previous: LoadedMap) => void)[] = [];

  /** 地表の高さ（海の上は海面）。今のマップを引く（切り替えても同じ関数を渡しておける） */
  readonly ground: GroundHeightFn = (x, z) => this.loaded.field.getGroundHeight(x, z);
  /** 地形の高さ（海の下は負） */
  readonly height: GroundHeightFn = (x, z) => this.loaded.field.getHeight(x, z);
  /** 爆弾・ロケットの着弾の高さ: 地表と、立っている建物の屋根の高い方 */
  readonly ordnanceGround: GroundHeightFn = (x, z) => {
    const g = this.loaded.field.getGroundHeight(x, z);
    const b = this.loaded.buildings;
    return b ? Math.max(g, b.topAt(x, z)) : g;
  };

  constructor(initial: MapDef = ISLAND_MAP) {
    this.loaded = loadMap(initial);
  }

  get current(): LoadedMap {
    return this.loaded;
  }

  get def(): MapDef {
    return this.loaded.def;
  }

  get buildings(): BuildingField | null {
    return this.loaded.buildings;
  }

  /** 地形・街を作り直したとき（previous は捨てたマップ。描画が破棄に使う） */
  onChange(fn: (m: LoadedMap, previous: LoadedMap) => void): void {
    this.listeners.push(fn);
  }

  /** マップを id のものにする。同じマップなら建物を建て直すだけ（作り直さない）。作り直したら true */
  use(id: string): boolean {
    const def = findMap(id);
    if (def.id === this.loaded.def.id) {
      this.loaded.buildings?.reset();
      return false;
    }
    const previous = this.loaded;
    this.loaded = loadMap(def);
    for (const fn of this.listeners) fn(this.loaded, previous);
    return true;
  }
}
