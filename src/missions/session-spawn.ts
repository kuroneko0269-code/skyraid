// ミッションの出現物の出し方（FlightSession.spawn から呼ぶ。Three.js 非依存）。
// flight-session.ts が 300 行を超えたので分けた
import type { EnemySquadron } from '../ai/enemy-squadron';
import type { CombatSystem } from '../combat/combat-system';
import type { TargetDrone } from '../entities/target-drone';
import type { DestroyTally } from './destroy-tally';
import type { MissionProps } from './mission-props';
import type { SpawnDef } from './types';

/** spawn で触る FlightSession の部品 */
export interface SpawnParts {
  readonly squadron: EnemySquadron;
  readonly combat: CombatSystem;
  readonly props: MissionProps;
  readonly destroyed: DestroyTally;
}

/** 出現物の定義 1 つを出す */
export function spawnInSession(def: SpawnDef, s: SpawnParts): void {
  switch (def.kind) {
    case 'enemyFighter':
      for (let i = 0; i < def.count; i++) {
        const at = def.positions[i % def.positions.length];
        if (!at) break;
        const preferAllies = def.attack === 'transport';
        const index = s.squadron.deploy(
          at,
          def.patrol,
          def.difficulty,
          preferAllies,
          def.hpScale ?? 1,
        );
        if (index >= 0) s.destroyed.setEnemyGroup(index, def.group);
      }
      break;
    case 'targets':
      s.combat.targets.configure(def.count, def.respawns === true);
      break;
    case 'drones':
      configureDrones(s.combat.drones, def.count, def.respawns === true);
      // 9-5c: チュートリアルの経路（練習場の動く的と同じ）
      def.paths?.forEach((path, i) => s.combat.drones[i]?.setPath(path));
      break;
    case 'groundTarget':
      s.props.spawnGroundTargets(def);
      break;
    case 'transport':
      s.props.spawnTransport(def);
      break;
    case 'kaiju':
      s.props.spawnKaiju(def);
      break;
  }
}

/** ドローンを先頭から count 機だけ出す（全部リセットしてから） */
export function configureDrones(
  drones: readonly TargetDrone[],
  count: number,
  respawns: boolean,
): void {
  drones.forEach((d, i) => {
    // 9-5: 練習場の経路は外して周回に戻す
    d.path = null;
    d.reset();
    d.deployed = i < count;
    d.respawns = respawns;
  });
}
