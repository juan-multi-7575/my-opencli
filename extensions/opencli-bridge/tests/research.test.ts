import { describe, it, expect, beforeEach } from "vitest";
import { buildResearchPlan, executeResearchPlan } from "../research";
import { buildRegistry } from "../registry";
import { listFixture } from "./fixtures";
import { __setSessionKeySupportForTest } from "../capabilities";

const registry = buildRegistry(listFixture);
const AI = ["gemini", "kimi"];

beforeEach(() => __setSessionKeySupportForTest(true));

/** exec stub that returns fake JSON for the site being called. */
function fakeExec(_cmd: string, args: string[]) {
  const site = args[0];
  return Promise.resolve({
    stdout: JSON.stringify([{ title: `${site} result`, url: `https://${site}/x` }]),
    stderr: "",
    code: 0,
  });
}

describe("buildResearchPlan", () => {
  it("builds 1 AI + 2 specialized steps for the default profile", () => {
    const plan = buildResearchPlan("topic", "default", registry, AI);
    expect(plan.filter((s) => s.kind === "ai")).toHaveLength(1);
    expect(plan.filter((s) => s.kind === "specialized")).toHaveLength(2);
  });

  it("never exceeds 2 specialized sources regardless of depth", () => {
    const plan = buildResearchPlan("topic", "default", registry, AI, 3);
    expect(plan.filter((s) => s.kind === "specialized").length).toBeLessThanOrEqual(2);
  });

  it("depth 1 yields exactly 1 specialized source", () => {
    const plan = buildResearchPlan("topic", "default", registry, AI, 1);
    expect(plan.filter((s) => s.kind === "specialized")).toHaveLength(1);
  });

  it("skips specialized sites missing from the registry", () => {
    // build a registry without hackernews/duckduckgo → only the AI step survives
    const thin = buildRegistry(listFixture.filter((c) => !["hackernews", "duckduckgo"].includes(c.site)));
    const plan = buildResearchPlan("topic", "default", thin, AI);
    expect(plan).toHaveLength(1);
    expect(plan[0].kind).toBe("ai");
  });

  it("falls back to the next reachable AI adapter when the profile AI site is absent", () => {
    // default profile wants grok; grok isn't in the registry → gemini wins
    const plan = buildResearchPlan("topic", "default", registry, AI);
    expect(plan[0].site).toBe("gemini");
  });

  it("uses the profile's own AI site as the terminal fallback", () => {
    // no chain fallback reachable → the profile's own AI site (grok) wins, unverified
    const plan = buildResearchPlan("topic", "default", registry, []);
    expect(plan.some((s) => s.kind === "ai")).toBe(true);
    expect(plan.find((s) => s.kind === "ai")?.site).toBe("grok");
  });

  it("prefers the fallback chain over the profile site", () => {
    // kimi absent, gemini present → gemini, not the profile's grok
    const plan = buildResearchPlan("topic", "default", registry, ["kimi", "gemini"]);
    expect(plan.find((s) => s.kind === "ai")?.site).toBe("gemini");
  });

  it("marks browser-backed steps so they get a session key", () => {
    const plan = buildResearchPlan("topic", "default", registry, AI);
    const aiStep = plan.find((s) => s.kind === "ai")!;
    // gemini/ask is browser-backed in the fixture
    expect(aiStep.browser).toBe(true);
    const hn = plan.find((s) => s.site === "hackernews")!;
    expect(hn.browser).toBe(false);
  });
});

describe("executeResearchPlan", () => {
  it("returns the profile it was given, not a hardcoded default", async () => {
    const plan = buildResearchPlan("t", "coding-agent", registry, AI);
    const result = await executeResearchPlan(plan, "t", fakeExec, undefined, "coding-agent");
    expect(result.profile).toBe("coding-agent");
  });

  it("collects ok calls and a summary per step", async () => {
    const plan = buildResearchPlan("t", "default", registry, AI);
    const result = await executeResearchPlan(plan, "t", fakeExec, undefined, "default");
    expect(result.calls.length).toBe(plan.length);
    expect(result.calls.every((c) => c.status === "ok")).toBe(true);
    expect(result.summary).toContain("result");
  });

  it("marks error calls without throwing", async () => {
    const failing = (_cmd: string, _args: string[]) =>
      Promise.resolve({ stdout: "", stderr: "boom", code: 1 });
    const plan = [{ site: "gemini", command: "ask", args: [], kind: "ai" as const }];
    const result = await executeResearchPlan(plan, "t", failing);
    expect(result.calls[0].status).toBe("error");
    expect(result.calls[0].error).toContain("boom");
  });

  it("appends a --session-key only to browser-backed steps", async () => {
    const calls: string[][] = [];
    const exec = (_cmd: string, args: string[]) => {
      calls.push(args);
      return Promise.resolve({ stdout: "[]", stderr: "", code: 0 });
    };
    const plan = [
      { site: "gemini", command: "ask", args: ["q"], kind: "ai" as const, browser: true },
      { site: "crates", command: "search", args: ["q"], kind: "specialized" as const, browser: false },
    ];
    await executeResearchPlan(plan, "t", exec, undefined, "default");
    const ask = calls.find((a) => a[0] === "gemini")!;
    expect(ask).toContain("--session-key");
    const crates = calls.find((a) => a[0] === "crates")!;
    expect(crates).not.toContain("--session-key");
  });
});
