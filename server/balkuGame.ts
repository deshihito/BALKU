export type MaterialKind = "木材" | "鉄骨" | "コンクリート" | "ガラス" | "銅線" | "合金" | "超伝導体" | "ゴミ";
export type EffectType = "coins" | "draw" | "gainMaterial" | "randomMaterial" | "randomProject" | "pointBoost" | "income" | "randomMaterialIncome" | "mysteryHouse" | "stealCoins" | "stealCard" | "discard" | "forceBulk";

export type MaterialCard = { id: string; kind: "material"; material: MaterialKind; name: string; value: number; rarity?: "premium" };
export type ProjectCard = {
  id: string;
  kind: "project";
  name: string;
  points: number;
  requirements: Partial<Record<MaterialKind, number>>;
  effect: { type: EffectType; amount: number; label: string; material?: MaterialKind };
  immediate: boolean;
};
export type GameCard = MaterialCard | ProjectCard;
export type Submission = {
  id: string;
  project: ProjectCard;
  materials: MaterialCard[];
  faceUp: boolean;
  legal: boolean;
  effectActivated: boolean;
  effectTargetSeat?: number;
};
export type ForceBulkCharge = { id: string; sourceProject: string; used: boolean };
export type GamePlayer = {
  seat: number;
  name: string;
  coins: number;
  hand: GameCard[];
  submitted: Submission[];
  eliminated: boolean;
  actionUsed: boolean;
  scoreBonus: number;
  forceBulkCharges: ForceBulkCharge[];
};
export type Auction = { card: GameCard; highestBid: number; highestBidderSeat: number | null; deadlineAt: number; roundOpened: number };
export type LogTone = "neutral" | "good" | "warning" | "danger";
export type GameLog = { id: string; text: string; tone: LogTone; createdAt: number };
export type FinalScore = { seat: number; name: string; points: number; submittedPoints: number; bonusPoints: number };
export type RoomGameState = {
  phase: "lobby" | "active" | "finished";
  turn: number;
  activeSeat: number;
  turnDeadlineAt: number | null;
  deck: GameCard[];
  deckInitialCount: number;
  turnsPerPlayer: number;
  players: GamePlayer[];
  logs: GameLog[];
  auction: Auction | null;
  winnerSeat: number | null;
  winnerSeats: number[];
  finalScores: FinalScore[];
  serial: number;
};
export type GameAction =
  | { type: "submit"; projectId: string; materialIds: string[]; faceUp: boolean; targetSeat?: number }
  | { type: "buyMaterial"; material: MaterialKind }
  | { type: "sellCards"; cardIds: string[] }
  | { type: "bid"; amount: number }
  | { type: "bulkCall"; targetSeat: number; submissionId: string }
  | { type: "forceBulk"; chargeId: string; targetSeat: number; submissionId: string }
  | { type: "endTurn" };

const materialKinds: MaterialKind[] = ["木材", "鉄骨", "コンクリート", "ガラス", "銅線", "合金", "ゴミ"];
const targetedEffects: EffectType[] = ["stealCoins", "discard"];
const marketPrices: Record<MaterialKind, number> = { 木材: 5, 鉄骨: 5, コンクリート: 5, ガラス: 5, 銅線: 5, 合金: 7, 超伝導体: 10, ゴミ: 1 };
export const TURN_LIMIT_MS = 60_000;
export const AUCTION_LIMIT_MS = 15_000;

const project = (
  id: string,
  name: string,
  points: number,
  requirements: ProjectCard["requirements"],
  type: EffectType,
  amount: number,
  label: string,
  immediate = false,
  gainedMaterial?: MaterialKind,
): ProjectCard => ({ id, kind: "project", name, points, requirements, effect: { type, amount, label, material: gainedMaterial }, immediate });

