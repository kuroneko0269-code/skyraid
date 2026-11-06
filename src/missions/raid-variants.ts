// 9-6b: レイドの別の怪獣（開発中。?dev=<名前> の遅延チャンクだけが登録する）の差し込み口。ヴォルガスのレイド（raidMission）は
// ここを通らない。登録が無ければ（?dev を付けないとき）モード選択・リプレイ・記録カードは今までと同じ（Three.js・DOM 非依存）
import type { RaidDifficulty } from '../data/raid';
import type { MissionDef } from './types';

export interface RaidVariant {
  /** 怪獣の id（ミッションの reward.raid.kaiju・リプレイのヘッダの raidKaiju） */
  readonly id: string;
  /** ミッションの id（結果の画面の題） */
  readonly missionId: string;
  /** モード選択の選択肢の名前（今の言語） */
  label(): string;
  /** 難易度ごとのミッション */
  mission(difficulty: RaidDifficulty): MissionDef;
  /** リプレイの一覧・記録カードの題（今の言語） */
  title(difficulty: RaidDifficulty): string;
  /** 結果の画面の題とブリーフィングの文（今の言語） */
  strings(): { readonly title: string; readonly briefing: readonly string[] };
}

const variants: RaidVariant[] = [];

export function registerRaidVariant(v: RaidVariant): void {
  const i = variants.findIndex((x) => x.id === v.id);
  if (i >= 0) variants[i] = v;
  else variants.push(v);
}

export function findRaidVariant(id: string | undefined): RaidVariant | null {
  return id === undefined ? null : (variants.find((v) => v.id === id) ?? null);
}

export function raidVariantByMission(missionId: string): RaidVariant | null {
  return variants.find((v) => v.missionId === missionId) ?? null;
}
