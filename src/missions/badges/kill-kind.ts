// 勲章の拡充（9-10b）: プレイヤーが落とした対象の種類（通算の記録の敵の種類別）。Three.js・DOM 非依存
import type { CombatTarget } from '../../combat/target';
import { Bomber } from '../../entities/bomber';
import { CruiseMissile } from '../../entities/cruise-missile';
import { EnemyAircraft } from '../../entities/enemy-aircraft';
import { GroundTarget } from '../../entities/ground-target';
import { TargetBalloon } from '../../entities/target-balloon';
import { TargetDrone } from '../../entities/target-drone';

/** 敵機・爆撃機・巡航ミサイル・地上目標（対空砲も）・怪獣の部位・10-3b: レイドの怪獣の子分・的（風船・ドローン）・そのほか */
export type KillKind =
  'fighter' | 'bomber' | 'cruise' | 'ground' | 'part' | 'minion' | 'target' | 'other';

export function killKindOf(t: CombatTarget): KillKind {
  if (t instanceof EnemyAircraft) return 'fighter';
  if (t instanceof Bomber) return 'bomber';
  if (t instanceof CruiseMissile) return 'cruise';
  if (t instanceof GroundTarget) return 'ground';
  // 10-3b: レイドの怪獣の子分（アルビオンの子分。遅延チャンクなので印で見る）
  if ('raidMinion' in t) return 'minion';
  // 怪獣の部位（ヴォルガス・ネフィルガ）だけが blastGroup を持つ（ネフィルガは遅延チャンクなので型で見ない）
  if (t.blastGroup !== undefined) return 'part';
  if (t instanceof TargetBalloon || t instanceof TargetDrone) return 'target';
  return 'other';
}
