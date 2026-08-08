import { describe, it, expect } from "vitest";
import { shellQuote } from "../tools";
import { ALLOWED_SITES, REMOVED_SITES } from "../allowed-sites";

describe("allowlist", () => {
  it("keeps core sites", () => {
    for (const s of ["reddit", "github", "arxiv", "hackernews", "gemini", "web", "duckduckgo"]) {
      expect(ALLOWED_SITES.has(s), s).toBe(true);
    }
  });

  it("marks selected sites as removed", () => {
    for (const s of ["zhihu", "bilibili", "xiaohongshu", "taobao", "douyin", "weibo", "wttr", "yahoo-finance"]) {
      expect(REMOVED_SITES.has(s), s).toBe(true);
    }
  });

  it("the sets partition the registry without overlap", () => {
    for (const s of ALLOWED_SITES) expect(REMOVED_SITES.has(s), s).toBe(false);
  });
});

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
