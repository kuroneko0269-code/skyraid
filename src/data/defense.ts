// 防衛戦（7-2）の数値: 基地（施設の配置・司令部の HP）、敵の来る方向、補給の条件、新しい敵（爆撃機・巡航ミサイル・爆弾）、
// 人数と難易度のスケール、報酬。波の構成は src/data/defense-waves.ts。ロジックは src/missions/defense/（Three.js 非依存）。
// 距離は m、時間は秒、速度は m/s。座標は北 −Z・南 +Z・東 +X
import type { BlastSpec } from './ground-targets';

export const DEFENSE_DIFFICULTIES = ['normal', 'hard'] as const;
export type DefenseDifficulty = (typeof DEFENSE_DIFFICULTIES)[number];

/** 施設の種類（司令部は防衛対象。ほかは壊れると不利） */
export const FACILITY_KINDS = ['hq', 'radar', 'fuel', 'aaa1', 'aaa2'] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];

/** 敵の来る方向 1 つ（基地から見た方位。0 = 北、90 = 東） */
export interface DefenseApproach {
  readonly label: string;
  readonly bearingDeg: number;
}

export interface DefenseMapDef {
  readonly mapId: string;
  readonly name: string;
  /** 基地の中心（補給の円の中心） */
  readonly center: { readonly x: number; readonly z: number };
  /** 施設の位置（FACILITY_KINDS の順） */
  readonly facilities: Readonly<Record<FacilityKind, { readonly x: number; readonly z: number }>>;
  /** 敵の来る 3 方向（波ごとにランダムに 1 つ） */
  readonly approaches: readonly DefenseApproach[];
  /** 自機の開始位置（協力は ID 順に横一列）。機首は敵の来る側 */
  readonly start: { readonly x: number; readonly y: number; readonly z: number; readonly headingDeg: number };
}

/** 島: 基地は東岸（地表 10〜40m の低い所）。敵は東の海（北東・東・南東）から */
export const DEFENSE_ISLAND: DefenseMapDef = {
  mapId: 'island',
  name: '島（東岸の基地）',
  center: { x: 2500, z: 0 },
  facilities: {
    hq: { x: 2480, z: 0 },
    radar: { x: 2380, z: -220 },
    fuel: { x: 2560, z: 230 },
    aaa1: { x: 2680, z: -160 },
    aaa2: { x: 2660, z: 200 },
  },
  approaches: [
    { label: '北東', bearingDeg: 45 },
    { label: '東', bearingDeg: 90 },
    { label: '南東', bearingDeg: 135 },
  ],
  start: { x: 1700, y: 700, z: 0, headingDeg: 90 },
};

/** 港湾都市: 基地は港（街の東の岸壁、建物のない所）。敵は湾（南西・南・南東）から */
export const DEFENSE_HARBOR: DefenseMapDef = {
  mapId: 'harbor',
  name: '港湾都市（港の基地）',
  center: { x: 1520, z: 1250 },
  facilities: {
    hq: { x: 1500, z: 1300 },
    radar: { x: 1400, z: 1080 },
    fuel: { x: 1660, z: 1120 },
    aaa1: { x: 1360, z: 1420 },
    aaa2: { x: 1700, z: 1400 },
  },
  approaches: [
    { label: '南西', bearingDeg: 225 },
    { label: '南', bearingDeg: 180 },
    { label: '南東', bearingDeg: 135 },
  ],
  start: { x: 1520, y: 700, z: 400, headingDeg: 180 },
};

export const DEFENSE_MAPS: readonly DefenseMapDef[] = [DEFENSE_ISLAND, DEFENSE_HARBOR];

export function findDefenseMap(mapId: string): DefenseMapDef {
  return DEFENSE_MAPS.find((m) => m.mapId === mapId) ?? DEFENSE_ISLAND;
}