const material = (id: string, kind: MaterialKind): MaterialCard => ({ id, kind: "material", material: kind, name: kind, value: 0, ...(kind === "超伝導体" ? { rarity: "premium" as const } : {}) });
export const NEW_PROJECT_DEFINITIONS = [
  { card: project("", "ミステリーハウス", 5, { 超伝導体: 2, 銅線: 3, コンクリート: 2, 鉄骨: 2 }, "mysteryHouse", 1, "+3コイン / 毎ターン ランダム素材 +1"), copies: 1 },
  { card: project("", "小屋", 6, { 木材: 3 }, "coins", 1, "コイン +1"), copies: 3 },
  { card: project("", "光ファイバー", 1, { 銅線: 3 }, "gainMaterial", 1, "超伝導体を1枚獲得", false, "超伝導体"), copies: 2 },
  { card: project("", "ミュージアム", 2, { コンクリート: 1, 鉄骨: 1, ガラス: 1 }, "randomProject", 1, "ランダムな企画カードを1枚獲得"), copies: 2 },
  { card: project("", "ゴミ山", 1, { ゴミ: 3 }, "coins", 1, "コイン +1"), copies: 3 },
] as const;
const nextId = (state: RoomGameState, prefix: string) => `${prefix}-${++state.serial}`;

const log = (state: RoomGameState, text: string, tone: LogTone = "neutral") => {
  state.logs.unshift({ id: nextId(state, "log"), text, tone, createdAt: Date.now() });
  state.logs = state.logs.slice(0, 16);
};

const scoreBreakdown = (player: GamePlayer) => {
  const submittedPoints = player.submitted.reduce((sum, item) => sum + item.project.points, 0);
  const bonusPoints = player.scoreBonus ?? 0;
  return { submittedPoints, bonusPoints, points: submittedPoints + bonusPoints };
};
const totalPoints = (player: GamePlayer) => scoreBreakdown(player).points;

const draw = (state: RoomGameState, player: GamePlayer, count: number) => {
  let drawn = 0;
  while (drawn < count && state.deck.length > 0) {
    const card = state.deck.shift();
    if (card) player.hand.push(card);
    drawn += 1;
  }
  return drawn;
};

