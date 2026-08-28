// BALKU / 現場図面アーケード: 全画面の製図台UIとゲームルールをGameWorldが一元管理する。

import { Scene } from "@babylonjs/core/scene";
import {
  AdvancedDynamicTexture,
  Button,
  Control,
  Grid,
  Image,
  Rectangle,
  StackPanel,
  TextBlock,
} from "@babylonjs/gui";
import type {
  EffectType,
  GameCard,
  GameLog,
  MaterialCard,
  MaterialKind,
  Player,
  ProjectCard,
  Submission,
} from "./types";

const ASSET = {
  background: "/manus-storage/balku-drafting-table-background_3ee1825b.jpg",
  logo: "/manus-storage/balku-logo-mark_b603e974.png",
  project: "/manus-storage/balku-project-card-art_a715bfaf.jpg",
  material: "/manus-storage/balku-material-reference_e2fdc3d7.jpg",
};

const COLORS = {
  ink: "#DCE5E8",
  muted: "#8FA8B1",
  paper: "#F2E9D5",
  paperInk: "#1B2B32",
  cyan: "#39BFE8",
  cyanDeep: "#124C61",
  yellow: "#F2C94C",
  orange: "#CF6442",
  red: "#E05252",
  panel: "#10262EDB",
  dark: "#07141B",
  green: "#64D8A5",
};

const MATERIAL_COLOR: Record<MaterialKind, string> = {
  木材: "#B87A4B",
  鉄骨: "#8BA2B2",
  コンクリート: "#A8AAA8",
  ガラス: "#75CBE5",
  銅線: "#CF7A42",
};

const SEATS = [
  { name: "あなた", color: "#39BFE8" },
  { name: "赤坂建設", color: "#F17462" },
  { name: "青嶺組", color: "#F2C94C" },
  { name: "北辰開発", color: "#A682E5" },
];

const planned = (
  id: string,
  name: string,
  points: number,
  requirements: ProjectCard["requirements"],
  type: EffectType,
  amount: number,
  label: string,
  immediate = false,
): ProjectCard => ({
  id,
  kind: "project",
  name,
  points,
  requirements,
  effect: { type, amount, label },
  immediate,
});

const makeMaterial = (id: string, material: MaterialKind): MaterialCard => ({
  id,
  kind: "material",
  material,
  name: material,
  value: 0,
});

export class GameWorld {
  private readonly ui: AdvancedDynamicTexture;
  private readonly scene: Scene;
  private players: Player[] = [];
  private deck: GameCard[] = [];
  private logs: GameLog[] = [];
  private tableSize = 3;
  private turn = 1;
  private currentIndex = 0;
  private selectedProjectId: string | null = null;
  private selectedMaterials = new Set<string>();
  private serial = 0;
  private winner: Player | null = null;
  private demoTimer: number | null = null;

  constructor(scene: Scene, _canvas: HTMLCanvasElement, demo = false) {
    this.scene = scene;
    this.ui = AdvancedDynamicTexture.CreateFullscreenUI("balku-ui", true, scene);
    this.resetGame();
    if (demo) this.startDemo();
  }

  dispose() {
    if (this.demoTimer !== null) window.clearInterval(this.demoTimer);
    this.ui.dispose();
  }

  private uid(prefix: string) {
    this.serial += 1;
    return `${prefix}-${this.serial}`;
  }

  private resetGame() {
    this.serial = 0;
    this.turn = 1;
    this.currentIndex = 0;
    this.winner = null;
    this.selectedProjectId = null;
    this.selectedMaterials.clear();
    this.deck = this.createDeck();
    this.players = SEATS.slice(0, this.tableSize).map((seat, index) => ({
      id: `p${index}`,
      name: seat.name,
      color: seat.color,
      coins: 3,
      hand: [],
      submitted: [],
      eliminated: false,
      actionUsed: false,
    }));
    this.logs = [];
    this.players.forEach((player) => this.drawCards(player, 5));
    this.drawCards(this.human, 3);
    this.log("第1ラウンド開始。あなたは3枚を引き、行動権を1回持ちます。", "good");
    this.render();
  }

  private get human() {
    return this.players[0];
  }

  private get activePlayer() {
    return this.players[this.currentIndex];
  }

