import { describe, it, expect } from "vitest";
import { shellQuote } from "../tools";

describe("shellQuote", () => {
  it("leaves single words untouched", () => {
    expect(shellQuote("reddit")).toBe("reddit");
    expect(shellQuote("search")).toBe("search");
    expect(shellQuote("--limit")).toBe("--limit");
  });

  it("quotes multi-word queries so they stay one argument", () => {
    expect(shellQuote("rust async runtime")).toBe('"rust async runtime"');
  });

  it("escapes embedded quotes", () => {
    expect(shellQuote('say "hi" there')).toBe('"say \\"hi\\" there"');
  });
});