const createDeck = (state: RoomGameState, playerCount: number) => {
  const library: GameCard[] = [];
  materialKinds.forEach((kind) => {
    for (let index = 0; index < 18; index += 1) library.push(material(nextId(state, "mat"), kind));
  });
  for (let index = 0; index < 5; index += 1) library.push(material(nextId(state, "rare"), "超伝導体"));
  const plans: { card: ProjectCard; copies: number }[] = [
    { card: project("", "整地", 1, {}, "coins", 2, "コイン +2", true), copies: 3 },
    { card: project("", "資材調達", 0, {}, "draw", 2, "カードを2枚引く", true), copies: 3 },
    { card: project("", "コストカット", 1, {}, "pointBoost", 2, "最終ポイント +2", true), copies: 2 },
    { card: project("", "文句", 1, {}, "stealCoins", 2, "指定会社から2コイン徴収", true), copies: 2 },
    { card: project("", "産業スパイ", 1, {}, "stealCard", 1, "ランダムに手札1枚を奪う", true), copies: 2 },
    { card: project("", "内部工作", 1, {}, "discard", 1, "指定会社の手札を1枚破棄", true), copies: 2 },
    { card: project("", "木材調達", 0, {}, "gainMaterial", 2, "木材を2枚獲得", true, "木材"), copies: 2 },
    { card: project("", "鉄骨調達", 0, {}, "gainMaterial", 2, "鉄骨を2枚獲得", true, "鉄骨"), copies: 2 },
    { card: project("", "コンクリ調達", 0, {}, "gainMaterial", 2, "コンクリートを2枚獲得", true, "コンクリート"), copies: 2 },
    { card: project("", "ガラス調達", 0, {}, "gainMaterial", 2, "ガラスを2枚獲得", true, "ガラス"), copies: 2 },
    { card: project("", "銅線調達", 0, {}, "gainMaterial", 2, "銅線を2枚獲得", true, "銅線"), copies: 2 },
    { card: project("", "ホール", 5, { 木材: 2, 鉄骨: 1 }, "coins", 4, "コイン +4"), copies: 3 },
    { card: project("", "住宅街", 4, { 木材: 2, コンクリート: 1 }, "draw", 2, "カードを2枚引く"), copies: 3 },
    { card: project("", "再開発", 7, { 鉄骨: 2, コンクリート: 1 }, "coins", 5, "コイン +5"), copies: 2 },
    { card: project("", "巨大温室", 6, { 木材: 1, ガラス: 2, 銅線: 1 }, "coins", 4, "コイン +4"), copies: 2 },
    { card: project("", "つり橋", 8, { 鉄骨: 2, コンクリート: 2 }, "draw", 3, "カードを3枚引く"), copies: 2 },
    { card: project("", "オフィス", 7, { コンクリート: 2, 銅線: 2 }, "coins", 5, "コイン +5"), copies: 2 },
    { card: project("", "ガラスドーム", 6, { 鉄骨: 1, ガラス: 2, 木材: 1 }, "coins", 4, "コイン +4"), copies: 2 },
    { card: project("", "言いがかり", 5, { 鉄骨: 2, 銅線: 1 }, "forceBulk", 1, "強制BALKUを1回獲得"), copies: 3 },
    { card: project("", "品質保証", 5, { 木材: 1, ガラス: 2 }, "pointBoost", 3, "最終ポイント +3"), copies: 2 },
    { card: project("", "文句を言うもんく", 4, { 銅線: 2, コンクリート: 1 }, "stealCoins", 3, "指定会社から3コイン徴収"), copies: 2 },
    { card: project("", "施工停止命令", 3, { 木材: 1, 鉄骨: 1, ガラス: 1 }, "discard", 2, "指定会社の手札を2枚破棄"), copies: 2 },
    { card: project("", "通信制御棟", 7, { 合金: 2, 銅線: 1, ガラス: 1 }, "coins", 4, "コイン +4"), copies: 2 },
    { card: project("", "高耐久ドーム", 8, { 合金: 2, コンクリート: 2, ガラス: 1 }, "draw", 3, "カードを3枚引く"), copies: 2 },
    { card: project("", "都市物流港", 9, { 合金: 2, 鉄骨: 1, コンクリート: 1 }, "pointBoost", 2, "最終ポイント +2"), copies: 2 },
    { card: project("", "深層研究区", 8, { 合金: 1, 銅線: 2, 鉄骨: 1 }, "coins", 5, "コイン +5"), copies: 2 },
    { card: project("", "量子通信塔", 11, { 超伝導体: 2, 合金: 1, ガラス: 1 }, "coins", 7, "コイン +7"), copies: 1 },
    { card: project("", "浮体都市中枢", 12, { 超伝導体: 1, 合金: 2, 鉄骨: 2 }, "pointBoost", 4, "最終ポイント +4"), copies: 1 },
    { card: project("", "電力供給網", 6, { 銅線: 2, 合金: 1, コンクリート: 1 }, "income", 1, "毎ターン開始時 コイン +1"), copies: 3 },
    ...NEW_PROJECT_DEFINITIONS,
  ];
  plans.forEach(({ card, copies }) => {
    for (let index = 0; index < copies; index += 1) library.push({ ...card, id: nextId(state, "prj") });
  });
  for (let index = library.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [library[index], library[swap]] = [library[swap], library[index]];
  }
  const fixedCount = playerCount * 36;
  if (library.length < fixedCount) throw new Error("固定山札の作成に必要なカードが不足しています。");
  return library.slice(0, fixedCount);
};

const blankPlayer = (seat: number, name: string): GamePlayer => ({ seat, name, coins: 3, hand: [], submitted: [], eliminated: false, actionUsed: false, scoreBonus: 0, forceBulkCharges: [] });

