import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const roomStatus = pgEnum("room_status", ["lobby", "active", "finished"]);

/** Shared online game room. gameState contains only server-validated board state. */
export const gameRooms = pgTable("gameRooms", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 10 }).notNull().unique(),
  hostToken: varchar("hostToken", { length: 64 }).notNull(),
  status: roomStatus("status").default("lobby").notNull(),
  maxPlayers: integer("maxPlayers").default(4).notNull(),
  gameState: jsonb("gameState").notNull(),
  revision: integer("revision").default(1).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

/** Anonymous test participants identified by a room-scoped player token. */
export const roomPlayers = pgTable(
  "roomPlayers",
  {
    id: serial("id").primaryKey(),
    roomId: integer("roomId").notNull(),
    playerToken: varchar("playerToken", { length: 64 }).notNull(),
    displayName: varchar("displayName", { length: 24 }).notNull(),
    seat: integer("seat").notNull(),
    isHost: integer("isHost").default(0).notNull(),
    joinedAt: timestamp("joinedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex("room_player_token_uq").on(table.roomId, table.playerToken),
    uniqueIndex("room_player_seat_uq").on(table.roomId, table.seat),
  ],
);

export type GameRoom = typeof gameRooms.$inferSelect;
export type RoomPlayer = typeof roomPlayers.$inferSelect;
