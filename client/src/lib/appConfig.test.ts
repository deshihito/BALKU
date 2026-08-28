import { describe, expect, it } from "vitest";

describe("app title configuration", () => {
  it("サイトタイトルが空でない", () => {
    const title = import.meta.env.VITE_APP_TITLE ?? "BALKU | Builder Card Game";
    expect(title).toContain("BALKU");
  });
});
