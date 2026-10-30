// 目標の定義から、種類ごとの実装を作る
import type { ObjectiveDef } from '../types';
import { DestroyObjective } from './destroy';
import { EscortObjective } from './escort';
import { KaijuObjective } from './kaiju';
import { KillCountObjective } from './kill-count';
import type { Objective } from './objective';
import { RingPassObjective } from './ring-pass';
import { SurviveTimeObjective } from './survive-time';

export function createObjective(def: ObjectiveDef): Objective {
  switch (def.type) {
    case 'kill':
      return new KillCountObjective(def);
    case 'survive':
      return new SurviveTimeObjective(def);
    case 'rings':
      return new RingPassObjective(def);
    case 'escort':
      return new EscortObjective(def);
    case 'destroy':
      return new DestroyObjective(def);
    case 'kaiju':
      return new KaijuObjective(def);
  }
}

export { Objective, type ObjectiveStatus } from './objective';
export { RingPassObjective } from './ring-pass';
export { SurviveTimeObjective } from './survive-time';
export { KillCountObjective } from './kill-count';
export { EscortObjective } from './escort';
export { DestroyObjective } from './destroy';
export { KaijuObjective } from './kaiju';