  private createDeck(): GameCard[] {
    const cards: GameCard[] = [];
    const materialKinds: MaterialKind[] = ["木材", "鉄骨", "コンクリート", "ガラス", "銅線"];
    materialKinds.forEach((material) => {
      for (let i = 0; i < 8; i += 1) cards.push(makeMaterial(this.uid("mat"), material));
    });
    const projects = [
      planned(this.uid("prj"), "仮設許可", 1, {}, "coins", 2, "コイン +2", true),
      planned(this.uid("prj"), "再調達指示", 0, {}, "draw", 2, "カードを2枚引く", true),
      planned(this.uid("prj"), "公開入札", 1, {}, "auction", 1, "次の売却 +1コイン", true),
      planned(this.uid("prj"), "市民ホール", 5, { 木材: 2, 鉄骨: 1 }, "coins", 4, "コイン +4"),
      planned(this.uid("prj"), "集合住宅群", 4, { 木材: 2, コンクリート: 1 }, "draw", 2, "カードを2枚引く"),
      planned(this.uid("prj"), "再開発タワー", 7, { 鉄骨: 2, コンクリート: 1 }, "coins", 5, "コイン +5"),
      planned(this.uid("prj"), "浮遊温室", 6, { 木材: 1, ガラス: 2, 銅線: 1 }, "coins", 4, "コイン +4"),
      planned(this.uid("prj"), "高速架橋", 8, { 鉄骨: 2, コンクリート: 2 }, "draw", 3, "カードを3枚引く"),
      planned(this.uid("prj"), "地下市場", 7, { コンクリート: 2, 銅線: 2 }, "coins", 5, "コイン +5"),
      planned(this.uid("prj"), "ガラス劇場", 6, { 鉄骨: 1, ガラス: 2, 木材: 1 }, "coins", 4, "コイン +4"),
    ];
    projects.forEach((project) => {
      const copies = project.immediate ? 3 : 2;
      for (let i = 0; i < copies; i += 1) {
        cards.push({ ...project, id: this.uid("prj") });
      }
    });
    for (let i = cards.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    return cards;
  }

  private drawCards(player: Player, amount: number) {
    for (let i = 0; i < amount; i += 1) {
      if (this.deck.length === 0) this.deck = this.createDeck();
      const card = this.deck.shift();
      if (card) player.hand.push(card);
    }
  }

  private log(text: string, tone: GameLog["tone"] = "neutral") {
    this.logs = [{ text, tone }, ...this.logs].slice(0, 6);
  }

  private requirementsText(project: ProjectCard) {
    const items = Object.entries(project.requirements) as [MaterialKind, number][];
    return items.length === 0 ? "素材不要・即時" : items.map(([key, value]) => `${key}×${value}`).join(" ");
  }

  private isLegal(project: ProjectCard, materials: MaterialCard[]) {
    return Object.entries(project.requirements).every(([material, amount]) => {
      return materials.filter((card) => card.material === material).length >= amount;
    });
  }

  private totalPoints(player: Player) {
    return player.submitted.reduce((sum, submission) => sum + submission.project.points, 0);
  }

  private handleHandCard(card: GameCard) {
    if (this.human.eliminated || this.winner) return;
    if (card.kind === "project") {
      this.selectedProjectId = this.selectedProjectId === card.id ? null : card.id;
    } else if (this.selectedMaterials.has(card.id)) {
      this.selectedMaterials.delete(card.id);
    } else {
      this.selectedMaterials.add(card.id);
    }
    this.render();
  }

  private submitProject(faceUp: boolean) {
    const player = this.human;
    if (player.actionUsed) return this.logAndRender("今ターンの行動権は使用済みです。", "warning");
    const project = player.hand.find((card): card is ProjectCard => card.id === this.selectedProjectId && card.kind === "project");
    if (!project) return this.logAndRender("まず企画カードを1枚選択してください。", "warning");

    const materialIds = this.selectedMaterials;
    const materials = player.hand.filter((card): card is MaterialCard => card.kind === "material" && materialIds.has(card.id));
    player.hand = player.hand.filter((card) => card.id !== project.id && !materialIds.has(card.id));
    const submission: Submission = {
      id: this.uid("sub"),
      project,
      materials,
      faceUp,
      legal: this.isLegal(project, materials),
      effectActivated: false,
    };
    player.submitted.push(submission);
    player.actionUsed = true;
    this.selectedProjectId = null;
    this.selectedMaterials.clear();
    this.log(`${faceUp ? "公開" : "伏せ"}で「${project.name}」を企画完成。添付素材 ${materials.length}枚。`, faceUp ? "good" : "warning");
    if (faceUp) this.activateEffect(player, submission, "表向き提出");
    this.tryAiBulkCall(player, submission);
    this.render();
  }

  private activateEffect(owner: Player, submission: Submission, source: string) {
    if (submission.effectActivated) return;
    const { effect } = submission.project;
    submission.effectActivated = true;
    if (effect.type === "coins") owner.coins += effect.amount;
    if (effect.type === "draw") this.drawCards(owner, effect.amount);
    if (effect.type === "auction") owner.coins += effect.amount;
    this.log(`${source}: ${owner.name}の「${submission.project.name}」発動 — ${effect.label}。`, "good");
  }

  private sellAuction() {
    const seller = this.human;
    if (seller.actionUsed) return this.logAndRender("今ターンの行動権は使用済みです。", "warning");
    const card = seller.hand.find((item) => item.id === this.selectedProjectId) ?? seller.hand.find((item) => this.selectedMaterials.has(item.id));
    if (!card) return this.logAndRender("売却したいカードを1枚選択してください。", "warning");
    const bidders = this.players.slice(1).filter((player) => !player.eliminated && player.coins > 0);
    const bid = bidders.length === 0 ? 0 : Math.min(4, Math.max(1, Math.floor(Math.random() * 3) + 1));
    const buyer = bidders.sort((a, b) => b.coins - a.coins)[0];
    seller.hand = seller.hand.filter((item) => item.id !== card.id);
    seller.actionUsed = true;
    this.selectedProjectId = null;
    this.selectedMaterials.clear();
    if (buyer && bid > 0) {
      buyer.coins -= bid;
      buyer.hand.push(card);
      seller.coins += bid;
      this.log(`売却オークション成立。「${card.name}」を${buyer.name}が${bid}コインで落札。`, "good");
    } else {
      this.log(`売却オークション不成立。「${card.name}」は市場から消えた。`, "warning");
    }
    this.render();
  }

  private bulkCall() {
    if (this.human.eliminated || this.winner) return;
    const targetOwner = this.players.slice(1).find((player) => !player.eliminated && player.submitted.length > 0);
    const target = targetOwner?.submitted[targetOwner.submitted.length - 1];
    if (!targetOwner || !target) return this.logAndRender("コール可能な他社の企画がありません。", "warning");
    this.resolveBulk(this.human, targetOwner, target);
    this.render();
  }

  private resolveBulk(caller: Player, owner: Player, target: Submission) {
    if (!target.legal) {
      owner.submitted = owner.submitted.filter((submission) => submission.id !== target.id);
      caller.hand.push(target.project, ...target.materials);
      this.log(`BALKU成功。${caller.name}が違法建築「${target.project.name}」と添付素材を接収。`, "good");
      return;
    }
    target.faceUp = true;
    this.activateEffect(owner, target, "BALKU開示");
    const projectCards = caller.hand.filter((card): card is ProjectCard => card.kind === "project").sort((a, b) => b.points - a.points);
    let loss = 0;
    const lostIds: string[] = [];
    for (const card of projectCards) {
      if (loss >= target.project.points) break;
      loss += card.points;
      lostIds.push(card.id);
    }
    if (loss < target.project.points) {
      caller.hand = [];
      caller.submitted = [];
      caller.eliminated = true;
      this.log(`BALKU失敗。${caller.name}は${target.project.points}点以上をロストできず、全ロストで脱落。`, "danger");
    } else {
      caller.hand = caller.hand.filter((card) => !lostIds.includes(card.id));
      this.log(`BALKU失敗。${caller.name}は合計${loss}ポイントの企画をロスト。`, "danger");
    }
  }

  private tryAiBulkCall(owner: Player, target: Submission) {
    const caller = this.players.slice(1).find((player) => !player.eliminated && Math.random() < (target.legal ? 0.17 : 0.58));
    if (caller) this.resolveBulk(caller, owner, target);
  }

  private challenge() {
    const challenger = this.human;
    if (challenger.submitted.length < 3) return this.logAndRender("チャレンジには提出済み企画が3枚必要です。", "warning");
    const score = this.totalPoints(challenger);
    const opponents = this.players.slice(1).filter((player) => !player.eliminated);
    const stronger = opponents.find((player) => this.totalPoints(player) > score);
    if (stronger) {
      challenger.hand = [];
      challenger.submitted = [];
      challenger.eliminated = true;
      this.log(`CHALLENGE失敗。${stronger.name}が${this.totalPoints(stronger)}点を保持。あなたは全ロストで脱落。`, "danger");
    } else {
      this.winner = challenger;
      this.log(`CHALLENGE成功。総ポイント${score}であなたの勝利。`, "good");
    }
    this.render();
  }

  private endTurn() {
    if (this.human.eliminated || this.winner) return;
    if (!this.human.actionUsed) this.log("行動権を残してターン終了。", "neutral");
    this.runAiTurns();
    this.turn += 1;
    this.currentIndex = 0;
    this.human.actionUsed = false;
    this.drawCards(this.human, 3);
    this.log(`第${this.turn}ラウンド。3枚をドローし、新しい行動権を得た。`, "good");
    this.render();
  }

  private runAiTurns() {
    for (const player of this.players.slice(1)) {
      if (player.eliminated) continue;
      player.actionUsed = false;
      this.drawCards(player, 3);
      const project = player.hand.find((card): card is ProjectCard => card.kind === "project");
      if (project) {
        const materials = player.hand.filter((card): card is MaterialCard => card.kind === "material").slice(0, 3);
        const legal = this.isLegal(project, materials);
        const bluff = !legal || Math.random() < 0.32;
        player.hand = player.hand.filter((card) => card.id !== project.id && !materials.some((material) => material.id === card.id));
        const submission: Submission = {
          id: this.uid("sub"),
          project,
          materials,
          faceUp: !bluff,
          legal,
          effectActivated: false,
        };
        player.submitted.push(submission);
        player.actionUsed = true;
        this.log(`${player.name}が${bluff ? "伏せ" : "公開"}で企画を完成。`, bluff ? "warning" : "neutral");
        if (submission.faceUp) this.activateEffect(player, submission, "表向き提出");
      } else {
        player.coins += 1;
        player.actionUsed = true;
        this.log(`${player.name}が余剰資材を売却し、1コインを得た。`, "neutral");
      }
    }
  }

  private logAndRender(text: string, tone: GameLog["tone"]) {
    this.log(text, tone);
    this.render();
  }

  private startDemo() {
    let step = 0;
    this.demoTimer = window.setInterval(() => {
      if (this.winner || this.human.eliminated) return;
      if (step % 3 === 0) this.endTurn();
      if (step % 3 === 1 && this.human.submitted.length < 3) {
        const project = this.human.hand.find((card): card is ProjectCard => card.kind === "project");
        if (project) {
          this.selectedProjectId = project.id;
          const materials = this.human.hand.filter((card): card is MaterialCard => card.kind === "material").slice(0, 3);
          this.selectedMaterials = new Set(materials.map((card) => card.id));
          this.submitProject(step % 2 === 0);
        }
      }
      if (step % 3 === 2) this.bulkCall();
      step += 1;
    }, 1800);
  }

  private text(value: string, size = 16, color = COLORS.ink, align = Control.HORIZONTAL_ALIGNMENT_LEFT) {
    const text = new TextBlock(this.uid("text"), value);
    text.color = color;
    text.fontFamily = "IBM Plex Sans JP, sans-serif";
    text.fontSize = size;
    text.textHorizontalAlignment = align;
    text.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    text.resizeToFit = false;
    text.textWrapping = true;
    return text;
  }

  private panel(name: string, color = COLORS.panel, radius = 8) {
    const panel = new Rectangle(name);
    panel.background = color;
    panel.thickness = 1;
    panel.color = "#7CCDE333";
    panel.cornerRadius = radius;
    return panel;
  }

  private button(label: string, color: string, callback: () => void, danger = false) {
    const button = Button.CreateSimpleButton(this.uid("button"), label);
    button.height = "42px";
    button.thickness = 1;
    button.cornerRadius = 5;
    button.color = danger ? COLORS.paper : COLORS.dark;
    button.background = color;
    button.fontFamily = "IBM Plex Sans JP, sans-serif";
    button.fontSize = 14;
    button.fontWeight = "700";
    button.paddingBottom = "6px";
    button.onPointerEnterObservable.add(() => (button.alpha = 0.83));
    button.onPointerOutObservable.add(() => (button.alpha = 1));
    button.onPointerUpObservable.add(callback);
    return button;
  }

  private addHeader(root: Grid) {
    const header = new Grid(this.uid("header"));
    header.addColumnDefinition(0.25);
    header.addColumnDefinition(0.5);
    header.addColumnDefinition(0.25);
    root.addControl(header, 0, 0);

    const brand = new Grid(this.uid("brand"));
    brand.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    brand.paddingLeft = "20px";
    brand.width = "260px";
    brand.height = "62px";
    brand.addColumnDefinition(62, true);
    brand.addColumnDefinition(198, true);
    const logo = new Image(this.uid("logo"), ASSET.logo);
    logo.width = "52px";
    logo.height = "52px";
    logo.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    brand.addControl(logo, 0, 0);
    const brandText = new StackPanel(this.uid("brand-text"));
    brandText.isVertical = true;
    brandText.width = "192px";
    brandText.height = "55px";
    const title = this.text("BALKU", 31, COLORS.paper);
    title.fontFamily = "Barlow Condensed, sans-serif";
    title.fontWeight = "800";
    title.height = "31px";
    title.width = "192px";
    brandText.addControl(title);
    const sub = this.text("BUILDER / FIELD TEST", 10, COLORS.cyan);
    sub.height = "16px";
    sub.width = "192px";
    brandText.addControl(sub);
    brand.addControl(brandText, 0, 1);
    header.addControl(brand, 0, 0);

    const center = new StackPanel(this.uid("round"));
    center.isVertical = true;
    center.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    const turnText = this.text(`ROUND ${String(this.turn).padStart(2, "0")}  /  あなたの施工ターン`, 15, COLORS.paper, Control.HORIZONTAL_ALIGNMENT_CENTER);
    turnText.fontWeight = "700";
    turnText.height = "29px";
    center.addControl(turnText);
    const systemText = this.text("3枚ドロー ・ 行動権 1 ・ 提出済み企画3枚でCHALLENGE", 11, COLORS.muted, Control.HORIZONTAL_ALIGNMENT_CENTER);
    systemText.height = "20px";
    center.addControl(systemText);
    header.addControl(center, 0, 1);

    const tableButton = this.button(`卓人数 ${this.tableSize}人  ▸`, COLORS.paper, () => {
      this.tableSize = this.tableSize === 4 ? 2 : this.tableSize + 1;
      this.resetGame();
    });
    tableButton.width = "135px";
    tableButton.height = "32px";
    tableButton.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
    tableButton.paddingRight = "20px";
    header.addControl(tableButton, 0, 2);
  }

  private addPlayerStrip(player: Player, index: number) {
    const strip = this.panel(this.uid("player-strip"), "#0E2028EE", 5);
    strip.height = "64px";
    const grid = new Grid(this.uid("strip-grid"));
    grid.addColumnDefinition(0.1);
    grid.addColumnDefinition(0.53);
    grid.addColumnDefinition(0.2);
    grid.addColumnDefinition(0.17);
    const pin = new Rectangle(this.uid("pin"));
    pin.width = "11px";
    pin.height = "40px";
    pin.background = player.eliminated ? COLORS.red : player.color;
    pin.thickness = 0;
    pin.cornerRadius = 6;
    grid.addControl(pin, 0, 0);
    const name = this.text(player.eliminated ? `${player.name} / 脱落` : player.name, 14, player.eliminated ? COLORS.red : COLORS.paper);
    name.fontWeight = "700";
    grid.addControl(name, 0, 1);
    const projects = this.text(`企画 ${player.submitted.length}/3`, 11, COLORS.muted, Control.HORIZONTAL_ALIGNMENT_CENTER);
    grid.addControl(projects, 0, 2);
    const coins = this.text(`◉ ${player.coins}`, 14, COLORS.yellow, Control.HORIZONTAL_ALIGNMENT_CENTER);
    coins.fontWeight = "700";
    grid.addControl(coins, 0, 3);
    strip.addControl(grid);
    strip.metadata = { index };
    return strip;
  }

  private addActionPanel(parent: Grid) {
    const box = this.panel(this.uid("action-panel"));
    box.paddingLeft = "12px";
    box.paddingRight = "12px";
    box.paddingTop = "12px";
    box.paddingBottom = "12px";
    const stack = new StackPanel(this.uid("action-stack"));
    stack.isVertical = true;
    const actionLabel = this.text(this.human.actionUsed ? "ACTION USED" : "ACTION 01 / 01", 13, this.human.actionUsed ? COLORS.orange : COLORS.cyan);
    actionLabel.fontWeight = "700";
    actionLabel.height = "24px";
    stack.addControl(actionLabel);
    const hint = this.text("企画を1枚、素材を任意数選び、公開または伏せて提出します。", 12, COLORS.muted);
    hint.height = "52px";
    stack.addControl(hint);
    const open = this.button("公開で企画完成", COLORS.cyan, () => this.submitProject(true));
    open.width = 1;
    stack.addControl(open);
    const hidden = this.button("伏せて企画完成", COLORS.yellow, () => this.submitProject(false));
    hidden.width = 1;
    hidden.paddingTop = "6px";
    stack.addControl(hidden);
    const auction = this.button("売却オークション", "#B6CBD1", () => this.sellAuction());
    auction.width = 1;
    auction.paddingTop = "6px";
    stack.addControl(auction);
    const divider = new Rectangle(this.uid("divider"));
    divider.height = "1px";
    divider.background = "#8FC9D544";
    divider.thickness = 0;
    divider.paddingTop = "12px";
    divider.paddingBottom = "10px";
    stack.addControl(divider);
    const call = this.button("BALKU CALL", COLORS.yellow, () => this.bulkCall());
    call.width = 1;
    stack.addControl(call);
    const challenge = this.button("CHALLENGE", COLORS.red, () => this.challenge(), true);
    challenge.width = 1;
    challenge.paddingTop = "6px";
    stack.addControl(challenge);
    const end = this.button("ターン終了  →", "#244755", () => this.endTurn(), true);
    end.width = 1;
    end.paddingTop = "12px";
    stack.addControl(end);
    box.addControl(stack);
    parent.addControl(box, 0, 0);
  }

  private submissionCard(submission: Submission) {
    const card = this.panel(this.uid("submission"), submission.faceUp ? "#F2E9D5F4" : "#29363BEF", 4);
    card.height = "88px";
    card.width = "152px";
    card.thickness = 2;
    card.color = submission.faceUp ? COLORS.cyanDeep : COLORS.yellow;
    const art = new Image(this.uid("submission-art"), submission.faceUp ? ASSET.project : ASSET.material);
    art.width = 1;
    art.height = 1;
    art.alpha = submission.faceUp ? 0.12 : 0.07;
    art.stretch = Image.STRETCH_FILL;
    card.addControl(art);
    const content = new StackPanel(this.uid("submission-content"));
    content.isVertical = true;
    content.paddingLeft = "9px";
    content.paddingRight = "9px";
    const state = this.text(submission.faceUp ? (submission.legal ? "APPROVED / 公開" : "公開・検査待ち") : "▧ 伏せた企画 / HIDDEN", 10, submission.faceUp ? COLORS.cyanDeep : COLORS.yellow);
    state.fontWeight = "700";
    state.height = "19px";
    content.addControl(state);
    const title = this.text(submission.faceUp ? submission.project.name : "企画書 — 非開示", 16, submission.faceUp ? COLORS.paperInk : COLORS.paper);
    title.fontWeight = "800";
    title.height = "25px";
    content.addControl(title);
    const details = this.text(submission.faceUp ? `${submission.project.points} PT  /  添付素材 ${submission.materials.length} 枚` : `添付素材 ${submission.materials.length} 枚 / BALKU対象`, 10, submission.faceUp ? "#53626B" : COLORS.muted);
    details.height = "21px";
    content.addControl(details);
    card.addControl(content);
    return card;
  }

  private addBuildBoard(parent: Grid) {
    const board = this.panel(this.uid("board"), "#EFE2C5F7", 8);
    board.color = "#51BBD1";
    const draftingTitle = this.text("SITE PLAN  /  提出済み企画エリア  /  SCALE 1:250", 10, "#46646B", Control.HORIZONTAL_ALIGNMENT_CENTER);
    draftingTitle.top = "8px";
    draftingTitle.height = "18px";
    draftingTitle.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    board.addControl(draftingTitle);
    for (let line = 0; line < 5; line += 1) {
      const blueprintLine = new Rectangle(this.uid("blueprint-line"));
      blueprintLine.width = "92%";
      blueprintLine.height = "1px";
      blueprintLine.thickness = 0;
      blueprintLine.background = "#39BFE82F";
      blueprintLine.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
      blueprintLine.top = `${42 + line * 41}px`;
      board.addControl(blueprintLine);
    }
    const structure = new Grid(this.uid("board-grid"));
    structure.addRowDefinition(0.23);
    structure.addRowDefinition(0.77);
    const rivals = new Grid(this.uid("rivals"));
    const rivalsList = this.players.slice(1);
    rivalsList.forEach((_player) => rivals.addColumnDefinition(1 / Math.max(1, rivalsList.length)));
    rivalsList.forEach((player, index) => {
      const rival = new StackPanel(this.uid("rival-stack"));
      rival.isVertical = true;
      rival.paddingLeft = "8px";
      rival.paddingRight = "8px";
      rival.addControl(this.addPlayerStrip(player, index + 1));
      const score = this.text(`提出点: ${this.totalPoints(player)} pt`, 11, COLORS.muted, Control.HORIZONTAL_ALIGNMENT_CENTER);
      score.height = "22px";
      rival.addControl(score);
      rivals.addControl(rival, 0, index);
    });
    structure.addControl(rivals, 0, 0);

    const lower = new Grid(this.uid("lower-board"));
    lower.addColumnDefinition(0.25);
    lower.addColumnDefinition(0.75);
    const yours = new StackPanel(this.uid("your-status"));
    yours.isVertical = true;
    yours.paddingLeft = "14px";
    const tag = this.text("YOUR YARD / 施工ヤード", 11, COLORS.cyanDeep);
    tag.fontWeight = "700";
    tag.height = "24px";
    yours.addControl(tag);
    const point = this.text(`${this.totalPoints(this.human)} PT`, 39, COLORS.paperInk);
    point.fontFamily = "Barlow Condensed, sans-serif";
    point.fontWeight = "800";
    point.height = "52px";
    yours.addControl(point);
    const descriptor = this.text(`提出済み ${this.human.submitted.length}/3\nコイン ◉ ${this.human.coins}`, 13, "#52656A");
    descriptor.height = "47px";
    yours.addControl(descriptor);
    const rules = this.text("素材不足でも積める。BALKUされれば束を接収される。", 11, "#A65431");
    rules.height = "42px";
    yours.addControl(rules);
    lower.addControl(yours, 0, 0);

    const site = new Grid(this.uid("site"));
    for (let index = 0; index < 3; index += 1) site.addColumnDefinition(1 / 3);
    const label = this.text("提出済み企画 — 素材は企画書の下に積まれる", 12, "#52656A", Control.HORIZONTAL_ALIGNMENT_CENTER);
    label.top = "-77px";
    label.height = "22px";
    label.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    label.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    site.addControl(label);
    for (let index = 0; index < 3; index += 1) {
      const submission = this.human.submitted[index];
      if (submission) {
        const pile = new StackPanel(this.uid("pile"));
        pile.isVertical = true;
        pile.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
        const matStack = new Rectangle(this.uid("materials-under"));
        matStack.height = "17px";
        matStack.width = "126px";
        matStack.background = submission.materials.length ? "#B87A4B" : "#354C55";
        matStack.color = "#0C171B";
        matStack.thickness = 1;
        matStack.top = "9px";
        pile.addControl(matStack);
        pile.addControl(this.submissionCard(submission));
        const check = this.text(submission.faceUp ? (submission.effectActivated ? "効果 発動済み" : "効果 保留") : "BALKU開示まで保留", 10, submission.faceUp ? COLORS.green : COLORS.yellow, Control.HORIZONTAL_ALIGNMENT_CENTER);
        check.height = "20px";
        pile.addControl(check);
        site.addControl(pile, 0, index);
      } else {
        const empty = new Rectangle(this.uid("empty-site"));
        empty.height = "105px";
        empty.width = "152px";
        empty.thickness = 1;
        empty.color = "#2D899E99";
        empty.background = "#DFD0B0A0";
        const marker = this.text(`SLOT ${index + 1}\n企画を積む`, 13, "#52656A", Control.HORIZONTAL_ALIGNMENT_CENTER);
        marker.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
        empty.addControl(marker);
        site.addControl(empty, 0, index);
      }
    }
    lower.addControl(site, 0, 1);
    structure.addControl(lower, 1, 0);
    board.addControl(structure);
    parent.addControl(board, 0, 1);
  }

  private addFeed(parent: Grid) {
    const panel = this.panel(this.uid("feed"));
    panel.paddingLeft = "11px";
    panel.paddingRight = "11px";
    panel.paddingTop = "12px";
    const stack = new StackPanel(this.uid("feed-stack"));
    stack.isVertical = true;
    const title = this.text("現場ログ / MARKET", 13, COLORS.cyan);
    title.fontWeight = "700";
    title.height = "28px";
    stack.addControl(title);
    const auction = this.panel(this.uid("market-card"), "#1E3943E8", 4);
    auction.height = "66px";
    const marketText = this.text("オークション\n選択カードを売却してコイン化", 12, COLORS.paper);
    marketText.paddingLeft = "10px";
    auction.addControl(marketText);
    stack.addControl(auction);
    this.logs.forEach((entry) => {
      const row = new Rectangle(this.uid("log-row"));
      row.height = "47px";
      row.thickness = 0;
      row.background = "#0B1A20AA";
      const color = entry.tone === "good" ? COLORS.green : entry.tone === "warning" ? COLORS.yellow : entry.tone === "danger" ? COLORS.red : COLORS.muted;
      const text = this.text(entry.text, 11, color);
      text.paddingLeft = "8px";
      text.paddingRight = "6px";
      row.addControl(text);
      row.paddingTop = "4px";
      stack.addControl(row);
    });
    panel.addControl(stack);
    parent.addControl(panel, 0, 2);
  }

  private makeHandCard(card: GameCard) {
    const selected = card.kind === "project" ? card.id === this.selectedProjectId : this.selectedMaterials.has(card.id);
    const base = card.kind === "project" ? COLORS.paper : "#1C3540F8";
    const cardBox = this.panel(this.uid("hand-card"), base, 5);
    cardBox.width = "122px";
    cardBox.height = "142px";
    cardBox.thickness = selected ? 3 : 1;
    cardBox.color = selected ? COLORS.yellow : card.kind === "project" ? "#B7A989" : "#4B8294";
    cardBox.onPointerUpObservable.add(() => this.handleHandCard(card));
    const art = new Image(this.uid("hand-art"), card.kind === "project" ? ASSET.project : ASSET.material);
    art.width = 1;
    art.height = 1;
    art.alpha = card.kind === "project" ? 0.13 : 0.08;
    art.stretch = Image.STRETCH_FILL;
    cardBox.addControl(art);
    const contents = new StackPanel(this.uid("hand-content"));
    contents.isVertical = true;
    contents.paddingLeft = "9px";
    contents.paddingRight = "8px";
    contents.paddingTop = "7px";
    const type = this.text(card.kind === "project" ? (card.immediate ? "即時企画 / PLAN" : "素材企画 / PLAN") : "素材 / MATERIAL", 9, card.kind === "project" ? COLORS.cyanDeep : MATERIAL_COLOR[card.material]);
    type.fontWeight = "700";
    type.height = "19px";
    contents.addControl(type);
    const title = this.text(card.name, 17, card.kind === "project" ? COLORS.paperInk : COLORS.paper);
    title.fontWeight = "800";
    title.height = "32px";
    contents.addControl(title);
    if (card.kind === "project") {
      const requires = this.text(this.requirementsText(card), 10, "#43565F");
      requires.height = "28px";
      contents.addControl(requires);
      const effect = this.text(card.effect.label, 11, COLORS.cyanDeep);
      effect.fontWeight = "700";
      effect.height = "23px";
      contents.addControl(effect);
      const points = this.text(`${card.points} PT`, 18, COLORS.orange);
      points.fontFamily = "Barlow Condensed, sans-serif";
      points.fontWeight = "800";
      points.height = "24px";
      contents.addControl(points);
    } else {
      const material = this.text(`資材区分\n${card.material}`, 12, COLORS.muted);
      material.height = "43px";
      contents.addControl(material);
      const count = this.text("納品用カード", 11, MATERIAL_COLOR[card.material]);
      count.fontWeight = "700";
      count.height = "22px";
      contents.addControl(count);
    }
    cardBox.addControl(contents);
    return cardBox;
  }

  private addHand(root: Grid) {
    const handArea = this.panel(this.uid("hand-area"), "#08171DEB", 0);
    handArea.thickness = 1;
    handArea.color = "#3AA9C355";
    const label = this.text(`手札 ${this.human.hand.length}枚  — 企画は1枚、素材は複数選択  /  選択: ${this.selectedProjectId ? "企画あり" : "企画なし"}・素材 ${this.selectedMaterials.size}枚`, 12, COLORS.muted);
    label.top = "8px";
    label.left = "21px";
    label.height = "22px";
    label.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
    handArea.addControl(label);
    const scroll = new StackPanel(this.uid("cards"));
    scroll.isVertical = false;
    scroll.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    scroll.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
    scroll.height = "158px";
    scroll.paddingBottom = "10px";
    this.human.hand.slice(0, 8).forEach((card) => {
      const visual = this.makeHandCard(card);
      visual.paddingLeft = "5px";
      visual.paddingRight = "5px";
      scroll.addControl(visual);
    });
    handArea.addControl(scroll);
    root.addControl(handArea, 2, 0);
  }

  render() {
    this.ui.rootContainer.clearControls();
    const background = new Image(this.uid("background"), ASSET.background);
    background.width = 1;
    background.height = 1;
    background.alpha = 0.42;
    background.stretch = Image.STRETCH_FILL;
    this.ui.addControl(background);
    const tint = new Rectangle(this.uid("tint"));
    tint.width = 1;
    tint.height = 1;
    tint.thickness = 0;
    tint.background = "#041016A6";
    this.ui.addControl(tint);

    const root = new Grid(this.uid("root"));
    root.width = 1;
    root.height = 1;
    root.addRowDefinition(0.115);
    root.addRowDefinition(0.615);
    root.addRowDefinition(0.27);
    root.addColumnDefinition(1);
    root.paddingTop = "7px";
    root.paddingBottom = "0px";
    this.ui.addControl(root);
    this.addHeader(root);

    const main = new Grid(this.uid("main"));
    main.paddingLeft = "16px";
    main.paddingRight = "16px";
    main.paddingTop = "4px";
    main.paddingBottom = "8px";
    main.addColumnDefinition(0.205);
    main.addColumnDefinition(0.565);
    main.addColumnDefinition(0.23);
    this.addActionPanel(main);
    this.addBuildBoard(main);
    this.addFeed(main);
    root.addControl(main, 1, 0);
    this.addHand(root);

    if (this.winner || this.human.eliminated) this.addEndOverlay();
  }

  private addEndOverlay() {
    const shade = new Rectangle(this.uid("end-shade"));
    shade.width = 1;
    shade.height = 1;
    shade.thickness = 0;
    shade.background = "#041016D9";
    this.ui.addControl(shade);
    const modal = this.panel(this.uid("end-modal"), "#102C36", 10);
    modal.width = "430px";
    modal.height = "245px";
    modal.thickness = 2;
    modal.color = this.winner ? COLORS.cyan : COLORS.red;
    modal.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    modal.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    const content = new StackPanel(this.uid("end-content"));
    content.isVertical = true;
    content.paddingLeft = "32px";
    content.paddingRight = "32px";
    const kicker = this.text(this.winner ? "FINAL INSPECTION PASSED" : "SITE CLOSED", 13, this.winner ? COLORS.cyan : COLORS.red, Control.HORIZONTAL_ALIGNMENT_CENTER);
    kicker.fontWeight = "700";
    kicker.height = "43px";
    content.addControl(kicker);
    const headline = this.text(this.winner ? "CHALLENGE 成功" : "GAME OVER", 43, COLORS.paper, Control.HORIZONTAL_ALIGNMENT_CENTER);
    headline.fontFamily = "Barlow Condensed, sans-serif";
    headline.fontWeight = "800";
    headline.height = "66px";
    content.addControl(headline);
    const body = this.text(this.winner ? `総ポイント ${this.totalPoints(this.winner)}。最も高い施工計画を証明しました。` : "ロスト条件を満たせず、手札と提出企画をすべて失いました。", 15, COLORS.muted, Control.HORIZONTAL_ALIGNMENT_CENTER);
    body.height = "54px";
    content.addControl(body);
    const restart = this.button("新しい現場を開始", COLORS.yellow, () => this.resetGame());
    restart.width = "220px";
    restart.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
    content.addControl(restart);
    modal.addControl(content);
    this.ui.addControl(modal);
  }
}