export function createLobbyState(hostName: string): RoomGameState {
  return { phase: "lobby", turn: 1, activeSeat: 0, turnDeadlineAt: null, deck: [], deckInitialCount: 0, turnsPerPlayer: 10, players: [blankPlayer(0, hostName)], logs: [], auction: null, winnerSeat: null, winnerSeats: [], finalScores: [], serial: 0 };
}

export function addLobbyPlayer(state: RoomGameState, displayName: string) {
  if (state.phase !== "lobby") throw new Error("対戦開始後の入室はできません。");
  if (state.players.length >= 4) throw new Error("このルームは満席です。");
  const next = structuredClone(state);
  next.players.push(blankPlayer(next.players.length, displayName));
  log(next, `${displayName} が現場に合流。現在 ${next.players.length} 人。`, "good");
  return next;
}

export function startGame(state: RoomGameState) {
  if (state.phase !== "lobby") throw new Error("このルームはすでに開始されています。");
  if (state.players.length < 2) throw new Error("開始には2人以上の参加者が必要です。");
  const next = structuredClone(state);
  next.phase = "active";
  next.turn = 1;
  next.activeSeat = 0;
  next.turnDeadlineAt = Date.now() + TURN_LIMIT_MS;
  next.winnerSeat = null;
  next.winnerSeats = [];
  next.finalScores = [];
  next.auction = null;
  next.deck = createDeck(next, next.players.length);
  next.deckInitialCount = next.deck.length;
  next.players = next.players.map((player) => blankPlayer(player.seat, player.name));
  next.players.forEach((player) => draw(next, player, 8));
  log(next, `固定山札 ${next.deckInitialCount} 枚で開始。山札が尽きると最終精算です。`, "good");
  log(next, `全施工者へ初期手札8枚を配布。第1ターンは${next.players[0].name}の施工ターンです。`, "good");
  return next;
}

export function resetToLobby(state: RoomGameState) {
  const names = state.players.map((player) => player.name);
  let next = createLobbyState(names[0] ?? "施工者");
  names.slice(1).forEach((name) => { next = addLobbyPlayer(next, name); });
  log(next, "同じ現場で再戦を準備中。作成者が開始すると新しい施工競争が始まる。", "neutral");
  return next;
}

export function isLegalSubmission(plan: ProjectCard, materials: MaterialCard[]) {
  return Object.entries(plan.requirements).every(([kind, amount]) => materials.filter((card) => card.material === kind).length >= amount);
}

const findPlayer = (state: RoomGameState, seat: number) => {
  const player = state.players.find((item) => item.seat === seat);
  if (!player || player.eliminated) throw new Error("操作できるプレイヤーが見つかりません。");
  return player;
};
const assertActiveTurn = (state: RoomGameState, seat: number) => {
  if (state.phase !== "active") throw new Error("この対戦は開始されていません。");
  if (state.activeSeat !== seat) throw new Error("いまはあなたの施工ターンではありません。");
};
const resolveEffectTarget = (state: RoomGameState, owner: GamePlayer, targetSeat?: number) => {
  if (targetSeat === undefined) throw new Error("この企画は対象となる他社を選択してください。");
  const target = findPlayer(state, targetSeat);
  if (target.seat === owner.seat) throw new Error("自分自身を効果対象にはできません。");
  return target;
};

