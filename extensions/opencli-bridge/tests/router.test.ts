import { describe, it, expect } from "vitest";
import { routeQuery, siteExists } from "../router";
import { buildRegistry } from "../registry";
import { listFixture } from "./fixtures";

const registry = buildRegistry(listFixture);

describe("routeQuery", () => {
  it("routes bare 'rust' queries to general search, not crates.io", () => {
    const route = routeQuery("how does rust handle async");
    expect(route.site).toBe("duckduckgo");
  });

  it("routes crate-specific queries to crates.io", () => {
    const route = routeQuery("best rust crates for async http");
    expect(route.site).toBe("crates");
    expect(route.command).toBe("search");
  });

  it("routes pypi queries to the package command (pypi has no search)", () => {
    const route = routeQuery("pypi package for pdf parsing");
    expect(route.site).toBe("pypi");
    expect(route.command).toBe("package");
  });

  it("routes 'github trending' to github-trending repos", () => {
    const route = routeQuery("github trending this week");
    expect(route.site).toBe("github-trending");
    expect(route.command).toBe("repos");
  });

  it("does not misroute bare 'github' to trending", () => {
    const route = routeQuery("github");
    expect(route.site).toBe("duckduckgo");
  });

  it("honors an explicit site override", () => {
    const route = routeQuery("rust async", "reddit");
    expect(route.site).toBe("reddit");
    expect(route.command).toBe("search");
    expect(route.reason).toContain("explicit site override");
  });

  it("routes AI asks to the right adapter", () => {
    expect(routeQuery("ask kimi to summarize this").site).toBe("kimi");
    expect(routeQuery("ask gemini a question").site).toBe("gemini");
    expect(routeQuery("ask qwen to explain").site).toBe("qwen");
  });

  it("routes deep research to gemini deep-research", () => {
    const route = routeQuery("do a deep research on llm evals");
    expect(route.site).toBe("gemini");
    expect(route.command).toBe("deep-research");
  });

  it("routes youtube transcript requests", () => {
    const route = routeQuery("youtube transcript of this video");
    expect(route.site).toBe("youtube");
    expect(route.command).toBe("transcript");
  });

  it("routes page-read intents to web/read", () => {
    const route = routeQuery("read this page and summarize it");
    expect(route.site).toBe("web");
    expect(route.command).toBe("read");
  });

  it("routes weather queries to general search (wttr removed)", () => {
    const route = routeQuery("weather in tokyo tomorrow");
    expect(route.site).toBe("duckduckgo");
    expect(route.command).toBe("search");
  });

  it("routes tutorial intents to youtube before generic fallback", () => {
    const route = routeQuery("how to learn rust quickly");
    expect(route.site).toBe("youtube");
  });

  it("falls back to duckduckgo for unknown queries", () => {
    const route = routeQuery("quantum entanglement explained");
    expect(route.site).toBe("duckduckgo");
    expect(route.command).toBe("search");
  });
});

describe("siteExists", () => {
  it("accepts known sites", () => {
    expect(siteExists("reddit", registry)).toBe(true);
    expect(siteExists("web", registry)).toBe(true);
  });

  it("rejects unknown sites", () => {
    expect(siteExists("not-a-site", registry)).toBe(false);
  });

  it("assumes existence when the registry is unavailable", () => {
    expect(siteExists("anything", null)).toBe(false);
  });
});
