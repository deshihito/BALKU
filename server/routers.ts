import { TRPCError } from "@trpc/server";
import { customAlphabet, nanoid } from "nanoid";
import { z } from "zod";
import {
  addRoomPlayerRecord,
  createGameRoomRecord,
  getGameRoomByCode,
  getRoomPlayer,
  getRoomPlayers,
  updateGameRoomState,
} from "./db";
import { addLobbyPlayer, applyGameAction, createLobbyState, expireTimedOutTurn, resetToLobby, type GameAction, type RoomGameState, startGame } from "./balkuGame";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";

const roomCode = customAlphabet("ABCDEFGHJKMNPQRSTUVWXYZ23456789", 6);
const nameSchema = z.string().trim().min(2, "ユーザー名は2文字以上で入力してください。").max(24, "ユーザー名は24文字以内です。");
const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/, "ルームコードは6文字です。");
const tokenSchema = z.string().min(16).max(64);
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("submit"), projectId: z.string(), materialIds: z.array(z.string()).max(9), faceUp: z.boolean(), targetSeat: z.number().int().min(0).max(3).optional() }),
  z.object({ type: z.literal("buyMaterial"), material: z.enum(["木材", "鉄骨", "コンクリート", "ガラス", "銅線", "合金", "超伝導体"]) }),
  z.object({ type: z.literal("sellCards"), cardIds: z.array(z.string()).min(1).max(72) }),
  z.object({ type: z.literal("bid"), amount: z.number().int().min(1).max(99) }),
  z.object({ type: z.literal("bulkCall"), targetSeat: z.number().int().min(0).max(3), submissionId: z.string() }),
  z.object({ type: z.literal("forceBulk"), chargeId: z.string(), targetSeat: z.number().int().min(0).max(3), submissionId: z.string() }),
  z.object({ type: z.literal("endTurn") }),
]);

const parseState = (value: unknown) => (typeof value === "string" ? (JSON.parse(value) as RoomGameState) : (value as RoomGameState));

const snapshotFor = (state: RoomGameState, viewerSeat: number) => {
  const { deck, ...visibleState } = state;
  return {
  ...visibleState,
  deckCount: deck.length,
  players: state.players.map((player) => ({
    ...player,
    hand: player.seat === viewerSeat ? player.hand : [],
    handCount: player.hand.length,
    submitted: player.submitted.map((submission) => {
      const visible = submission.faceUp || player.seat === viewerSeat;
      return visible
        ? { ...submission, materialCount: submission.materials.length }
        : {
            ...submission,
            legal: false,
            effectActivated: false,
            project: { ...submission.project, name: "非開示企画", points: 0, requirements: {}, effect: { type: "coins" as const, amount: 0, label: "BALKUで開示" } },
            materials: [],
            materialCount: submission.materials.length,
          };
    }),
  })),
  };
};