export const DEFENSE_CONFIG = {
  /** 全 10 波 */
  waves: 10,
  /** 司令部の HP（通常 / 高難度） */
  hqMaxHp: { normal: 2000, hard: 1500 } satisfies Record<DefenseDifficulty, number>,
  /** 敵の数の倍率（高難度は ×1.3） */
  enemyScale: { normal: 1, hard: 1.3 } satisfies Record<DefenseDifficulty, number>,
  /** 協力の人数スケール: 数 × (base + perPlayer × 人数)。1 人で 1 */
  coopScale: { base: 0.6, perPlayer: 0.4 },
  /** 波の前の準備時間（最初の波の前も）。スキップできる */
  intermissionSeconds: 20,
  /** 敵が出る距離（基地の中心から、来る方向へ）と、横に並べる間隔 */
  spawnDistance: 8000,
  spawnSpacing: 180,
  /** 戦闘機の出る高度・基地の上で回る半径と高度 */
  fighterAltitude: 1100,
  fighterOrbitRadius: 1500,
  fighterOrbitAltitude: 900,
  /** 戦闘機を同時に出せる数（ソロの FlightSession の編隊の数・協力のホストの世界の数）。超えた分は空くまで待つ */
  soloFighterPool: 8,
  /**
   * 戦闘機は出てから retreatSeconds たつと撤退する（どの味方からも retreatClearance より離れているときに消える。
   * 撃墜にならない）。最後の 1 機との空戦で波が長引かないように
   */
  fighterRetreatSeconds: 90,
  fighterRetreatClearance: 1500,
  /** これを過ぎたら味方の近くでも撤退する */
  fighterRetreatHardSeconds: 150,
  hostFighterPool: 12,
  /** 補給: 波の間に、基地の中心から水平 radius 以内を、地表から maxAgl 以下・速度 maxSpeed 以下で通る */
  supply: { radius: 600, maxAgl: 300, maxSpeed: 150 },
  /** 燃料タンクを失うと、補給は各武装の半分（切り上げ）だけ */
  supplyWithoutFuel: 0.5,
  /** 報酬（CR）: クリアした波 × perWave、完全クリア +fullClear、施設（司令部以外の 4 つ）が全部残っていれば +allFacilities */
  reward: { perWave: 300, fullClear: 2000, allFacilities: 1000 },
  /** HUD の「司令部被弾」の音の間引き */
  hqHitSoundInterval: 0.5,
} as const;

/** 爆撃機: 直進して基地に爆弾を落とす。旋回しない。通り過ぎたら基地から despawnDistance で離脱（撃墜にならない） */
export const BOMBER_CONFIG = {
  speed: 140,
  altitude: 700,
  maxHp: 350,
  hitRadius: 14,
  visualRadius: 16,
  /** 1 回の投下で落とす数と間隔（目標を中心に前後へ散らす） */
  bombs: 3,
  bombInterval: 0.3,
  despawnDistance: 9000,
  hitFlashSeconds: 0.08,
  /** 爆撃機の目標: この確率で司令部、それ以外は残っている施設からランダム */
  hqChance: 0.6,
  /** 同時に出せる数 */
  maxCount: 10,
} as const;

/** 爆撃機の爆弾の範囲ダメージ（施設・自機。敵には入らない） */
export const ENEMY_BOMB_BLAST: BlastSpec = { radius: 40, maxDamage: 80, edgeFraction: 0.5 };

export const ENEMY_BOMB_CONFIG = {
  gravity: 9.8,
  /** 同時に飛ぶ数の上限 */
  maxCount: 48,
} as const;

/** 巡航ミサイル: 低空を司令部へ直進。撃墜しないと司令部に damage。小さく速い */
export const CRUISE_CONFIG = {
  speed: 230,
  altitude: 60,
  maxHp: 30,
  hitRadius: 4,
  visualRadius: 3,
  damage: 300,
  /** 同じ組の発射の間隔 */
  launchInterval: 1.2,
  hitFlashSeconds: 0.08,
  maxCount: 16,
} as const;
