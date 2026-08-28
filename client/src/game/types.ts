// BALKU / 現場図面アーケード: ルールの用語をUIから独立して保持する。

export type MaterialKind = "木材" | "鉄骨" | "コンクリート" | "ガラス" | "銅線";
export type EffectType = "coins" | "draw" | "auction";

export type MaterialCard = {
  id: string;
  kind: "material";
  material: MaterialKind;
  name: string;
  value: number;
};

export type ProjectCard = {
  id: string;
  kind: "project";
  name: string;
  points: number;
  requirements: Partial<Record<MaterialKind, number>>;
  effect: { type: EffectType; amount: number; label: string };
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
};

export type Player = {
  id: string;
  name: string;
  color: string;
  coins: number;
  hand: GameCard[];
  submitted: Submission[];
  eliminated: boolean;
  actionUsed: boolean;
};

export type LogTone = "neutral" | "good" | "warning" | "danger";
export type GameLog = { text: string; tone: LogTone };
