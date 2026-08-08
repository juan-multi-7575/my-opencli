import { describe, it, expect } from "vitest";
import { buildRegistry, getCommandSchema, matchSiteFromHostname, extractUrls, isSafeHost } from "../registry";
import { listFixture } from "./fixtures";

const registry = buildRegistry(listFixture);

describe("buildRegistry", () => {
  it("deduplicates sites", () => {
    expect(registry.sites.map((s) => s.site)).toEqual(["reddit", "github", "crates", "web", "gemini", "hackernews", "duckduckgo"]);
  });

  it("prunes removed sites from the allowlist", () => {
    const withRemoved = buildRegistry([...listFixture, { site: "zhihu", name: "hot", access: "read" }]);
    expect(withRemoved.sites.map((s) => s.site)).not.toContain("zhihu");
  });

  it("collects commands per site", () => {
    expect(registry.siteCommands.get("reddit")).toEqual(["search", "reply"]);
    expect(registry.siteCommands.get("web")).toEqual(["read"]);
  });

  it("maps domains including www prefix", () => {
    expect(registry.domainMap.get("reddit.com")).toBe("reddit");
    expect(registry.domainMap.get("www.reddit.com")).toBe("reddit");
  });

  it("keeps full command schemas with args and access", () => {
    const schema = getCommandSchema(registry, "reddit", "reply")!;
    expect(schema.access).toBe("write");
    expect(schema.args.map((a) => a.name)).toEqual(["comment_id", "message"]);
    expect(schema.args[0].required).toBe(true);
  });

  it("maps aliases to the same schema", () => {
    expect(getCommandSchema(registry, "reddit", "s")?.name).toBe("search");
    expect(getCommandSchema(registry, "web", "r")?.name).toBe("read");
  });

  it("tolerates entries with null domains", () => {
    expect(getCommandSchema(registry, "web", "read")?.site).toBe("web");
  });
});

describe("matchSiteFromHostname", () => {
  it("matches direct and www hostnames", () => {
    expect(matchSiteFromHostname("reddit.com", registry)).toBe("reddit");
    expect(matchSiteFromHostname("www.reddit.com", registry)).toBe("reddit");
  });

  it("matches subdomains via suffix", () => {
    expect(matchSiteFromHostname("old.reddit.com", registry)).toBe("reddit");
  });

  it("returns null for unknown hosts", () => {
    expect(matchSiteFromHostname("example.org", registry)).toBeNull();
  });
});

describe("extractUrls", () => {
  it("extracts multiple URLs", () => {
    const urls = extractUrls("curl https://a.com/x && wget https://b.org/y");
    expect(urls.map((u) => u.hostname)).toEqual(["a.com", "b.org"]);
  });

  it("strips trailing punctuation", () => {
    const urls = extractUrls("see https://a.com/x.");
    expect(urls[0].href.endsWith(".")).toBe(false);
  });

  it("skips invalid URLs", () => {
    expect(extractUrls("curl http://")).toHaveLength(0);
    expect(extractUrls("no urls here")).toHaveLength(0);
  });
});

describe("isSafeHost", () => {
  it("allows localhost and private ranges", () => {
    expect(isSafeHost("localhost")).toBe(true);
    expect(isSafeHost("127.0.0.1")).toBe(true);
    expect(isSafeHost("192.168.1.5")).toBe(true);
    expect(isSafeHost("10.0.0.2")).toBe(true);
  });

  it("blocks public hosts", () => {
    expect(isSafeHost("example.com")).toBe(false);
    expect(isSafeHost("sub.example.com")).toBe(false);
  });
});