const activate = (state: RoomGameState, owner: GamePlayer, submission: Submission, source: string) => {
  if (submission.effectActivated) return;
  submission.effectActivated = true;
  const { type, amount, label } = submission.project.effect;
  if (type === "coins") owner.coins += amount;
  if (type === "mysteryHouse") owner.coins += 3;
  if (type === "draw") draw(state, owner, amount);
  if (type === "gainMaterial" && submission.project.effect.material) for (let index = 0; index < amount; index += 1) owner.hand.push(material(nextId(state, "supply"), submission.project.effect.material));
  if (type === "randomMaterial") {
    const kind = materialKinds[Math.floor(Math.random() * materialKinds.length)];
    owner.hand.push(material(nextId(state, "random-supply"), kind));
  }
  if (type === "randomProject") {
    const projectIndexes = state.deck.map((card, index) => card.kind === "project" ? index : -1).filter((index) => index >= 0);
    const projectIndex = projectIndexes[Math.floor(Math.random() * projectIndexes.length)];
    if (projectIndex !== undefined) {
      const [projectCard] = state.deck.splice(projectIndex, 1);
      if (projectCard) owner.hand.push(projectCard);
    }
  }
  if (type === "pointBoost") owner.scoreBonus = (owner.scoreBonus ?? 0) + amount;
  if (type === "forceBulk") owner.forceBulkCharges.push({ id: submission.id, sourceProject: submission.project.name, used: false });
  if (type === "stealCoins") {
    const target = resolveEffectTarget(state, owner, submission.effectTargetSeat);
    const stolen = Math.min(target.coins, amount);
    target.coins -= stolen;
    owner.coins += stolen;
  }
  if (type === "stealCard") {
    const candidates = state.players.filter((player) => player.seat !== owner.seat && !player.eliminated && player.hand.length > 0);
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    if (target) {
      const [stolen] = target.hand.splice(Math.floor(Math.random() * target.hand.length), 1);
      if (stolen) owner.hand.push(stolen);
      log(state, `${source}: ${owner.name}はランダム対象の${target.name}から手札1枚を奪取。`, "warning");
    } else log(state, `${source}: 奪取可能な他社の手札がなく、効果は不発。`, "neutral");
  }
  if (type === "discard") {
    const target = resolveEffectTarget(state, owner, submission.effectTargetSeat);
    const discarded = target.hand.splice(0, amount);
    log(state, `${source}: ${target.name}の手札 ${discarded.length} 枚を破棄。`, "danger");
  }
  log(state, `${source}: ${owner.name}の「${submission.project.name}」が発動 — ${label}。`, type === "stealCoins" || type === "stealCard" || type === "discard" || type === "forceBulk" ? "warning" : "good");
};

const resolveAutoAuction = (state: RoomGameState) => {
  const auction = state.auction;
  if (!auction) return;
  if (auction.highestBidderSeat !== null) {
    const winner = findPlayer(state, auction.highestBidderSeat);
    winner.coins -= auction.highestBid;
    winner.hand.push(auction.card);
    log(state, `自動オークション成立。「${auction.card.name}」を${winner.name}が${auction.highestBid}コインで落札。`, "good");
  } else {
    log(state, `自動オークション不成立。「${auction.card.name}」は市場から取り下げ。`, "neutral");
  }
  state.auction = null;
};

const openAutoAuction = (state: RoomGameState) => {
  const card = state.deck.shift();
  if (!card) return;
  state.auction = { card, highestBid: 0, highestBidderSeat: null, deadlineAt: Date.now() + AUCTION_LIMIT_MS, roundOpened: state.turn };
  log(state, `自動オークション開始。市場に「${card.name}」が出品されました。残り15秒。入札が入るたびに期限が延長されます。`, "warning");
};

const finishByScore = (state: RoomGameState) => {
  if (state.phase === "finished") return;
  if (state.auction) resolveAutoAuction(state);
  state.players.forEach((player) => player.submitted.forEach((submission) => { submission.faceUp = true; }));
  state.finalScores = state.players.filter((player) => !player.eliminated).map((player) => ({ seat: player.seat, name: player.name, ...scoreBreakdown(player) })).sort((left, right) => right.points - left.points || right.submittedPoints - left.submittedPoints);
  const topScore = state.finalScores[0]?.points ?? 0;
  state.winnerSeats = state.finalScores.filter((score) => score.points === topScore).map((score) => score.seat);
  state.winnerSeat = state.winnerSeats.length === 1 ? state.winnerSeats[0] : null;
  state.phase = "finished";
  state.turnDeadlineAt = null;
  if (state.winnerSeats.length === 1) log(state, `山札消尽。最終精算の結果、${state.finalScores[0]?.name ?? "勝者"} が ${topScore} PT で勝利。`, "good");
  else log(state, `山札消尽。最終精算は ${topScore} PT で共同勝利。`, "warning");
};

