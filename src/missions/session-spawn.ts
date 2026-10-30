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
        const index = s.squadron.deploy(at, def.patrol, def.difficulty, preferAllies);
        if (index >= 0) s.destroyed.setEnemyGroup(index, def.group);
      }
      break;
    case 'targets':
      s.combat.targets.configure(def.count, false);
      break;
    case 'drones':
      configureDrones(s.combat.drones, def.count, false);
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
    d.reset();
    d.deployed = i < count;
    d.respawns = respawns;
  });
}
