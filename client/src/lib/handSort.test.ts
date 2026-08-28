import { describe, expect, it } from "vitest";
import { sortHandCards } from "./handSort";

describe("sortHandCards", () => {
  it("企画を左列用、素材を右列用に分け、各列で同名カードを連続させる", () => {
    const hand = [
      { id: "mat-wood-1", kind: "material" as const, name: "木材" },
      { id: "plan-city", kind: "project" as const, name: "市民ホール" },
      { id: "mat-steel-1", kind: "material" as const, name: "鉄骨" },
      { id: "plan-city-2", kind: "project" as const, name: "市民ホール" },
      { id: "mat-wood-2", kind: "material" as const, name: "木材" },
      { id: "plan-dome", kind: "project" as const, name: "高耐久ドーム" },
    ];

    const sorted = sortHandCards(hand);

    expect(sorted.projects.map((card) => card.id)).toEqual(["plan-dome", "plan-city", "plan-city-2"]);
    expect(sorted.materials.map((card) => card.id)).toEqual(["mat-steel-1", "mat-wood-1", "mat-wood-2"]);
    expect(hand.map((card) => card.id)).toEqual(["mat-wood-1", "plan-city", "mat-steel-1", "plan-city-2", "mat-wood-2", "plan-dome"]);
  });
});
