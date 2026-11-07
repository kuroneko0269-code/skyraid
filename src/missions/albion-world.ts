// 10-3b: 白鯨アルビオンのレイドの世界（missions/albion-dev.ts から分けた。Three.js・DOM 非依存）: 雲の中のロックの距離の差し替えと、
// ランナーが読む世界（自機・戦域は飛行の世界のまま、怪獣の体力と制限時間をアルビオンから）
import type { TargetingSpec } from '../data/weapons';
import { ALBION_CONFIG as C } from '../data/albion';
import type { AlbionRaid } from './albion-raid';
import type { GamePlay } from './game-play';
import type { MissionWorld } from './world';

/**
 * 雲の中はロックの距離 ×lockRange（霧の中で遠くの的を捕まえにくい）。ロックの決まり（targeting.spec）を雲の中だけ差し替え、
 * 止めたら戻す。ソロ（AlbionDev の固定ステップ）と協力の自機（表示のフレーム）で使う
 */
export class CloudLock {
  private base: TargetingSpec | null = null;
  private inside: TargetingSpec | null = null;

  /** 始め（今の決まりを覚える。前の雲の決まりが残っていれば戻してから） */
  begin(tg: { spec: TargetingSpec }): void {
    if (tg.spec === this.inside && this.base) tg.spec = this.base;
    this.base = tg.spec;
    this.inside = null;
  }

  apply(tg: { spec: TargetingSpec }, inCloud: boolean): void {
    if (!this.base) this.begin(tg);
    const base = this.base;
    if (!base) return;
    if (inCloud) {
      this.inside ??= { ...base, lockRange: base.lockRange * C.attacks.cloud.lockRange };
      tg.spec = this.inside;
    } else tg.spec = base;
  }

  restore(tg: { spec: TargetingSpec }): void {
    if (this.base && tg.spec === this.inside) tg.spec = this.base;
    this.base = null;
    this.inside = null;
  }
}

/** ランナーが読む世界: 自機・戦域は飛行の世界のまま、怪獣の体力と制限時間をアルビオンから */
export function raidWorld(play: GamePlay, raid: AlbionRaid): MissionWorld {
  const s = play.session;
  return {
    get playerPosition() {
      return s.playerPosition;
    },
    get playerPrevPosition() {
      return s.playerPrevPosition;
    },
    get playerSpeed() {
      return s.playerSpeed;
    },
    get playerActive() {
      return s.playerActive;
    },
    get playerDowns() {
      return s.playerDowns;
    },
    get playerDamageTaken() {
      return s.playerDamageTaken;
    },
    get playerMaxHp() {
      return s.playerMaxHp;
    },
    spawn: (def) => {
      s.spawn(def);
    },
    destroyedCount: (kind, group) => s.destroyedCount(kind, group),
    get escortLost() {
      return s.escortLost;
    },
    escort: (group) => s.escort(group),
    get kaijuDamageRatio() {
      return raid.damageRatio;
    },
    get kaijuReachedCity() {
      return false;
    },
    get kaijuStormTimeUp() {
      return false;
    },
    get kaijuTotalTimeUp() {
      return raid.timeUp;
    },
    // 空の怪獣は建物を壊さないので、守れた建物は出さない
    protectedBuildings: null,
  };
}