const activateTurnIncome = (state: RoomGameState, player: GamePlayer) => {
  const income = player.submitted.filter((submission) => submission.legal && submission.effectActivated && submission.project.effect.type === "income").reduce((sum, submission) => sum + submission.project.effect.amount, 0);
  if (income > 0) {
    player.coins += income;
    log(state, `${player.name}は継続収入により ${income} コインを獲得。`, "good");
  }
  const materialIncome = player.submitted.filter((submission) => submission.legal && submission.effectActivated && (submission.project.effect.type === "randomMaterialIncome" || submission.project.effect.type === "mysteryHouse")).reduce((sum, submission) => sum + submission.project.effect.amount, 0);
  for (let index = 0; index < materialIncome; index += 1) {
    const kind = materialKinds[Math.floor(Math.random() * materialKinds.length)];
    player.hand.push(material(nextId(state, "mystery-supply"), kind));
  }
  if (materialIncome > 0) log(state, `${player.name}はミステリーハウスからランダム素材 ${materialIncome}枚を獲得。`, "good");
};

const advanceTurn = (state: RoomGameState) => {
  let cursor = state.activeSeat;
  for (let step = 0; step < state.players.length; step += 1) {
    cursor = (cursor + 1) % state.players.length;
    const nextPlayer = state.players.find((player) => player.seat === cursor);
    if (!nextPlayer || nextPlayer.eliminated) continue;
    const newRound = cursor === 0;
      if (newRound) {
      if (state.deck.length > 0 && !state.auction) openAutoAuction(state);
      if (state.deck.length === 0 && !state.auction) {
        finishByScore(state);
        return;
      }
    }
    state.activeSeat = cursor;
    state.turn += 1;
    state.turnDeadlineAt = Date.now() + TURN_LIMIT_MS;
    nextPlayer.actionUsed = false;
    activateTurnIncome(state, nextPlayer);
    const drawn = draw(state, nextPlayer, 2);
    log(state, `第${state.turn}ターン。${nextPlayer.name}が${drawn}枚をドローし、施工ターンに入った。`, "good");
    if (state.deck.length === 0 && !state.auction) finishByScore(state);
    return;
  }
  finishByScore(state);
};

const finishActionAndAdvance = (state: RoomGameState) => {
  if (state.deck.length === 0 && !state.auction) finishByScore(state);
  else advanceTurn(state);
};

export function expireTimedOutTurn(state: RoomGameState, now = Date.now()) {
  if (state.phase !== "active") return state;
  let next = state;
  if (state.auction?.deadlineAt !== undefined && state.auction.deadlineAt <= now) {
    next = structuredClone(state);
    resolveAutoAuction(next);
  }
  if (next.phase !== "active") return next;
  if (!next.turnDeadlineAt) {
    const initialized = next === state ? structuredClone(next) : next;
    initialized.turnDeadlineAt = now + TURN_LIMIT_MS;
    return initialized;
  }
  if (next.turnDeadlineAt > now) return next;
  if (next === state) next = structuredClone(state);
  const timedOutPlayer = findPlayer(next, next.activeSeat);
  log(next, `${timedOutPlayer.name}の施工時間が終了。行動なしで自動パス。`, "warning");
  advanceTurn(next);
  return next;
}