const loadRoomAndPlayer = async (code: string, playerToken: string) => {
  const room = await getGameRoomByCode(code);
  if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "ルームが見つかりません。" });
  const player = await getRoomPlayer(room.id, playerToken);
  if (!player) throw new TRPCError({ code: "FORBIDDEN", message: "このルームの参加権限がありません。" });
  return { room, player, state: parseState(room.gameState) };
};

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  balku: router({
    createRoom: publicProcedure
      .input(z.object({ displayName: nameSchema, maxPlayers: z.number().int().min(2).max(4) }))
      .mutation(async ({ input }) => {
        const code = roomCode();
        const playerToken = nanoid(32);
        const state = createLobbyState(input.displayName);
        await createGameRoomRecord({ code, hostToken: playerToken, maxPlayers: input.maxPlayers, gameState: state, hostName: input.displayName });
        return { code, playerToken };
      }),
    joinRoom: publicProcedure
      .input(z.object({ code: codeSchema, displayName: nameSchema }))
      .mutation(async ({ input }) => {
        const room = await getGameRoomByCode(input.code);
        if (!room) throw new TRPCError({ code: "NOT_FOUND", message: "ルームが見つかりません。" });
        const players = await getRoomPlayers(room.id);
        if (room.status !== "lobby") throw new TRPCError({ code: "BAD_REQUEST", message: "この対戦はすでに開始されています。" });
        if (players.length >= room.maxPlayers) throw new TRPCError({ code: "BAD_REQUEST", message: "このルームは満席です。" });
        const state = addLobbyPlayer(parseState(room.gameState), input.displayName);
        const playerToken = nanoid(32);
        const saved = await updateGameRoomState({ code: input.code, expectedRevision: room.revision, gameState: state, status: "lobby" });
        if (!saved) throw new TRPCError({ code: "CONFLICT", message: "参加が重なりました。もう一度お試しください。" });
        await addRoomPlayerRecord({ roomId: room.id, playerToken, displayName: input.displayName, seat: state.players.length - 1 });
        return { code: input.code, playerToken };
      }),
    getRoom: publicProcedure
      .input(z.object({ code: codeSchema, playerToken: tokenSchema }))
      .query(async ({ input }) => {
        const loaded = await loadRoomAndPlayer(input.code, input.playerToken);
        let { room, state } = loaded;
        const expiredState = expireTimedOutTurn(state);
        if (expiredState !== state) {
          const status = expiredState.phase === "finished" ? "finished" : "active";
          const saved = await updateGameRoomState({ code: input.code, expectedRevision: room.revision, gameState: expiredState, status });
          if (saved) {
            state = expiredState;
            room = { ...room, revision: room.revision + 1, status };
          } else {
            const currentRoom = await getGameRoomByCode(input.code);
            if (!currentRoom) throw new TRPCError({ code: "NOT_FOUND", message: "ルームが見つかりません。" });
            room = currentRoom;
            state = parseState(currentRoom.gameState);
          }
        }
        return {
          code: room.code,
          status: room.status,
          revision: room.revision,
          maxPlayers: room.maxPlayers,
          player: { seat: loaded.player.seat, displayName: loaded.player.displayName, isHost: loaded.player.isHost === 1 },
          state: snapshotFor(state, loaded.player.seat),
        };
      }),
    startGame: publicProcedure
      .input(z.object({ code: codeSchema, playerToken: tokenSchema, expectedRevision: z.number().int().min(1) }))
      .mutation(async ({ input }) => {
        const { room, player, state } = await loadRoomAndPlayer(input.code, input.playerToken);
        if (player.isHost !== 1) throw new TRPCError({ code: "FORBIDDEN", message: "対戦を開始できるのはルーム作成者だけです。" });
        if (room.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "最新の参加状況を確認してください。" });
        try {
          const next = startGame(state);
          const saved = await updateGameRoomState({ code: input.code, expectedRevision: room.revision, gameState: next, status: "active" });
          if (!saved) throw new Error("競合");
          return { success: true };
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "対戦開始に失敗しました。" });
        }
      }),
    restartGame: publicProcedure
      .input(z.object({ code: codeSchema, playerToken: tokenSchema, expectedRevision: z.number().int().min(1) }))
      .mutation(async ({ input }) => {
        const { room, player, state } = await loadRoomAndPlayer(input.code, input.playerToken);
        if (player.isHost !== 1) throw new TRPCError({ code: "FORBIDDEN", message: "再戦を準備できるのはルーム作成者だけです。" });
        if (room.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "盤面が更新されました。もう一度お試しください。" });
        if (room.status !== "finished") throw new TRPCError({ code: "BAD_REQUEST", message: "対戦終了後に再戦を準備できます。" });
        const next = resetToLobby(state);
        const saved = await updateGameRoomState({ code: input.code, expectedRevision: room.revision, gameState: next, status: "lobby" });
        if (!saved) throw new TRPCError({ code: "CONFLICT", message: "再戦の準備が重なりました。もう一度お試しください。" });
        return { success: true };
      }),
    move: publicProcedure
      .input(z.object({ code: codeSchema, playerToken: tokenSchema, expectedRevision: z.number().int().min(1), action: actionSchema }))
      .mutation(async ({ input }) => {
        const { room, player, state } = await loadRoomAndPlayer(input.code, input.playerToken);
        if (room.revision !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "誰かが先に操作しました。盤面を同期しました。" });
        const expiredState = expireTimedOutTurn(state);
        if (expiredState !== state) {
          const status = expiredState.phase === "finished" ? "finished" : "active";
          const saved = await updateGameRoomState({ code: input.code, expectedRevision: room.revision, gameState: expiredState, status });
          throw new TRPCError({ code: "CONFLICT", message: saved ? "施工時間が終了したため、自動パスしました。" : "手番状態が更新されました。盤面を同期しました。" });
        }
        try {
          const next = applyGameAction(state, player.seat, input.action as GameAction);
          const status = next.phase === "finished" ? "finished" : next.phase === "active" ? "active" : "lobby";
          const saved = await updateGameRoomState({ code: input.code, expectedRevision: room.revision, gameState: next, status });
          if (!saved) throw new Error("競合");
          return { success: true };
        } catch (error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "操作を処理できませんでした。" });
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
