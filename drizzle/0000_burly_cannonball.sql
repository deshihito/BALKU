CREATE TABLE `gameRooms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(10) NOT NULL,
	`hostToken` varchar(64) NOT NULL,
	`status` enum('lobby','active','finished') NOT NULL DEFAULT 'lobby',
	`maxPlayers` int NOT NULL DEFAULT 4,
	`gameState` json NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `gameRooms_id` PRIMARY KEY(`id`),
	CONSTRAINT `gameRooms_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `roomPlayers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`roomId` int NOT NULL,
	`playerToken` varchar(64) NOT NULL,
	`displayName` varchar(24) NOT NULL,
	`seat` int NOT NULL,
	`isHost` int NOT NULL DEFAULT 0,
	`joinedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `roomPlayers_id` PRIMARY KEY(`id`),
	CONSTRAINT `room_player_token_uq` UNIQUE(`roomId`,`playerToken`),
	CONSTRAINT `room_player_seat_uq` UNIQUE(`roomId`,`seat`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`openId` varchar(64) NOT NULL,
	`name` text,
	`email` varchar(320),
	`loginMethod` varchar(64),
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_openId_unique` UNIQUE(`openId`)
);