const resolveBulk = (state: RoomGameState, caller: GamePlayer, owner: GamePlayer, target: Submission) => {
  if (!target.legal) {
    owner.submitted = owner.submitted.filter((item) => item.id !== target.id);
    caller.hand.push(target.project, ...target.materials);
    log(state, `BALKU成功。${caller.name}が違法建築「${target.project.name}」と添付素材を接収。`, "good");
    return;
  }
  target.faceUp = true;
  activate(state, owner, target, "BALKU開示");
  const losses = caller.hand.filter((card): card is ProjectCard => card.kind === "project").sort((left, right) => right.points - left.points);
  const lost: ProjectCard[] = [];
  let value = 0;
  for (const card of losses) {
    if (value >= target.project.points) break;
    value += card.points;
    lost.push(card);
  }
  if (value < target.project.points) {
    caller.hand = [];
    caller.submitted = [];
    caller.eliminated = true;
    log(state, `BALKU失敗。${caller.name}は${target.project.points}点以上をロストできず、全ロストで脱落。`, "danger");
    return;
  }
  const lostIds = new Set(lost.map((card) => card.id));
  caller.hand = caller.hand.filter((card) => !lostIds.has(card.id));
  log(state, `BALKU失敗。${caller.name}は合計${value}ポイントの企画をロスト。`, "danger");
};

const resolveForceBulk = (state: RoomGameState, caller: GamePlayer, owner: GamePlayer, target: Submission, charge: ForceBulkCharge) => {
  charge.used = true;
  owner.submitted = owner.submitted.filter((item) => item.id !== target.id);
  caller.hand.push(target.project, ...target.materials);
  log(state, `強制BALKU発動。${caller.name}は「${charge.sourceProject}」を使い、${owner.name}の「${target.project.name}」を強制違法建築として接収。`, "danger");
};

