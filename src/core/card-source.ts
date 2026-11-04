// 記録カード（8-5）の元になる結果（DOM・Three.js 非依存）。結果画面を出すときに作り、カードの文言は
// ui/card/card-model.ts が今の言語で組み立てる。オンライン連携の情報（メールなど）は持たせない
import type { DefenseDifficulty } from '../data/defense';
import type { RaidDifficulty } from '../data/raid';
import type { Paint } from '../progression/paint';

interface CardCommon {
  readonly aircraftId: string;
  /** 飛んだ機体の塗装（まだ塗っていなければ null） */
  readonly paint: Readonly<Paint> | null;
  /** パイロット名（未入力なら null。載せるかはカードの画面で選ぶ） */
  readonly pilotName: string | null;
  /** 結果の日時（ms） */
  readonly date: number;
}

/** カードを作れる遊び方はソロのミッション・レイド・レース・防衛戦だけ（チュートリアル・フリーフライト・マルチは作らない） */
export type CardSource = CardCommon &
  (
    | {
        readonly mode: 'mission';
        readonly missionId: string;
        readonly success: boolean;
        readonly rank: string | null;
        readonly seconds: number;
      }
    | {
        readonly mode: 'raid';
        readonly difficulty: RaidDifficulty;
        /** 9-6b: ヴォルガス以外の怪獣（9-6c からネフィルガ。省略はヴォルガス） */
        readonly kaiju?: string;
        readonly success: boolean;
        readonly rank: string | null;
        readonly seconds: number;
        /** 守れた建物（%。無ければ null） */
        readonly protectedBuildings: number | null;
      }
    | {
        readonly mode: 'race';
        readonly courseId: string;
        readonly finished: boolean;
        readonly rank: string | null;
        /** ペナルティ・ボーナス込みのタイム（秒） */
        readonly time: number;
        readonly newBest: boolean;
      }
    | {
        readonly mode: 'defense';
        readonly mapId: string;
        readonly difficulty: DefenseDifficulty;
        readonly cleared: boolean;
        readonly waves: number;
        readonly kills: number;
      }
  );
