// ミッションの出現物のうち、敵機・的・ドローン以外（2-5）: 輸送機（護衛対象）・怪獣の仮実装・地上目標の仮置き。
// FlightSession が持ち、出現（spawn）・固定ステップ・ミッションの開始時の片付けをここにまとめる（Three.js 非依存）
import type { CombatTarget } from '../combat/target';
import { GROUND_TARGET_PLACEHOLDER_CONFIG, TRANSPORT_CONFIG } from '../data/mission-props';
import type { GroundHeightFn } from '../entities/aircraft';
import { GroundTargetPlaceholder } from '../entities/ground-target-placeholder';
import { KaijuPlaceholder } from '../entities/kaiju-placeholder';
import { Transport } from '../entities/transport';
import type { GroundTargetSpawn, KaijuSpawn, TransportSpawn } from './types';

/** 護衛対象の今の様子（MissionWorld.escort） */
export interface EscortState {
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  /** 経路の進み具合（0〜1） */
  readonly progress: number;
  readonly active: boolean;
}

export class MissionProps {
  readonly transports: Transport[];
  readonly kaiju: KaijuPlaceholder;
  readonly groundTargets: GroundTargetPlaceholder[];
  /** プレイヤーの敵側で、撃てる・ロックできるもの（怪獣・地上目標）。CombatSystem.allTargets に入れる */
  readonly hostileTargets: readonly CombatTarget[];

  constructor(groundHeight: GroundHeightFn = () => 0) {
    this.transports = Array.from({ length: TRANSPORT_CONFIG.maxCount }, () => new Transport());
    this.kaiju = new KaijuPlaceholder(groundHeight);
    this.groundTargets = Array.from(
      { length: GROUND_TARGET_PLACEHOLDER_CONFIG.maxCount },
      () => new GroundTargetPlaceholder(groundHeight),
    );
    this.hostileTargets = [this.kaiju, ...this.groundTargets];
  }

  /** 全部引っ込める（フリーフライト・ミッションの開始） */
  reset(): void {
    for (const t of this.transports) t.withdraw();
    this.kaiju.withdraw();
    for (const g of this.groundTargets) g.withdraw();
  }

  step(dt: number): void {
    for (const t of this.transports) t.step(dt);
    this.kaiju.step(dt);
    for (const g of this.groundTargets) g.step(dt);
  }

  spawnTransport(def: TransportSpawn): void {
    const t = this.transports.find((x) => !x.deployed);
    t?.deploy(def.group, def.from, def.to);
  }

  spawnKaiju(def: KaijuSpawn): void {
    const { position: p, walkTo: w } = def;
    this.kaiju.emerge(p.x, p.z, w.x, w.z, def.retreatDamageRatio);
  }

  spawnGroundTargets(def: GroundTargetSpawn): void {
    for (const p of def.positions) {
      const g = this.groundTargets.find((x) => !x.deployed);
      if (!g) break;
      g.deploy(def.group, def.targetType, p.x, p.z);
    }
  }

  /** 出ている輸送機のどれかが撃墜されたか */
  get escortLost(): boolean {
    return this.transports.some((t) => t.deployed && t.isDestroyed);
  }

  /** group の輸送機（出ていなければ null） */
  escort(group: string): EscortState | null {
    return this.transports.find((t) => t.deployed && t.group === group) ?? null;
  }

  /** 怪獣に与えたダメージの割合（出ていなければ 0） */
  get kaijuDamageRatio(): number {
    return this.kaiju.phase === 'hidden' ? 0 : this.kaiju.damageRatio;
  }

  /** 地上目標なら、そのグループ（撃墜数の数え上げ用）。地上目標でなければ undefined */
  groundTargetGroup(target: CombatTarget): string | undefined {
    return target instanceof GroundTargetPlaceholder ? target.group : undefined;
  }
}
