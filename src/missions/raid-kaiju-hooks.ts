// 10-2: レイドの怪獣ごとの表示の差し込み口（結果の表の部位の名前・怪獣の画像を撮るときの基準点）。新しい怪獣の遅延チャンク
// （か入口のモジュール）が registerRaidKaijuHooks で登録する。ヴォルガス・ネフィルガの結果の表は今までの式のまま
// （ui/raid-result.ts）。Three.js・DOM 非依存
export interface ArtAnchor {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 向き（水平の単位ベクトル） */
  readonly fx: number;
  readonly fz: number;
}

export interface RaidKaijuHooks {
  /** 結果の表の部位の名前（成績の partDamage の順。今の言語） */
  partLabels?(): readonly string[];
  /** 画像を撮るときの怪獣の基準点と向き（scripts/render-kaiju-art.js。いなければ null） */
  artAnchor?(): ArtAnchor | null;
}

const hooks = new Map<string, RaidKaijuHooks>();

export function registerRaidKaijuHooks(id: string, h: RaidKaijuHooks): void {
  hooks.set(id, { ...hooks.get(id), ...h });
}

export function raidKaijuHooks(id: string | undefined): RaidKaijuHooks | null {
  return id === undefined ? null : (hooks.get(id) ?? null);
}
