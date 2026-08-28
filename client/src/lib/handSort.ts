export type SortableHandCard = {
  id: string;
  kind: "material" | "project";
  name: string;
};

export type SortedHand<TCard extends SortableHandCard> = {
  projects: TCard[];
  materials: TCard[];
};

const compareJapaneseNames = (left: string, right: string) => left.localeCompare(right, "ja", { numeric: true });

const sortCards = <TCard extends SortableHandCard>(cards: TCard[]) => cards
  .map((card, index) => ({ card, index }))
  .sort((left, right) => compareJapaneseNames(left.card.name, right.card.name) || left.index - right.index)
  .map(({ card }) => card);

/** 表示順のみを整える。企画は左列、素材は右列に置き、同名カードを連続させる。 */
export function sortHandCards<TCard extends SortableHandCard>(cards: TCard[]): SortedHand<TCard> {
  return {
    projects: sortCards(cards.filter((card) => card.kind === "project")),
    materials: sortCards(cards.filter((card) => card.kind === "material")),
  };
}
