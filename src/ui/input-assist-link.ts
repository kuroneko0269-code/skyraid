// 入力の補助の組み立て（9-3。app.ts が 300 行を超えたので分けた）: エイムアシスト・判定の拡大・自動射撃（AssistControl。タッチの
// 強さと自動射撃は操作設定から）と、タッチの「方向へ倒す」方式（SteerControl。低空の安全は今のマップの地面・海面。PvP も同じ自機）。
import { AssistControl } from '../core/assist-control';
import type { AssistFlags } from '../core/assist-settings';
import type { Input } from '../core/input';
import { SteerControl } from '../core/steer-control';
import type { GroundHeightFn } from '../entities/aircraft';
import type { FlightSession } from '../missions/flight-session';
import type { SaveStore } from '../progression/save-store';
import type { HudLink } from '../render/hud-link';
import type { PvpEntry } from './pvp-entry';

/** 入力の補助を作り、ネット対戦の部屋の補正（個人戦・チーム戦の飛行中だけ）と HUD の宙返りの速度不足（方向へ倒す方式のときだけ）をつなぐ */
export function createInputAssist(
  session: FlightSession,
  flags: Readonly<AssistFlags>,
  input: Input,
  save: SaveStore,
  map: { readonly ground: GroundHeightFn },
  hudLink: HudLink,
  pvp: PvpEntry,
): { assist: AssistControl; steer: SteerControl } {
  const assist = new AssistControl(
    session,
    flags,
    () => input.lastDevice,
    () => save.settings.controls,
  );
  assist.netRules = () => (pvp.flying ? pvp.assistRules : null);
  const steer = new SteerControl(input, session.aircraft, map.ground);
  hudLink.loopSpeedLow = () => steer.active && steer.loopBlocked;
  return { assist, steer };
}
