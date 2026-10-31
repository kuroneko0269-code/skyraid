// 協力レイドのテストのボット（6-6）: インメモリの対戦（pvp-match.ts）で、各プレイヤーが怪獣の部位を追って機銃を撃ち、
// ロックした部位へミサイルを撃つ。2 人ずつ同じ部位を狙う（ブレイク）。近づきすぎたら引き起こして離れる。
// 狙う位置はホストの怪獣の部位（正）を使う（表示の写しの誤差を入れない。当たりはホストが決める）
import { KAIJU_ID_BASE } from '../src/combat/pvp-arena';
import { GUN_CONFIG } from '../src/data/weapons';
import type { KaijuPart } from '../src/entities/kaiju-part';
import { pursue } from './pvp-bots';
import type { Match } from './pvp-match';
import { BuildingField } from '../src/combat/buildings';
import { generateCity } from '../src/render/city/layout';

const city = generateCity();

/** プレイヤー ID ごとの街（同じ配置から作った別々の状態） */
export function cityFields(): BuildingField[] {
  return [0, 1, 2, 3].map(() => new BuildingField(city));
}

/** 壊れている建物の番号 */
export function ruined(f: BuildingField): number[] {
  const out: number[] = [];
  f.states.forEach((s, i) => {
    if (s !== 'intact') out.push(i);
  });
  return out;
}

/** 離脱の秒数と、離脱を始める距離 */
const BREAK_OFF_SECONDS = 5;
const BREAK_OFF_RANGE = 380;

export interface CoopBotState {
  readonly breakOff: number[];
  /** 1 秒（60 ステップ）のうち引き金を引くステップ数（命中率の代わり。人間の平均的な当て方に合わせて少なめ） */
  readonly fireTicks: number;
}

/** 2 人ずつの組に、時間で回す部位（壊れた部位は飛ばす） */
function partFor(id: number, k: number, parts: readonly KaijuPart[]): KaijuPart | null {
  const order = [2, 3, 1, 0, 4];
  const alive = order
    .map((i) => parts[i])
    .filter((p): p is KaijuPart => p !== undefined && !p.broken);
  const list = alive.length > 0 ? alive : parts;
  const slot = Math.floor(k / (40 * 60)) + (id < 2 ? 0 : 1);
  return list[slot % list.length] ?? null;
}

/** run の each に渡す操作（4 人分） */
export function coopBots(m: Match, state: CoopBotState): (k: number) => void {
  const raid = m.host.raid;
  if (!raid) throw new Error('raid');
  return (k) => {
    const parts = raid.kaiju.parts;
    for (let id = 0; id < m.owns.length; id++) {
      const a = m.owns[id];
      const ctl = m.controls[id];
      const cmb = m.combat[id];
      if (!a || !ctl || !cmb || !m.game(id)) continue;
      const part = partFor(id, k, parts);
      if (!part || !part.active) {
        ctl.throttleTarget = 0.7;
        continue;
      }
      const p = a.state.position;
      const d = Math.hypot(part.position.x - p.x, part.position.y - p.y, part.position.z - p.z);
      const left = state.breakOff[id] ?? 0;
      if (left > 0) {
        // 離脱: 引き起こして上昇しながら離れる
        state.breakOff[id] = left - 1 / 60;
        ctl.pitch = p.y < 900 ? 0.6 : 0;
        ctl.roll = 0;
        ctl.throttleTarget = 1;
        continue;
      }
      if (d < BREAK_OFF_RANGE) {
        state.breakOff[id] = BREAK_OFF_SECONDS;
        continue;
      }
      const off = pursue(ctl, a, part);
      cmb.fire = off < 3 && d < GUN_CONFIG.range && (k + id * 7) % 60 < state.fireTicks;
      cmb.targetId = KAIJU_ID_BASE + part.index;
      cmb.locked = off < 10 && d < 2400;
      cmb.missile = cmb.locked && d > 700 && k % 900 === id * 30;
    }
  };
}
