CREATE TYPE "public"."room_status" AS ENUM('lobby', 'active', 'finished');--> statement-breakpoint
CREATE TABLE "gameRooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(10) NOT NULL,
	"hostToken" varchar(64) NOT NULL,
	"status" "room_status" DEFAULT 'lobby' NOT NULL,
	"maxPlayers" integer DEFAULT 4 NOT NULL,
	"isPublic" boolean DEFAULT true NOT NULL,
	"gameState" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gameRooms_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "roomPlayers" (
	"id" serial PRIMARY KEY NOT NULL,
	"roomId" integer NOT NULL,
	"playerToken" varchar(64) NOT NULL,
	"displayName" varchar(24) NOT NULL,
	"seat" integer NOT NULL,
	"isHost" integer DEFAULT 0 NOT NULL,
	"joinedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "room_player_token_uq" ON "roomPlayers" USING btree ("roomId","playerToken");--> statement-breakpoint
CREATE UNIQUE INDEX "room_player_seat_uq" ON "roomPlayers" USING btree ("roomId","seat");