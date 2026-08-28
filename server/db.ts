import type { GameRoom, RoomPlayer } from "../drizzle/schema";

type SupabaseRow = Record<string, unknown>;

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_KEY?.trim();
  if (!url || !key) {
    throw new Error("SUPABASE_URLとSUPABASE_KEYをRenderの環境変数へ登録してください。");
  }
  return { url, key };
}

async function supabaseRequest<T>(
  table: string,
  options: { method?: "GET" | "POST" | "PATCH"; query?: Record<string, string>; body?: unknown; returning?: boolean },
): Promise<T> {
  const { url, key } = getSupabaseConfig();
  const endpoint = new URL(`${url}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(options.query ?? {})) endpoint.searchParams.set(name, value);
  const response = await fetch(endpoint, {
    method: options.method ?? "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.returning ? { Prefer: "return=representation" } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${options.method ?? "GET"} ${table} failed (${response.status}): ${text.slice(0, 240)}`);
  }
  return text ? (JSON.parse(text) as T) : ([] as T);
}

export async function getDb() {
  getSupabaseConfig();
  return true;
}

export async function createGameRoomRecord(input: {
  code: string;
  hostToken: string;
  maxPlayers: number;
  gameState: unknown;
  hostName: string;
}) {
  const rooms = await supabaseRequest<SupabaseRow[]>("gameRooms", {
    method: "POST",
    returning: true,
    body: {
      code: input.code,
      hostToken: input.hostToken,
      maxPlayers: input.maxPlayers,
      status: "lobby",
      gameState: input.gameState,
    },
  });
  const roomId = Number(rooms[0]?.id);
  if (!Number.isInteger(roomId)) throw new Error("SupabaseがルームIDを返しませんでした。");
  await supabaseRequest("roomPlayers", {
    method: "POST",
    body: {
      roomId,
      playerToken: input.hostToken,
      displayName: input.hostName,
      seat: 0,
      isHost: 1,
    },
  });
  return roomId;
}

export async function getGameRoomByCode(code: string) {
  const rows = await supabaseRequest<GameRoom[]>("gameRooms", {
    query: { code: `eq.${code}`, limit: "1" },
  });
  return rows[0];
}

export async function getRoomPlayers(roomId: number) {
  return supabaseRequest<RoomPlayer[]>("roomPlayers", {
    query: { roomId: `eq.${roomId}`, order: "seat.asc" },
  });
}

export async function getRoomPlayer(roomId: number, playerToken: string) {
  const rows = await supabaseRequest<RoomPlayer[]>("roomPlayers", {
    query: { roomId: `eq.${roomId}`, playerToken: `eq.${playerToken}`, limit: "1" },
  });
  return rows[0];
}

export async function addRoomPlayerRecord(input: {
  roomId: number;
  playerToken: string;
  displayName: string;
  seat: number;
}) {
  await supabaseRequest("roomPlayers", {
    method: "POST",
    body: {
      roomId: input.roomId,
      playerToken: input.playerToken,
      displayName: input.displayName,
      seat: input.seat,
      isHost: 0,
    },
  });
}

export async function updateGameRoomState(input: {
  code: string;
  expectedRevision: number;
  gameState: unknown;
  status: "lobby" | "active" | "finished";
}) {
  const rows = await supabaseRequest<GameRoom[]>("gameRooms", {
    method: "PATCH",
    query: { code: `eq.${input.code}`, revision: `eq.${input.expectedRevision}` },
    returning: true,
    body: {
      gameState: input.gameState,
      status: input.status,
      revision: input.expectedRevision + 1,
    },
  });
  return rows.length > 0;
}
