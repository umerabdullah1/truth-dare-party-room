import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type PromptKind = "truth" | "dare";

export type RoomPlayer = {
  id: string;
  nickname: string;
};

export type GameRoom = {
  id: string;
  invite_code: string;
  room_name: string;
  status: "waiting" | "playing";
  turn_number: number;
  current_player_id: string | null;
  current_kind: PromptKind | null;
  current_prompt: string | null;
  players: RoomPlayer[];
};

export type RoomAccess = {
  playerId: string;
  hostSecret: string | null;
};

function asRecord(value: Json | null): Record<string, Json | undefined> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, Json | undefined>;
}

function asString(value: Json | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(record: Record<string, Json | undefined>, key: string): string {
  const value = asString(record[key]);
  if (!value) throw new Error("The game returned an incomplete room response.");
  return value;
}

function readRoom(value: Json | null): GameRoom | null {
  const record = asRecord(value);
  if (!record) return null;
  const status = asString(record.status);
  const kind = asString(record.current_kind);
  const playersValue = record.players;
  const players = Array.isArray(playersValue)
    ? playersValue.flatMap((player): RoomPlayer[] => {
        const item = asRecord(player);
        const id = item ? asString(item.id) : null;
        const nickname = item ? asString(item.nickname) : null;
        return id && nickname ? [{ id, nickname }] : [];
      })
    : [];

  if (status !== "waiting" && status !== "playing") return null;
  return {
    id: requiredString(record, "id"),
    invite_code: requiredString(record, "invite_code"),
    room_name: requiredString(record, "room_name"),
    status,
    turn_number: typeof record.turn_number === "number" ? record.turn_number : 0,
    current_player_id: asString(record.current_player_id),
    current_kind: kind === "truth" || kind === "dare" ? kind : null,
    current_prompt: asString(record.current_prompt),
    players,
  };
}

export async function createGameRoom(roomName: string, nickname: string) {
  const { data, error } = await supabase.rpc("create_game_room", {
    p_room_name: roomName,
    p_host_nickname: nickname,
  });
  if (error) throw new Error(error.message);
  const record = asRecord(data);
  if (!record) throw new Error("The room could not be created. Please try again.");
  return {
    inviteCode: requiredString(record, "invite_code"),
    hostSecret: requiredString(record, "host_secret"),
    playerId: requiredString(record, "host_player_id"),
  };
}

export async function joinGameRoom(inviteCode: string, nickname: string) {
  const { data, error } = await supabase.rpc("join_game_room", {
    p_invite_code: inviteCode,
    p_nickname: nickname,
  });
  if (error) throw new Error(error.message);
  const record = asRecord(data);
  if (!record) throw new Error("Could not join this room. Check the invite and try again.");
  return { playerId: requiredString(record, "player_id") };
}

export async function getGameRoom(inviteCode: string) {
  const { data, error } = await supabase.rpc("get_game_room", { p_invite_code: inviteCode });
  if (error) throw new Error(error.message);
  return readRoom(data);
}

export async function advanceGameTurn(inviteCode: string, hostSecret: string) {
  const { data, error } = await supabase.rpc("advance_game_turn", {
    p_invite_code: inviteCode,
    p_host_secret: hostSecret,
  });
  if (error) throw new Error(error.message);
  const room = readRoom(data);
  if (!room) throw new Error("The next turn could not be loaded.");
  return room;
}

export function roomSessionKey(inviteCode: string) {
  return `truth-dare-room:${inviteCode.toLowerCase()}`;
}

export function saveRoomAccess(inviteCode: string, access: RoomAccess) {
  window.sessionStorage.setItem(roomSessionKey(inviteCode), JSON.stringify(access));
}

export function readRoomAccess(inviteCode: string): RoomAccess | null {
  const serialized = window.sessionStorage.getItem(roomSessionKey(inviteCode));
  if (!serialized) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (typeof value !== "object" || value === null) return null;
    const record = value as { playerId?: unknown; hostSecret?: unknown };
    if (typeof record.playerId !== "string") return null;
    return {
      playerId: record.playerId,
      hostSecret: typeof record.hostSecret === "string" ? record.hostSecret : null,
    };
  } catch {
    return null;
  }
}