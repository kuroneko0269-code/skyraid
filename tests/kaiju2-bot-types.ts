// ネフィルガのソロのボット（tests/kaiju2-raid-bots.ts）の設定と結果の形（10-6 で kaiju2-raid-bots.ts から分けた）
import type { AssistPreset } from '../src/data/assist';
import type { RaidDifficulty } from '../src/data/raid';
import type { Kaiju2Dev } from '../src/missions/kaiju2-dev';
import type { ReplayData } from '../src/replay/types';
import type { Kaiju2Role } from './kaiju2-bot-roles';

export interface Kaiju2BotOptions {
  readonly role: Kaiju2Role;
  readonly seed: number;
  readonly difficulty?: RaidDifficulty;
  /** 打ち切り（秒。既定は全体の制限時間 + 10） */
  readonly maxSeconds?: number;
  /** 本番の飛行と同じ手順で記録する（量子化した入力で判定。リプレイのテスト） */
  readonly record?: boolean;
  /** 毎ステップの後に呼ぶ（テストの確かめ） */
  readonly onStep?: (dev: Kaiju2Dev) => void;
  /** 9-7: キャンペーンのミッション（M8 の決戦 'finale'）を飛ぶ。省略はレイド */
  readonly missionId?: string;
  /**
   * 9-7: 補助の組（狙いの補助・自動射撃・速度合わせ。src/data/assist.ts）。省略は役の値（模擬の人はタッチの初期値・ほかは補助なし）。
   * 組を渡すと、模擬の人と初心者役はスロットルを最大のまま（9-5d と同じ）、速度合わせは組の値
   */
  readonly preset?: AssistPreset;
  /**
   * 10-6: 体への衝突を入れる前の判定で飛ぶ（ぶつかってもダメージなし）。そのとき体を通り抜けた回数（衝突と同じ数え方: 1.5 秒は続けて
   * 数えない）を ramHits に入れる（変更前の表）
   */
  readonly noRam?: boolean;
}

export interface Kaiju2BotResult {
  readonly status: string;
  readonly reason: string | null;
  readonly seconds: number;
  readonly playerDowns: number;
  readonly partsBroken: number;
  readonly stormAt: number | null;
  /** 1 回の攻撃で受けた最大のダメージ（一撃で落ちないことの確認） */
  readonly maxHit: number;
  readonly hitsTaken: Readonly<Record<string, number>>;
  readonly perches: number;
  /** 9-6d: 攻撃（予兆）の回数・1 度でも当たった攻撃の回数・クリア時に減っていた体力の割合（成功でなければ null） */
  readonly attacks: number;
  readonly hitAttacks: number;
  readonly hpLostAtClear: number | null;
  /** 9-6d: 受けたダメージの合計（墜落を除く）/ 最大体力 */
  readonly damageRatio: number;
  /** 9-6d: 撃墜のうち攻撃によるもの（残りは墜落）・攻撃の種類ごとの回数・状態ごとの秒数 */
  readonly attackDowns: number;
  readonly attackKinds: Readonly<Record<string, number>>;
  readonly stateSeconds: Readonly<Record<string, number>>;
  /** 10-6: 体への衝突の回数（noRam なら通り抜けた回数）と、衝突で撃墜された回数・衝突したときの怪獣の状態:攻撃 */
  readonly ramHits: number;
  readonly ramScenes: Readonly<Record<string, number>>;
  readonly ramDowns: number;
  readonly data: ReplayData | null;
  /** 終わったときの状態のハッシュ */
  readonly hash: string;
}
