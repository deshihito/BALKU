import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { gameRooms, InsertUser, roomPlayers, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function createGameRoomRecord(input: {
  code: string;
  hostToken: string;
  maxPlayers: number;
  gameState: unknown;
  hostName: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("対戦ルームを保存できません。データベース接続を確認してください。");
  const result = await db.insert(gameRooms).values({
    code: input.code,
    hostToken: input.hostToken,
    maxPlayers: input.maxPlayers,
    status: "lobby",
    gameState: input.gameState,
  });
  const roomId = Number((result as unknown as [{ insertId: number }])[0].insertId);
  await db.insert(roomPlayers).values({
    roomId,
    playerToken: input.hostToken,
    displayName: input.hostName,
    seat: 0,
    isHost: 1,
  });
  return roomId;
}

export async function getGameRoomByCode(code: string) {
  const db = await getDb();
  if (!db) throw new Error("対戦ルームを取得できません。データベース接続を確認してください。");
  const rows = await db.select().from(gameRooms).where(eq(gameRooms.code, code)).limit(1);
  return rows[0];
}

export async function getRoomPlayers(roomId: number) {
  const db = await getDb();
  if (!db) throw new Error("参加者を取得できません。データベース接続を確認してください。");
  return db.select().from(roomPlayers).where(eq(roomPlayers.roomId, roomId));
}

export async function getRoomPlayer(roomId: number, playerToken: string) {
  const db = await getDb();
  if (!db) throw new Error("参加者を取得できません。データベース接続を確認してください。");
  const rows = await db.select().from(roomPlayers).where(and(eq(roomPlayers.roomId, roomId), eq(roomPlayers.playerToken, playerToken))).limit(1);
  return rows[0];
}

export async function addRoomPlayerRecord(input: { roomId: number; playerToken: string; displayName: string; seat: number }) {
  const db = await getDb();
  if (!db) throw new Error("参加者を保存できません。データベース接続を確認してください。");
  await db.insert(roomPlayers).values({
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
  const db = await getDb();
  if (!db) throw new Error("対戦ルームを更新できません。データベース接続を確認してください。");
  const result = await db
    .update(gameRooms)
    .set({ gameState: input.gameState, status: input.status, revision: input.expectedRevision + 1 })
    .where(and(eq(gameRooms.code, input.code), eq(gameRooms.revision, input.expectedRevision)));
  return Number((result as unknown as [{ affectedRows: number }])[0]?.affectedRows ?? 0) > 0;
}
