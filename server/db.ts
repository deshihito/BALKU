import postgres from "postgres";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { gameRooms, roomPlayers } from "../drizzle/schema";

let sqlClient: ReturnType<typeof postgres> | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URLが設定されていません。Supabaseの接続文字列をRenderへ登録してください。");
    }
    sqlClient = postgres(connectionString, {
      max: 10,
      prepare: false,
      ssl: process.env.NODE_ENV === "production" ? "require" : undefined,
    });
    db = drizzle(sqlClient);
  }
  return db;
}

export async function createGameRoomRecord(input: {
  code: string;
  hostToken: string;
  maxPlayers: number;
  gameState: unknown;
  hostName: string;
}) {
  const database = await getDb();
  const [room] = await database
    .insert(gameRooms)
    .values({
      code: input.code,
      hostToken: input.hostToken,
      maxPlayers: input.maxPlayers,
      status: "lobby",
      gameState: input.gameState,
    })
    .returning({ id: gameRooms.id });
  if (!room) throw new Error("対戦ルームを保存できませんでした。");

  await database.insert(roomPlayers).values({
    roomId: room.id,
    playerToken: input.hostToken,
    displayName: input.hostName,
    seat: 0,
    isHost: 1,
  });
  return room.id;
}

export async function getGameRoomByCode(code: string) {
  const database = await getDb();
  const rows = await database.select().from(gameRooms).where(eq(gameRooms.code, code)).limit(1);
  return rows[0];
}

export async function getRoomPlayers(roomId: number) {
  const database = await getDb();
  return database.select().from(roomPlayers).where(eq(roomPlayers.roomId, roomId));
}

export async function getRoomPlayer(roomId: number, playerToken: string) {
  const database = await getDb();
  const rows = await database
    .select()
    .from(roomPlayers)
    .where(and(eq(roomPlayers.roomId, roomId), eq(roomPlayers.playerToken, playerToken)))
    .limit(1);
  return rows[0];
}

export async function addRoomPlayerRecord(input: {
  roomId: number;
  playerToken: string;
  displayName: string;
  seat: number;
}) {
  const database = await getDb();
  await database.insert(roomPlayers).values({
    roomId: input.roomId,
    playerToken: input.playerToken,
    displayName: input.displayName,
    seat: input.seat,
    isHost: 0,
  });
}

export async function updateGameRoomState(input: {
  code: string;
  expectedRevision: number;
  gameState: unknown;
  status: "lobby" | "active" | "finished";
}) {
  const database = await getDb();
  const rows = await database
    .update(gameRooms)
    .set({
      gameState: input.gameState,
      status: input.status,
      revision: input.expectedRevision + 1,
    })
    .where(and(eq(gameRooms.code, input.code), eq(gameRooms.revision, input.expectedRevision)))
    .returning({ id: gameRooms.id });
  return rows.length > 0;
}
