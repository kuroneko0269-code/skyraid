// 防衛戦（7-2）の基地: 司令部（防衛対象）・レーダー・燃料タンク・対空砲 2 基を MissionProps.baseTargets に味方として立てる。
// 施設の状態（残り HP・壊れたか）と、壊れたときの不利（レーダー: 予告が消える / 対空砲: 支援がなくなる / 燃料タンク: 補給が半分）を読む。
// 爆撃機の爆弾のダメージもここ（施設には範囲ダメージ。燃料タンクは壊れると周りの施設に誘爆）。Three.js 非依存
import { blastDamage } from '../../combat/blast';
import { TEAM_PLAYER } from '../../combat/target';
import {
  DEFENSE_CONFIG,
  FACILITY_KINDS,
  type DefenseDifficulty,
  type DefenseMapDef,
  type FacilityKind,
} from '../../data/defense';
import { FUEL_TANK_BLAST, type BlastSpec, type GroundTargetType } from '../../data/ground-targets';
import type { GroundTarget } from '../../entities/ground-target';

const TYPES: Readonly<Record<FacilityKind, GroundTargetType>> = {
  hq: 'command',
  radar: 'radar',
  fuel: 'fuelTank',
  aaa1: 'aaa',
  aaa2: 'aaa',
};

/** 施設の向き（見た目だけ。基地の中心を向く） */
function headingTo(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(to.x - from.x, -(to.z - from.z));
}

export class DefenseBase {
  constructor(readonly sites: readonly GroundTarget[]) {}

  /** 施設を立てる（HP 満タン）。司令部の HP は難易度で変わる */
  deploy(map: DefenseMapDef, difficulty: DefenseDifficulty): void {
    FACILITY_KINDS.forEach((kind, i) => {
      const g = this.sites[i];
      if (!g) return;
      const p = map.facilities[kind];
      g.deploy('base', TYPES[kind], p.x, p.z, 'normal', headingTo(p, map.center));
      g.configure(TEAM_PLAYER, kind === 'hq' ? DEFENSE_CONFIG.hqMaxHp[difficulty] : undefined);
    });
  }

  site(kind: FacilityKind): GroundTarget | undefined {
    return this.sites[FACILITY_KINDS.indexOf(kind)];
  }

  get hq(): GroundTarget {
    const g = this.sites[0];
    if (!g) throw new Error('司令部がない');
    return g;
  }

  alive(kind: FacilityKind): boolean {
    return this.site(kind)?.active ?? false;
  }

  /** 司令部以外の残っている施設の数 */
  get facilitiesAlive(): number {
    let n = 0;
    for (let i = 1; i < this.sites.length; i++) if (this.sites[i]?.active) n++;
    return n;
  }

  /** 施設の状態のビット（FACILITY_KINDS の順に 1 = 残っている） */
  get aliveBits(): number {
    let bits = 0;
    this.sites.forEach((g, i) => {
      if (g.active) bits |= 1 << i;
    });
    return bits;
  }

  /**
   * 範囲ダメージを施設に入れる（爆撃機の爆弾・燃料タンクの誘爆）。壊れた施設の番号を onLost に。
   * 燃料タンクが壊れたら周りの施設に誘爆する
   */
  applyBlast(
    x: number,
    y: number,
    z: number,
    spec: BlastSpec,
    onLost: (index: number) => void,
    onFuel: (x: number, y: number, z: number) => void,
  ): void {
    this.sites.forEach((g, i) => {
      if (!g.active) return;
      const p = g.position;
      const dist = Math.hypot(p.x - x, p.y - y, p.z - z) - g.hitRadius;
      const amount = blastDamage(spec, dist);
      if (amount <= 0) return;
      this.damage(i, amount, onLost, onFuel);
    });
  }

  /** 施設 1 つにダメージ（巡航ミサイルの司令部への着弾など） */
  damage(
    index: number,
    amount: number,
    onLost: (index: number) => void,
    onFuel: (x: number, y: number, z: number) => void,
  ): void {
    const g = this.sites[index];
    if (!g?.applyDamage(amount)) return;
    onLost(index);
    if (g.type === 'fuelTank') {
      const p = g.position;
      onFuel(p.x, p.y, p.z);
      this.applyBlast(p.x, p.y, p.z, FUEL_TANK_BLAST, onLost, onFuel);
    }
  }
}
