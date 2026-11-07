// 10-3c: 白鯨アルビオンのソロのボットの型と、模擬の人の撃ち方（albion-raid-bots.ts から分けた）
import type { AssistPreset } from '../src/data/assist';
import type { RaidDifficulty } from '../src/data/raid';
import { LOCAL_FORWARD } from '../src/flight/flight-model';
import { rotateVec3, type Quat, type Vec3 } from '../src/flight/math';
import type { ReplayData } from '../src/replay/types';
import type { Kaiju2Role } from './kaiju2-bot-roles';
import type { CombatTarget } from '../src/combat/target';
import type { FlightSession } from '../src/missions/flight-session';
import type { AlbionMinionTarget, AlbionPartTarget } from '../src/entities/albion/albion-target';
import { ALBION_FOCUS } from './albion-bot-parts';

export interface AlbionBotOptions {
  readonly role: Kaiju2Role;
  readonly seed: number;
  readonly difficulty?: RaidDifficulty;
  readonly maxSeconds?: number;
  readonly record?: boolean;
  readonly preset?: AssistPreset;
  /** 予兆への反応を上書き（避ける確率・遅れ。「正しく避ければ当たらない」の確かめ） */
  readonly dodge?: { readonly chance: number; readonly react: number };
}

export interface AlbionBotResult {
  readonly status: string;
  readonly reason: string | null;
  readonly seconds: number;
  readonly playerDowns: number;
  readonly partsBroken: number;
  readonly nestsBroken: number;
  readonly attacks: number;
  readonly hitAttacks: number;
  readonly rams: number;
  /** 終わったときの体力の割合・部位に当てた回数 */
  readonly kaijuHp: number;
  readonly partHits: number;
  readonly minionKills: number;
  readonly hpLostAtClear: number | null;
  readonly damageRatio: number;
  /** 撃墜のうち攻撃（潮吹き・尾）・子分の体当たりによるもの（残りは墜落） */
  readonly attackDowns: number;
  readonly ramDowns: number;
  /** 10-3c: 体への衝突による撃墜 */
  readonly bodyDowns: number;
  readonly taken: Readonly<Record<string, number>>;
  readonly attackKinds: Readonly<Record<string, number>>;
  readonly maxHit: number;
  /** 10-3c: 攻撃の種類ごとの、当たった攻撃の数（1 回の攻撃で 1 回） */
  readonly hitKinds: Readonly<Record<string, number>>;
  /** 10-3c: 体への衝突の回数・平均の速さ（m/s）・体の面からの距離の中央値（m）・面から 300m 以内の割合・撃っていた割合 */
  readonly bodyHits: number;
  readonly meanSpeed: number;
  readonly medianDist: number;
  readonly closeShare: number;
  readonly fireShare: number;
  readonly modes: readonly number[];
  readonly data: ReplayData | null;
  readonly hash: string;
}

const ray = { x: 0, y: 0, z: 0 };

/** 機首の線が部位の球に range m 以内で当たるか */
export function gunOnBody(
  st: { readonly position: Readonly<Vec3>; readonly orientation: Readonly<Quat> },
  parts: readonly {
    readonly position: Readonly<Vec3>;
    readonly hitRadius: number;
    readonly active: boolean;
  }[],
  range = 900,
): boolean {
  rotateVec3(ray, st.orientation, LOCAL_FORWARD);
  const p = st.position;
  for (const t of parts) {
    if (!t.active) continue;
    const c = t.position;
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    const dz = c.z - p.z;
    const along = dx * ray.x + dy * ray.y + dz * ray.z;
    if (along <= 0 || along > range + t.hitRadius) continue;
    const off = Math.hypot(dx - ray.x * along, dy - ray.y * along, dz - ray.z * along);
    if (off <= t.hitRadius) return true;
  }
  return false;
}

/**
 * 狙う対象を選ぶ（熟練 focus: 機首の前に来た子分 → 巣 → 尾 → 頭 → 背びれ → 胴。ほかはロックした部位・初めは胴の真ん中）
 */
export function focusPicker(
  s: FlightSession,
  focus: boolean,
  parts: readonly AlbionPartTarget[],
  minions: readonly AlbionMinionTarget[],
): () => CombatTarget {
  return (): CombatTarget => {
    const me = s.aircraft.state.position;
    if (focus) {
      // 熟練: 機首の前 15° 以内・500m 以内に来た子分は落とす（追い回さない）
      const st = s.aircraft.state;
      const q = st.orientation;
      const fx = -2 * (q.x * q.z + q.w * q.y);
      const fy = 2 * (q.w * q.x - q.y * q.z);
      const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
      for (const m of minions) {
        if (!m.active) continue;
        const p = m.position;
        const d = Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z);
        const cos = ((p.x - me.x) * fx + (p.y - me.y) * fy + (p.z - me.z) * fz) / (d || 1);
        if (d < 500 && cos > Math.cos((15 * Math.PI) / 180)) return m;
      }
      for (const id of ALBION_FOCUS) {
        const t = parts.find((x) => x.id === id && !x.broken);
        if (t) return t;
      }
    }
    const sel = s.combat.targeting.selected;
    return sel?.active ? sel : ((parts[1] ?? parts[0]) as CombatTarget);
  };
}
