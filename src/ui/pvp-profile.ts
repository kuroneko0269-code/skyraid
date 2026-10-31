// PvP の自分のプロフィールと装備（6-6。pvp-link.ts から分けた）: パイロット名・機体・シングルの強化 Lv、
// 名簿の自分の機体、強化の無効（5-4）を反映した装備
import { SAVE_CONFIG } from '../data/save';
import type { ClientRoom } from '../net/client-room';
import { netLoadout } from '../net/loadout';
import type { HostRoom, PlayerProfile } from '../net/room';
import type { Hangar } from '../progression/hangar';
import type { Loadout } from '../progression/loadout';

/** 自分のプロフィール（パイロット名・機体・シングルの強化 Lv。強化の無効はホストが決める） */
export function pilotProfile(
  hangar: Hangar,
  pilotName: () => string | null,
  aircraftId: string = hangar.selectedId,
): PlayerProfile {
  return {
    name: pilotName() ?? SAVE_CONFIG.defaultPilotName,
    aircraftId,
    upgrades: { ...hangar.levels(aircraftId) },
  };
}

/** 名簿の自分の機体（ホストが知っている機体で飛ぶ。ロビーで変えた直後の行き違いを防ぐ） */
export function rosterAircraftId(room: HostRoom | ClientRoom | null, hangar: Hangar): string {
  const me = room?.players.find((p) => p.id === room.localPlayerId);
  return me?.aircraftId ?? hangar.selectedId;
}

/** PvP の飛行の装備（ホストが強化を無効にしていれば Lv 0。5-4） */
export function roomLoadout(room: HostRoom | ClientRoom | null, hangar: Hangar): Loadout {
  const id = rosterAircraftId(room, hangar);
  const off = room?.settings.noUpgrades ?? true;
  return netLoadout(id, off ? undefined : hangar.levels(id));
}
