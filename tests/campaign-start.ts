// 9-7: キャンペーンのボット（tests/campaign-bots.ts・kaiju2-raid-bots.ts）の共通: ミッションの始めと、補助の組の値
import { SpeedMatch } from '../src/combat/speed-match';
import {
  AIM_ASSIST_CONFIG,
  AIM_ASSIST_LEVEL_SPECS,
  ASSIST_PRESET_VALUES,
  type AimAssistSpec,
  type AssistPreset,
} from '../src/data/assist';
import { MISSIONS } from '../src/data/missions';
import type { ReplayStart } from '../src/replay/types';
import type { Kaiju2Role } from './kaiju2-bot-roles';

/** 9-7: キャンペーンのミッションの始め（M8 の決戦） */
export function campaignStart(missionId: string, seed: number, weapons = 0): ReplayStart {
  const def = MISSIONS.find((m) => m.id === missionId);
  if (!def) throw new Error(`Mission not found: ${missionId}`);
  return {
    mode: 'mission',
    mapId: def.mapId,
    missionId,
    aircraftId: 'kestrel',
    upgrades: { engine: 0, airframe: 0, weapons, avionics: 0 },
    enemies: { enabled: false, difficulty: 'normal', count: 0 },
    seed: 9700 + seed,
    weatherId: 'clear',
  };
}

/**
 * 補助の組（狙いの補助・自動射撃・速度合わせ）。preset を渡さなければ役の値（touch: タッチの初期値の補助 標準・自動射撃、
 * それ以外は補助なし）。組を渡すと模擬の人・初心者役はスロットル最大のまま（9-5d と同じ）、速度合わせは組の値
 */
export function assistFor(
  role: Kaiju2Role,
  touch: boolean,
  preset: AssistPreset | undefined,
): {
  readonly assist: AimAssistSpec;
  readonly autoFire: boolean;
  readonly throttleMax: boolean;
  readonly speedMatch: SpeedMatch | null;
} {
  if (!preset)
    return {
      assist: touch ? AIM_ASSIST_LEVEL_SPECS.normal : AIM_ASSIST_CONFIG,
      autoFire: touch,
      throttleMax: false,
      speedMatch: null,
    };
  const v = ASSIST_PRESET_VALUES[preset];
  const throttleMax = role === 'human' || role === 'beginner';
  return {
    assist: AIM_ASSIST_LEVEL_SPECS[v.aimAssist],
    autoFire: v.autoFire,
    throttleMax,
    speedMatch: throttleMax && v.speedMatch ? new SpeedMatch() : null,
  };
}
