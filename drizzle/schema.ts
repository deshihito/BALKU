import { int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** 共有可能な対戦ルーム。gameStateにはサーバーが判定する盤面状態だけを保存する。 */
export const gameRooms = mysqlTable("gameRooms", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 10 }).notNull().unique(),
  hostToken: varchar("hostToken", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["lobby", "active", "finished"]).default("lobby").notNull(),
  maxPlayers: int("maxPlayers").default(4).notNull(),
  gameState: json("gameState").notNull(),
  revision: int("revision").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/** 匿名のテスト参加者。ブラウザごとのプレイヤートークンで行動権を識別する。 */
export const roomPlayers = mysqlTable(
  "roomPlayers",
  {
    id: int("id").autoincrement().primaryKey(),
    roomId: int("roomId").notNull(),
    playerToken: varchar("playerToken", { length: 64 }).notNull(),
    displayName: varchar("displayName", { length: 24 }).notNull(),
    seat: int("seat").notNull(),
    isHost: int("isHost").default(0).notNull(),
    joinedAt: timestamp("joinedAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("room_player_token_uq").on(table.roomId, table.playerToken),
    uniqueIndex("room_player_seat_uq").on(table.roomId, table.seat),
  ],
);

export type GameRoom = typeof gameRooms.$inferSelect;
export type RoomPlayer = typeof roomPlayers.$inferSelect;
