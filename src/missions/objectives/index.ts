// 目標の定義から、種類ごとの実装を作る
import type { ObjectiveDef } from '../types';
import { DestroyObjective } from './destroy';
import { EscortObjective } from './escort';
import { KaijuObjective } from './kaiju';
import { KillCountObjective } from './kill-count';
import type { Objective } from './objective';
import { RingPassObjective } from './ring-pass';
import { SpeedObjective } from './speed';
import { SurviveTimeObjective } from './survive-time';
import { TaskObjective } from './task';

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
    case 'speed':
      return new SpeedObjective(def);
    case 'task':
      return new TaskObjective(def);
  }
}

export { Objective, type ObjectiveStatus } from './objective';
export { RingPassObjective } from './ring-pass';
export { TaskObjective } from './task';
