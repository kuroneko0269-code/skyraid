// 怪獣のテストの共通の部品（6-1 / 6-2）
import { KaijuAi, type KaijuTarget } from '../src/ai/kaiju-ai';
import { KAIJU_CONFIG as K, type KaijuAttack } from '../src/data/kaiju';
import { Kaiju } from '../src/entities/kaiju';

export const DT = 1 / 60;
export const flat = (): number => 0;

/** 上陸を終えて陸に立った怪獣（AI 付き） */
export function landed(players = 1): {
  kaiju: Kaiju;
  ai: KaijuAi;
  hits: { id: number; amount: number; attack: KaijuAttack }[];
  stuns: { id: number; s: number }[];
} {
  const kaiju = new Kaiju(flat);
  const hits: { id: number; amount: number; attack: KaijuAttack }[] = [];
  const stuns: { id: number; s: number }[] = [];
  const ai = new KaijuAi(kaiju, {
    damage: (id, amount, attack) => hits.push({ id, amount, attack }),
    stun: (id, s) => stuns.push({ id, s }),
  });
  kaiju.emerge(0, 0, 0, -10000, { players });
  ai.configure({ goal: { x: 0, z: -10000 } });
  for (let i = 0; i < K.riseSeconds * 60 + 1; i++) ai.step([], DT);
  return { kaiju, ai, hits, stuns };
}

export function target(
  id: number,
  x: number,
  y: number,
  z: number,
  flareAge = Infinity,
): KaijuTarget & { position: { x: number; y: number; z: number } } {
  return { id, position: { x, y, z }, hitRadius: 6, active: true, flareAge };
}
