// 防衛戦（7-2）の敵の出し方（runner.ts から分けた。Three.js 非依存）: 来る方向の沖に横一列で出す。
// 戦闘機は既存の編隊（空きがなければ出さない）、爆撃機は施設の上を通る直線、巡航ミサイルは司令部への直線（組ごとに間隔を空ける）
import type { Rng } from '../../combat/gun';
import type { PatrolPoint } from '../../data/ai';
import {
  BOMBER_CONFIG,
  CRUISE_CONFIG,
  DEFENSE_CONFIG,
  FACILITY_KINDS,
  type DefenseApproach,
  type DefenseMapDef,
} from '../../data/defense';
import type { DefenseBase } from './base';
import type { DefenseWorld } from './runner';
import type { WaveSpawn } from './waves';

const DEG = Math.PI / 180;

/** 来る方向の単位ベクトル（基地から外向き）と、それに直交する横の向き */
function axes(approach: DefenseApproach): { ox: number; oz: number; rx: number; rz: number } {
  const b = approach.bearingDeg * DEG;
  const ox = Math.sin(b);
  const oz = -Math.cos(b);
  return { ox, oz, rx: -oz, rz: ox };
}

/** 横に並べる位置（0, +1, −1, +2, −2 …）× 間隔 */
function lateral(slot: number): number {
  const k = Math.ceil(slot / 2) * (slot % 2 === 1 ? 1 : -1);
  return k * DEFENSE_CONFIG.spawnSpacing;
}

export class DefenseSpawner {
  /** 組ごとの巡航ミサイルの次の発射時刻 */
  private readonly cruiseNext = new Map<number, number>();

  constructor(
    private readonly world: DefenseWorld,
    private readonly map: DefenseMapDef,
    private readonly base: DefenseBase,
    private readonly rng: Rng,
    private readonly preferAllies: boolean,
  ) {}

  /** 波の始まり */
  reset(): void {
    this.cruiseNext.clear();
  }

  /** 1 機出す。出した入れ物の番号（種類ごと。出せなければ −1） */
  spawn(s: WaveSpawn, approach: DefenseApproach, wave: number, waveTime: number): number {
    const c = DEFENSE_CONFIG;
    const { ox, oz, rx, rz } = axes(approach);
    const center = this.map.center;
    const lat = lateral(s.slot) + s.group * 60;
    const x = center.x + ox * c.spawnDistance + rx * lat;
    const z = center.z + oz * c.spawnDistance + rz * lat;
    const props = this.world.props;
    if (s.kind === 'fighter') {
      const y = s.escort ? BOMBER_CONFIG.altitude + 150 : c.fighterAltitude;
      const heading = Math.atan2(center.x - x, -(center.z - z)) / DEG;
      const index = this.world.squadron.deploy(
        { x, y, z, headingDeg: heading },
        this.patrol(approach),
        s.difficulty,
        this.preferAllies,
      );
      return index;
    }
    if (s.kind === 'bomber') {
      const i = props.bombers.findIndex((b) => !b.deployed);
      const b = props.bombers[i];
      if (!b) return -1;
      const target = this.bomberTarget();
      const site = this.base.sites[target];
      if (!site) return -1;
      // 目標から横へずらした線（並んで飛ぶ）。爆弾は目標の上を通る線の上に落とす
      const t = site.base;
      b.attack(
        { x, y: BOMBER_CONFIG.altitude, z },
        { x: t.x + rx * lat * 0.15, y: t.y, z: t.z + rz * lat * 0.15 },
        target,
        BOMBER_CONFIG.despawnDistance,
        wave,
      );
      return i;
    }
    // 巡航ミサイル: 同じ組は launchInterval ずつ空ける
    const next = this.cruiseNext.get(s.group) ?? 0;
    if (waveTime + 1e-9 < next) return -1;
    const i = props.cruiseMissiles.findIndex((m) => !m.deployed);
    const m = props.cruiseMissiles[i];
    if (!m) return -1;
    const hq = this.base.hq;
    const ground = Math.max(0, this.world.groundHeight(x, z));
    m.aim({ x, y: ground + CRUISE_CONFIG.altitude, z }, hq.position, hq.hitRadius, wave);
    this.cruiseNext.set(s.group, waveTime + CRUISE_CONFIG.launchInterval);
    return i;
  }

  /** 戦闘機の巡航の経路: 基地の上空を回る 4 点 */
  private patrol(approach: DefenseApproach): PatrolPoint[] {
    const c = DEFENSE_CONFIG;
    const center = this.map.center;
    const out: PatrolPoint[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (approach.bearingDeg + k * 90) * DEG;
      out.push({
        x: center.x + Math.sin(a) * c.fighterOrbitRadius,
        y: c.fighterOrbitAltitude,
        z: center.z - Math.cos(a) * c.fighterOrbitRadius,
      });
    }
    return out;
  }

  /** 爆撃機の目標の施設: hqChance で司令部、それ以外は残っている施設から */
  private bomberTarget(): number {
    if (this.rng() < BOMBER_CONFIG.hqChance) return 0;
    const alive: number[] = [];
    for (let i = 1; i < FACILITY_KINDS.length; i++) if (this.base.sites[i]?.active) alive.push(i);
    if (alive.length === 0) return 0;
    return alive[Math.floor(this.rng() * alive.length) % alive.length] ?? 0;
  }

}
