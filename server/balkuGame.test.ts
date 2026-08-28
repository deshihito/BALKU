import { describe, expect, it } from "vitest";
import { addLobbyPlayer, applyGameAction, createLobbyState, expireTimedOutTurn, getMarketPrice, getTotalPoints, isLegalSubmission, resetToLobby, startGame, AUCTION_LIMIT_MS, NEW_PROJECT_DEFINITIONS, TURN_LIMIT_MS, type MaterialCard, type ProjectCard } from "./balkuGame";

const plan = (id: string, points: number, effect: ProjectCard["effect"] = { type: "coins", amount: 0, label: "" }): ProjectCard => ({ id, kind: "project", name: "検証企画", points, requirements: {}, effect, immediate: false });
const twoPlayers = () => {
  let state = createLobbyState("施工者A");
  state = addLobbyPlayer(state, "施工者B");
  return startGame(state);
};

describe("BALKU game rules", () => {
  it("素材条件を満たす企画だけを正規完成として判定する", () => {
    const card: ProjectCard = { ...plan("plan", 5), requirements: { 木材: 2, 鉄骨: 1 } };
    const materials: MaterialCard[] = [{ id: "w1", kind: "material", material: "木材", name: "木材", value: 0 }, { id: "w2", kind: "material", material: "木材", name: "木材", value: 0 }, { id: "s1", kind: "material", material: "鉄骨", name: "鉄骨", value: 0 }];
    expect(isLegalSubmission(card, materials)).toBe(true);
    expect(isLegalSubmission(card, materials.slice(0, 2))).toBe(false);
  });

  it("固定山札は人数に応じて有限で、超伝導体は希少素材として含まれる", () => {
    let state = createLobbyState("施工者A");
    state = addLobbyPlayer(state, "施工者B");
    state = addLobbyPlayer(state, "施工者C");
    const started = startGame(state);
    expect(started.deckInitialCount).toBe(108);
    expect(started.deck.length).toBe(84);
    expect(started.players.map((player) => player.hand.length)).toEqual([8, 8, 8]);
    expect(started.deck.filter((card) => card.kind === "material" && card.material === "超伝導体").length).toBeLessThan(6);
  });

  it("4人用固定山札では超伝導体が最大5枚で、全144枚に対して希少に設定される", () => {
    let state = createLobbyState("施工者A");
    state = addLobbyPlayer(state, "施工者B");
    state = addLobbyPlayer(state, "施工者C");
    state = addLobbyPlayer(state, "施工者D");
    const started = startGame(state);
    const allCards = [...started.deck, ...started.players.flatMap((player) => player.hand)];
    expect(allCards).toHaveLength(144);
    const premiumCount = allCards.filter((card) => card.kind === "material" && card.material === "超伝導体").length;
    expect(premiumCount).toBeLessThanOrEqual(5);
    expect(premiumCount / allCards.length).toBeLessThanOrEqual(0.035);
  });

  it("複数の4人用ルームでも超伝導体の出現率は3.5%以下に収まる", () => {
    const sampleCount = 24;
    const premiumCounts = Array.from({ length: sampleCount }, (_, index) => {
      let state = createLobbyState(`施工者A-${index}`);
      state = addLobbyPlayer(state, "施工者B");
      state = addLobbyPlayer(state, "施工者C");
      state = addLobbyPlayer(state, "施工者D");
      const started = startGame(state);
      return [...started.deck, ...started.players.flatMap((player) => player.hand)].filter((card) => card.kind === "material" && card.material === "超伝導体").length;
    });
    expect(Math.max(...premiumCounts)).toBeLessThanOrEqual(5);
    expect(premiumCounts.reduce((sum, count) => sum + count, 0) / (sampleCount * 144)).toBeLessThanOrEqual(0.035);
  });

  it("違法建築へのBALKU成功で企画書と添付素材をコール者が獲得する", () => {
    const state = twoPlayers();
    state.players[1].submitted.push({ id: "illegal", faceUp: false, legal: false, effectActivated: false, project: plan("p", 6), materials: [{ id: "m", kind: "material", material: "木材", name: "木材", value: 0 }] });
    const next = applyGameAction(state, 0, { type: "bulkCall", targetSeat: 1, submissionId: "illegal" });
    expect(next.players[1].submitted).toHaveLength(0);
    expect(next.players[0].hand.some((card) => card.id === "p")).toBe(true);
  });

  it("正規完成した強制施工監査は一度だけ相手企画を強制違法建築として接収できる", () => {
    const state = twoPlayers();
    state.players[0].forceBulkCharges = [{ id: "audit", sourceProject: "強制施工監査", used: false }];
    state.players[1].submitted.push({ id: "legal-target", faceUp: true, legal: true, effectActivated: true, project: plan("target", 8), materials: [] });
    const next = applyGameAction(state, 0, { type: "forceBulk", chargeId: "audit", targetSeat: 1, submissionId: "legal-target" });
    expect(next.players[0].forceBulkCharges[0].used).toBe(true);
    expect(next.players[0].hand.some((card) => card.id === "target")).toBe(true);
  });

  it("抜き打ち検品は唯一の対戦相手からランダムな手札1枚を奪う", () => {
    const state = twoPlayers();
    const steal = plan("steal", 1, { type: "stealCard", amount: 1, label: "手札を奪う" });
    steal.immediate = true;
    state.players[0].hand = [steal];
    state.players[1].hand = [plan("target", 7)];
    const next = applyGameAction(state, 0, { type: "submit", projectId: "steal", materialIds: [], faceUp: true });
    expect(next.players[0].hand.some((card) => card.id === "target")).toBe(true);
  });

  it("即時調達企画は指定素材を手札へ直接加える", () => {
    const state = twoPlayers();
    const supply = plan("supply", 0, { type: "gainMaterial", amount: 2, label: "合金を2枚獲得", material: "合金" });
    supply.immediate = true;
    state.players[0].hand = [supply];
    const next = applyGameAction(state, 0, { type: "submit", projectId: "supply", materialIds: [], faceUp: true });
    expect(next.players[0].hand.filter((card) => card.kind === "material" && card.material === "合金")).toHaveLength(2);
  });

  it("調達市場は高いコインを払い、指定素材を得て自動で手番を進める", () => {
    const state = twoPlayers();
    state.players[0].coins = 10;
    const next = applyGameAction(state, 0, { type: "buyMaterial", material: "超伝導体" });
    expect(getMarketPrice("超伝導体")).toBe(10);
    expect(next.players[0].coins).toBe(0);
    expect(next.players[0].hand.some((card) => card.kind === "material" && card.material === "超伝導体")).toBe(true);
    expect(next.activeSeat).toBe(1);
  });

  it("素材・企画を一律1コインで売却しても、同じ施工ターンと行動権を維持する", () => {
    const state = twoPlayers();
    const lumber: MaterialCard = { id: "lumber", kind: "material", material: "木材", name: "木材", value: 0 };
    const alloy: MaterialCard = { id: "alloy", kind: "material", material: "合金", name: "合金", value: 0 };
    state.players[0].coins = 3;
    state.players[0].hand = [lumber, alloy, plan("keep", 5)];
    const next = applyGameAction(state, 0, { type: "sellCards", cardIds: [lumber.id, alloy.id, "keep"] });
    expect(next.players[0].coins).toBe(6);
    expect(next.players[0].hand).toEqual([]);
    expect(next.activeSeat).toBe(0);
    expect(next.players[0].actionUsed).toBe(false);
  });

  it("空選択または手札外カードの売却を拒否する", () => {
    const state = twoPlayers();
    const project = plan("project", 4);
    state.players[0].hand = [project];
    expect(() => applyGameAction(state, 0, { type: "sellCards", cardIds: [] })).toThrow("売却するカードを1枚以上");
    expect(() => applyGameAction(state, 0, { type: "sellCards", cardIds: ["missing"] })).toThrow("手札にあるカードのみ");
  });

  it("企画提出後は手動終了を待たずに次の施工者へ移る", () => {
    const state = twoPlayers();
    const immediate = plan("quick", 1, { type: "coins", amount: 2, label: "コイン +2" });
    immediate.immediate = true;
    state.players[0].hand = [immediate];
    const next = applyGameAction(state, 0, { type: "submit", projectId: "quick", materialIds: [], faceUp: true });
    expect(next.activeSeat).toBe(1);
    expect(next.players[1].hand).toHaveLength(10);
  });

  it("施工ターンは60秒で期限切れとなり、行動なしで自動パスする", () => {
    const state = twoPlayers();
    expect(state.turnDeadlineAt).not.toBeNull();
    expect(state.turnDeadlineAt! - Date.now()).toBeLessThanOrEqual(TURN_LIMIT_MS);
    const next = expireTimedOutTurn(state, state.turnDeadlineAt! + 1);
    expect(next.activeSeat).toBe(1);
    expect(next.turn).toBe(2);
    expect(next.turnDeadlineAt).toBeGreaterThan(Date.now() + TURN_LIMIT_MS - 1_000);
    expect(next.logs[1]?.text).toContain("施工時間が終了");
  });

  it("期限を持たない既存の対戦ルームには自動パスせず60秒期限を付与する", () => {
    const state = twoPlayers();
    state.turnDeadlineAt = null;
    const next = expireTimedOutTurn(state, 1_000);
    expect(next.activeSeat).toBe(0);
    expect(next.turn).toBe(1);
    expect(next.turnDeadlineAt).toBe(1_000 + TURN_LIMIT_MS);
  });

  it("継続収入企画は所有者の次の施工ターン開始時にコインを与える", () => {
    const state = twoPlayers();
    state.players[0].submitted.push({ id: "income", faceUp: true, legal: true, effectActivated: true, project: plan("income-plan", 6, { type: "income", amount: 1, label: "毎ターン +1" }), materials: [] });
    state.players[0].coins = 3;
    const next = applyGameAction(state, 0, { type: "endTurn" });
    const returned = applyGameAction(next, 1, { type: "endTurn" });
    expect(returned.activeSeat).toBe(0);
    expect(returned.players[0].coins).toBe(4);
  });

  it("一巡すると山札から自動オークションが開き、誰でも入札して次の一巡で落札できる", () => {
    const state = twoPlayers();
    const afterA = applyGameAction(state, 0, { type: "endTurn" });
    const opened = applyGameAction(afterA, 1, { type: "endTurn" });
    expect(opened.auction).not.toBeNull();
    const item = opened.auction!.card.id;
    const bid = applyGameAction(opened, 1, { type: "bid", amount: 1 });
    expect(bid.auction!.deadlineAt).toBeGreaterThan(Date.now() + AUCTION_LIMIT_MS - 1_000);
    const afterNextA = applyGameAction(bid, 0, { type: "endTurn" });
    afterNextA.auction!.deadlineAt = 0;
    const settled = expireTimedOutTurn(afterNextA, 1_000);
    expect(settled.players[1].hand.some((card) => card.id === item)).toBe(true);
  });

  it("連続入札のたびにオークション期限が15秒へリセットされる", () => {
    const state = twoPlayers();
    const afterA = applyGameAction(state, 0, { type: "endTurn" });
    const opened = applyGameAction(afterA, 1, { type: "endTurn" });
    const first = applyGameAction(opened, 0, { type: "bid", amount: 1 });
    const firstDeadline = first.auction!.deadlineAt;
    const second = applyGameAction(first, 1, { type: "bid", amount: 2 });
    expect(second.auction!.highestBid).toBe(2);
    expect(second.auction!.deadlineAt).toBeGreaterThanOrEqual(firstDeadline);
    expect(second.auction!.deadlineAt - Date.now()).toBeGreaterThan(AUCTION_LIMIT_MS - 1_000);
  });

  it("3人卓のオークションは15秒経過時に入札なしで取り下げる", () => {
    let state = createLobbyState("施工者A");
    state = addLobbyPlayer(state, "施工者B");
    state = addLobbyPlayer(state, "施工者C");
    state = startGame(state);
    state = applyGameAction(state, 0, { type: "endTurn" });
    state = applyGameAction(state, 1, { type: "endTurn" });
    state = applyGameAction(state, 2, { type: "endTurn" });
    expect(state.auction).not.toBeNull();
    const auctionDeadline = state.auction!.deadlineAt;
    const expired = expireTimedOutTurn(state, auctionDeadline + 1);
    expect(expired.auction).toBeNull();
    expect(expired.logs[0]?.text).toContain("自動オークション不成立");
    expect(expired.activeSeat).toBe(0);
  });

  it("新規4企画のカード条件・得点・効果・コピー数が仕様どおりである", () => {
    expect(NEW_PROJECT_DEFINITIONS.map(({ card }) => card.name)).toEqual(["ミステリーハウス", "丸木小屋", "光ファイバー通信", "ミュージアム"]);
    expect(NEW_PROJECT_DEFINITIONS.map(({ copies }) => copies)).toEqual([1, 3, 2, 2]);
    expect(NEW_PROJECT_DEFINITIONS.map(({ card }) => card.points)).toEqual([5, 6, 1, 2]);
    expect(NEW_PROJECT_DEFINITIONS[0].card.requirements).toEqual({ 超伝導体: 2, 銅線: 3, コンクリート: 2, 鉄骨: 2 });
    expect(NEW_PROJECT_DEFINITIONS[0].card.effect.type).toBe("mysteryHouse");
    expect(NEW_PROJECT_DEFINITIONS[2].card.effect.material).toBe("超伝導体");
    expect(NEW_PROJECT_DEFINITIONS[3].card.effect.type).toBe("randomProject");
  });

  it("ミステリーハウスの毎ターン素材獲得とミュージアムの企画獲得が機能する", () => {
    const state = twoPlayers();
    const mystery = plan("mystery", 5, { type: "mysteryHouse", amount: 1, label: "+3コイン / 毎ターン ランダム素材 +1" });
    state.players[0].coins = 3;
    state.players[0].hand = [mystery];
    const afterMystery = applyGameAction(state, 0, { type: "submit", projectId: "mystery", materialIds: [], faceUp: true });
    expect(afterMystery.players[0].coins).toBe(6);
    const projectOnDeck = plan("museum-prize", 4);
    afterMystery.deck = [projectOnDeck, { id: "deck-material-1", kind: "material", material: "木材", name: "木材", value: 0 }, { id: "deck-material-2", kind: "material", material: "鉄骨", name: "鉄骨", value: 0 }, { id: "deck-material-3", kind: "material", material: "ガラス", name: "ガラス", value: 0 }, { id: "deck-material-4", kind: "material", material: "銅線", name: "銅線", value: 0 }, { id: "deck-material-5", kind: "material", material: "合金", name: "合金", value: 0 }];
    const museum = plan("museum", 2, { type: "randomProject", amount: 1, label: "ランダムな企画カードを1枚獲得" });
    museum.immediate = true;
    afterMystery.activeSeat = 0;
    afterMystery.players[0].actionUsed = false;
    afterMystery.players[0].hand = [museum];
    const afterMuseum = applyGameAction(afterMystery, 0, { type: "submit", projectId: "museum", materialIds: [], faceUp: true });
    expect(afterMuseum.players[0].hand.some((card) => card.id === "museum-prize")).toBe(true);
    const afterB = applyGameAction(afterMuseum, 1, { type: "endTurn" });
    expect(afterB.players[0].hand.some((card) => card.kind === "material")).toBe(true);
    expect(afterB.players[0].coins).toBe(6);
  });

  it("丸木小屋のコイン獲得と光ファイバー通信の超伝導体獲得が機能する", () => {
    const state = twoPlayers();
    const cabin = plan("cabin", 6, { type: "coins", amount: 1, label: "コイン +1" });
    cabin.requirements = { 木材: 3 };
    cabin.immediate = false;
    const lumber: MaterialCard[] = [1, 2, 3].map((id) => ({ id: `wood-${id}`, kind: "material", material: "木材", name: "木材", value: 0 }));
    state.players[0].coins = 3;
    state.players[0].hand = [cabin, ...lumber];
    const afterCabin = applyGameAction(state, 0, { type: "submit", projectId: "cabin", materialIds: lumber.map((card) => card.id), faceUp: true });
    expect(afterCabin.players[0].coins).toBe(4);
    const fiber = plan("fiber", 1, { type: "gainMaterial", amount: 1, label: "超伝導体を1枚獲得", material: "超伝導体" });
    fiber.requirements = { 銅線: 3 };
    fiber.immediate = false;
    const wires: MaterialCard[] = [1, 2, 3].map((id) => ({ id: `wire-${id}`, kind: "material", material: "銅線", name: "銅線", value: 0 }));
    afterCabin.activeSeat = 0;
    afterCabin.players[0].actionUsed = false;
    afterCabin.players[0].hand = [fiber, ...wires];
    const afterFiber = applyGameAction(afterCabin, 0, { type: "submit", projectId: "fiber", materialIds: wires.map((card) => card.id), faceUp: true });
    expect(afterFiber.players[0].hand.some((card) => card.kind === "material" && card.material === "超伝導体")).toBe(true);
  });

  it("新規企画の提出点が最終精算へ反映される", () => {
    const state = twoPlayers();
    state.deck = [];
    const mystery = NEW_PROJECT_DEFINITIONS[0].card;
    state.players[0].submitted.push({ id: "mystery-final", faceUp: true, legal: true, effectActivated: true, project: mystery, materials: [] });
    const finished = applyGameAction(state, 0, { type: "endTurn" });
    expect(finished.phase).toBe("finished");
    expect(finished.finalScores.find((score) => score.seat === 0)?.submittedPoints).toBe(5);
  });

  it("山札が尽きるとCHALLENGEなしで総ポイントを精算する", () => {
    const state = twoPlayers();
    state.deck = [];
    state.players[0].submitted.push({ id: "a", faceUp: false, legal: false, effectActivated: false, project: plan("a", 6), materials: [] });
    state.players[1].submitted.push({ id: "b", faceUp: false, legal: false, effectActivated: false, project: plan("b", 5), materials: [] });
    state.players[0].hand = [plan("pass", 1)];
    const next = applyGameAction(state, 0, { type: "submit", projectId: "pass", materialIds: [], faceUp: false });
    expect(next.phase).toBe("finished");
    expect(next.winnerSeat).toBe(0);
    expect(next.finalScores[0].points).toBe(7);
  });

  it("同点の最終精算は先手優先にせず共同勝利として扱う", () => {
    const state = twoPlayers();
    state.deck = [];
    state.players[0].submitted.push({ id: "a", faceUp: true, legal: true, effectActivated: true, project: plan("a", 5), materials: [] });
    state.players[1].submitted.push({ id: "b", faceUp: true, legal: true, effectActivated: true, project: plan("b", 5), materials: [] });
    state.players[0].hand = [plan("pass", 0)];
    const next = applyGameAction(state, 0, { type: "submit", projectId: "pass", materialIds: [], faceUp: false });
    expect(next.winnerSeat).toBeNull();
    expect(next.winnerSeats).toEqual([0, 1]);
  });

  it("再戦準備では参加者の席順を維持してロビーに戻す", () => {
    const state = twoPlayers();
    state.phase = "finished";
    const lobby = resetToLobby(state);
    expect(lobby.phase).toBe("lobby");
    expect(lobby.players.map((player) => player.name)).toEqual(["施工者A", "施工者B"]);
  });

  it("提出済み企画とバフの合計を最終ポイントに利用する", () => {
    const state = createLobbyState("施工者A");
    state.players[0].scoreBonus = 3;
    state.players[0].submitted.push({ id: "points", faceUp: true, legal: true, effectActivated: true, project: plan("p", 8), materials: [] });
    expect(getTotalPoints(state.players[0])).toBe(11);
  });

  it("調達市場はコイン不足時に購入を拒否する", () => {
    const state = twoPlayers();
    state.players[0].coins = 4;
    expect(() => applyGameAction(state, 0, { type: "buyMaterial", material: "木材" })).toThrow("5コイン必要です");
  });

  it("継続収入企画を強制BALKUで接収された後は、次の施工ターンに収入を得ない", () => {
    const state = twoPlayers();
    state.players[0].submitted.push({ id: "income", faceUp: true, legal: true, effectActivated: true, project: plan("income-plan", 6, { type: "income", amount: 1, label: "毎ターン +1" }), materials: [] });
    state.players[1].forceBulkCharges = [{ id: "audit", sourceProject: "強制施工監査", used: false }];
    const seized = applyGameAction(state, 1, { type: "forceBulk", chargeId: "audit", targetSeat: 0, submissionId: "income" });
    const afterOwnerPass = applyGameAction(seized, 0, { type: "endTurn" });
    const returned = applyGameAction(afterOwnerPass, 1, { type: "endTurn" });
    expect(returned.players[0].submitted).toHaveLength(0);
    expect(returned.players[0].coins).toBe(3);
  });

  it("超伝導体を使う高得点企画は正規完成時に効果を発動し、最終精算へ反映される", () => {
    const state = twoPlayers();
    const quantum: ProjectCard = {
      id: "quantum",
      kind: "project",
      name: "量子通信塔",
      points: 11,
      requirements: { 超伝導体: 2, 合金: 1, ガラス: 1 },
      effect: { type: "coins", amount: 7, label: "コイン +7" },
      immediate: false,
    };
    const materials: MaterialCard[] = [
      { id: "rare-1", kind: "material", material: "超伝導体", name: "超伝導体", value: 0, rarity: "premium" },
      { id: "rare-2", kind: "material", material: "超伝導体", name: "超伝導体", value: 0, rarity: "premium" },
      { id: "alloy", kind: "material", material: "合金", name: "合金", value: 0 },
      { id: "glass", kind: "material", material: "ガラス", name: "ガラス", value: 0 },
    ];
    state.deck = [];
    state.players[0].hand = [quantum, ...materials];
    const next = applyGameAction(state, 0, { type: "submit", projectId: "quantum", materialIds: materials.map((card) => card.id), faceUp: true });
    expect(next.players[0].coins).toBe(10);
    expect(next.phase).toBe("finished");
    expect(next.finalScores[0]).toMatchObject({ seat: 0, submittedPoints: 11, points: 11 });
  });

  it("通常BALKUと強制BALKUの後でも、山札消尽時に最終精算できる", () => {
    const state = twoPlayers();
    state.deck = [];
    state.players[1].submitted.push({ id: "illegal", faceUp: false, legal: false, effectActivated: false, project: plan("illegal-plan", 3), materials: [] });
    const afterNormalBulk = applyGameAction(state, 0, { type: "bulkCall", targetSeat: 1, submissionId: "illegal" });
    afterNormalBulk.players[0].forceBulkCharges = [{ id: "audit", sourceProject: "強制施工監査", used: false }];
    afterNormalBulk.players[1].submitted.push({ id: "legal", faceUp: true, legal: true, effectActivated: true, project: plan("legal-plan", 6), materials: [] });
    const afterForceBulk = applyGameAction(afterNormalBulk, 0, { type: "forceBulk", chargeId: "audit", targetSeat: 1, submissionId: "legal" });
    const finished = applyGameAction(afterForceBulk, 0, { type: "endTurn" });
    expect(afterForceBulk.players[0].forceBulkCharges[0].used).toBe(true);
    expect(afterForceBulk.players[1].submitted).toHaveLength(0);
    expect(finished.phase).toBe("finished");
  });

  it("即時バフは提出行動を消費し、対象指定デバフと強制BALKUは対象・回数制限を守る", () => {
    const boostState = twoPlayers();
    const drawBoost = plan("draw-boost", 0, { type: "draw", amount: 2, label: "カードを2枚引く" });
    drawBoost.immediate = true;
    boostState.players[0].hand = [drawBoost];
    const afterBoost = applyGameAction(boostState, 0, { type: "submit", projectId: drawBoost.id, materialIds: [], faceUp: true });
    expect(afterBoost.players[0].hand).toHaveLength(2);
    expect(afterBoost.activeSeat).toBe(1);

    const debuffState = twoPlayers();
    const freeze = plan("freeze", 1, { type: "discard", amount: 1, label: "手札を1枚破棄" });
    freeze.immediate = true;
    debuffState.players[0].hand = [freeze];
    expect(() => applyGameAction(debuffState, 0, { type: "submit", projectId: freeze.id, materialIds: [], faceUp: true })).toThrow("対象となる他社");
    expect(() => applyGameAction(debuffState, 0, { type: "submit", projectId: freeze.id, materialIds: [], faceUp: true, targetSeat: 0 })).toThrow("自分自身");

    const forceState = twoPlayers();
    forceState.players[0].forceBulkCharges = [{ id: "once", sourceProject: "強制施工監査", used: false }];
    forceState.players[1].submitted.push({ id: "target", faceUp: true, legal: true, effectActivated: true, project: plan("target", 6), materials: [] });
    const afterForce = applyGameAction(forceState, 0, { type: "forceBulk", chargeId: "once", targetSeat: 1, submissionId: "target" });
    expect(afterForce.players[0].forceBulkCharges[0].used).toBe(true);
    expect(() => applyGameAction(afterForce, 0, { type: "forceBulk", chargeId: "once", targetSeat: 1, submissionId: "target" })).toThrow("使用可能な強制BALKU権がありません");
  });
});