export function applyGameAction(state: RoomGameState, seat: number, action: GameAction) {
  const next = structuredClone(state);
  const actor = findPlayer(next, seat);
  actor.forceBulkCharges ??= [];
  actor.scoreBonus ??= 0;

  if (action.type === "bid") {
    if (!next.auction) throw new Error("進行中の自動オークションはありません。");
    if (action.amount <= next.auction.highestBid || action.amount > actor.coins) throw new Error("入札額は現在額より高く、保有コイン以下にしてください。");
    next.auction.highestBid = action.amount;
    next.auction.highestBidderSeat = seat;
    next.auction.deadlineAt = Date.now() + AUCTION_LIMIT_MS;
    log(next, `${actor.name}が市場の「${next.auction.card.name}」に${action.amount}コインで入札。期限を15秒へ延長。`, "warning");
    return next;
  }
  if (action.type === "bulkCall") {
    if (next.phase !== "active") throw new Error("BALKUできるのは対戦中のみです。");
    const owner = findPlayer(next, action.targetSeat);
    if (owner.seat === actor.seat) throw new Error("自分の企画にはBALKUできません。");
    const target = owner.submitted.find((item) => item.id === action.submissionId);
    if (!target) throw new Error("対象となる企画が見つかりません。");
    resolveBulk(next, actor, owner, target);
    return next;
  }
  if (action.type === "forceBulk") {
    if (next.phase !== "active") throw new Error("強制BALKUできるのは対戦中のみです。");
    const charge = actor.forceBulkCharges.find((item) => item.id === action.chargeId && !item.used);
    if (!charge) throw new Error("使用可能な強制BALKU権がありません。");
    const owner = findPlayer(next, action.targetSeat);
    if (owner.seat === actor.seat) throw new Error("自分の企画には強制BALKUできません。");
    const target = owner.submitted.find((item) => item.id === action.submissionId);
    if (!target) throw new Error("対象となる企画が見つかりません。");
    resolveForceBulk(next, actor, owner, target, charge);
    return next;
  }

  assertActiveTurn(next, seat);
  if (action.type === "endTurn") {
    if (actor.actionUsed) throw new Error("行動後は自動で次の施工者へ移ります。");
    log(next, `${actor.name}は行動権を残してターンを終了。`, "neutral");
    advanceTurn(next);
    return next;
  }

  if (action.type === "buyMaterial") {
    const price = marketPrices[action.material];
    if (actor.coins < price) throw new Error(`${action.material}の直接調達には${price}コイン必要です。`);
    actor.coins -= price;
    actor.hand.push(material(nextId(next, "market"), action.material));
    log(next, `${actor.name}は調達市場から「${action.material}」を${price}コインで直接獲得。`, "good");
    return next;
  }
  if (action.type === "sellCards") {
    const ids = new Set(action.cardIds);
    if (ids.size === 0) throw new Error("売却するカードを1枚以上選択してください。");
    const cards = actor.hand.filter((card) => ids.has(card.id));
    if (cards.length !== ids.size) throw new Error("売却できるのは手札にあるカードのみです。");
    actor.hand = actor.hand.filter((card) => !ids.has(card.id));
    actor.coins += cards.length;
    log(next, `${actor.name}はカード ${cards.length} 枚を売却し、${cards.length}コインを獲得。`, "good");
    return next;
  }

  if (actor.actionUsed) throw new Error("今ターンの行動権は使用済みです。");

  if (action.type === "submit") {
    const plan = actor.hand.find((card): card is ProjectCard => card.id === action.projectId && card.kind === "project");
    if (!plan) throw new Error("提出する企画カードを選択してください。");
    if (targetedEffects.includes(plan.effect.type) && action.targetSeat === undefined) throw new Error("この企画は対象となる他社を選択してください。");
    if (action.targetSeat === actor.seat) throw new Error("自分自身を効果対象にはできません。");
    const ids = new Set(action.materialIds);
    const materials = actor.hand.filter((card): card is MaterialCard => card.kind === "material" && ids.has(card.id));
    actor.hand = actor.hand.filter((card) => card.id !== plan.id && !ids.has(card.id));
    const submission: Submission = { id: nextId(next, "sub"), project: plan, materials, faceUp: action.faceUp, legal: isLegalSubmission(plan, materials), effectActivated: false, effectTargetSeat: action.targetSeat };
    actor.submitted.push(submission);
    actor.actionUsed = true;
    log(next, `${actor.name}が${action.faceUp ? `公開で「${plan.name}」` : "伏せ企画"}を完成。添付素材 ${materials.length}枚。`, action.faceUp ? "good" : "warning");
    if (action.faceUp && submission.legal) activate(next, actor, submission, "公開提出");
    if (action.faceUp && !submission.legal) log(next, `「${plan.name}」は素材不足。BALKUの対象になります。`, "danger");
    finishActionAndAdvance(next);
    return next;
  }
  return next;
}
export function removePlayerFromState(state: RoomGameState, playerSeat: number): RoomGameState {
  const next = structuredClone(state);
  const player = next.players[playerSeat];
  
  if (!player) {
    throw new Error("プレイヤーが見つかりません。");
  }
  
  // ロビーフェーズの場合は配列から完全に削除
  if (next.phase === "lobby") {
    next.players = next.players.filter((p) => p.seat !== playerSeat);
    log(next, `${player.name}が退出しました。`, "warning");
    return next;
  }
  
  // ゲーム中の場合は eliminated = true に設定（状態の整合性を保つ）
  player.eliminated = true;
  player.hand = [];
  player.submitted = [];
  
  log(next, `${player.name}が退出し、脱落しました。`, "danger");
  
  // 全員が脱落した場合は終了判定
  const activePlayers = next.players.filter((p) => !p.eliminated);
  if (activePlayers.length <= 1 && next.phase === "active") {
    finishByScore(next);
  }
  
  return next;
}
export const getTotalPoints = totalPoints;
export const getMarketPrice = (kind: MaterialKind) => marketPrices[kind];