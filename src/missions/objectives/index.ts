// 目標の定義から、種類ごとの実装を作る
import type { ObjectiveDef } from '../types';
import { DestroyObjectiveStub } from './destroy';
import { EscortObjectiveStub } from './escort';
import { KaijuObjectiveStub } from './kaiju';
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
      return new EscortObjectiveStub(def);
    case 'destroy':
      return new DestroyObjectiveStub(def);
    case 'kaiju':
      return new KaijuObjectiveStub(def);
  }
}

export { Objective, type ObjectiveStatus } from './objective';
export { RingPassObjective } from './ring-pass';
export { SurviveTimeObjective } from './survive-time';
export { KillCountObjective } from './kill-count';
