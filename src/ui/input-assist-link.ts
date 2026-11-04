// 入力の補助の組み立て（9-3。app.ts が 300 行を超えたので分けた）: エイムアシスト・判定の拡大・自動射撃・速度合わせ（9-5b）（AssistControl。タッチの
// 強さと自動射撃は操作設定から）と、タッチの「方向へ倒す」方式（SteerControl。低空の安全は今のマップの地面・海面。PvP も同じ自機）。
import { AssistControl } from '../core/assist-control';
import type { AssistFlags } from '../core/assist-settings';
import type { Input } from '../core/input';
import { SteerControl } from '../core/steer-control';
import type { GroundHeightFn } from '../entities/aircraft';
import type { GamePlay } from '../missions/game-play';
import type { SaveStore } from '../progression/save-store';
import type { HudLink } from '../render/hud-link';
import type { PvpEntry } from './pvp-entry';

/** 入力の補助を作り、ネット対戦の部屋の補正（個人戦・チーム戦の飛行中だけ）と HUD の宙返りの速度不足（方向へ倒す方式のときだけ）をつなぐ */
export function createInputAssist(
  play: GamePlay,
  flags: Readonly<AssistFlags>,
  input: Input,
  save: SaveStore,
  map: { readonly ground: GroundHeightFn },
  hudLink: HudLink,
  pvp: PvpEntry,
): { assist: AssistControl; steer: SteerControl } {
  const session = play.session;
  const assist = new AssistControl(
    session,
    flags,
    () => input.lastDevice,
    () => save.settings.controls,
  );
  assist.netRules = () => (pvp.flying ? pvp.assistRules : null);
  const steer = new SteerControl(input, session.aircraft, map.ground);
  hudLink.loopSpeedLow = () => steer.active && steer.loopBlocked;
  // 9-5b: 機銃だけの練習場では爆弾の着弾予測点を出さない。速度合わせで下げている間は HUD の THR に AUTO
  hudLink.gunOnly = () => play.practice !== null;
  hudLink.speedMatching = () => assist.speedMatching;
  return { assist, steer };
}
