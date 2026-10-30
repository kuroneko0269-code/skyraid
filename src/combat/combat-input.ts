// 戦闘の 1 ステップ分の操作（Three.js 非依存）。CombatSystem.step が読む

/** 1 ステップ分の戦闘の操作。trigger 以外は押した瞬間だけ true */
export interface CombatInput {
  trigger: boolean;
  missile: boolean;
  flare: boolean;
  targetNext: boolean;
  /** ロケット 1 斉射（2-6） */
  rocket: boolean;
  /** 爆弾の投下（2-6。キーボード B） */
  bomb: boolean;
  /** 長押しでの爆弾の投下（タッチ AB・パッド RT。着弾予測点が出ているときだけ落とす） */
  bombHeld: boolean;
}

/** 何も押していない入力（毎ステップ書き換えて使う入れ物） */
export function createCombatInput(): CombatInput {
  return {
    trigger: false,
    missile: false,
    flare: false,
    targetNext: false,
    rocket: false,
    bomb: false,
    bombHeld: false,
  };
}
