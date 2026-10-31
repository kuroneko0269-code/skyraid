// 参加者の機体の数値（5-1 の host-game.ts から分けた。5-3 でホストの部屋の最大 HP にも使う）。
// 送られてきた機体と強化 Lv を検査して装備にする（知らない機体は最初の機体、Lv は範囲に丸める）。Three.js 非依存
import { AIRCRAFT_MODELS, findAircraftModel } from '../data/aircraft';
import { UPGRADE_LEVELS } from '../data/upgrades';
import { resolveLoadout, type Loadout } from '../progression/loadout';
import type { UpgradeLevelsMsg } from './protocol';

function clampLevel(n: number): number {
  return Math.min(UPGRADE_LEVELS.max, Math.max(UPGRADE_LEVELS.min, Math.round(n)));
}

export function netLoadout(aircraftId: string, u: Readonly<UpgradeLevelsMsg> | undefined): Loadout {
  const model = findAircraftModel(aircraftId) ?? AIRCRAFT_MODELS[0];
  if (!model) throw new Error('機体の定義がありません');
  return resolveLoadout(model, {
    engine: clampLevel(u?.engine ?? 0),
    airframe: clampLevel(u?.airframe ?? 0),
    weapons: clampLevel(u?.weapons ?? 0),
    avionics: clampLevel(u?.avionics ?? 0),
  });
}
