import { describe, it, expect, vi, beforeEach } from "vitest";

// isToolCallEventType is just `event.toolName === toolName` — stub it so the
// test doesn't need the pi package at runtime.
vi.mock("@earendil-works/pi-coding-agent", () => ({
  isToolCallEventType: (toolName: string, event: any) => event.toolName === toolName,
}));

import { registerEnforcement } from "../enforce";
import { buildRegistry } from "../registry";
import { listFixture } from "./fixtures";

const registry = buildRegistry(listFixture);

type Handler = (event: any, ctx: any) => Promise<any> | any;

function setup(enabled = true) {
  const pi: any = { on: vi.fn() };
  const handlers = new Map<string, Handler>();
  pi.on.mockImplementation((name: string, fn: Handler) => handlers.set(name, fn));
  registerEnforcement(pi, () => registry, () => enabled);
  return {
    run: (cmd: string, tool = "bash") =>
      handlers.get("tool_call")!({ toolName: tool, input: { command: cmd } }, {}),
  };
}

describe("enforcement", () => {
  beforeEach(() => {
    delete process.env.OPENCLI_BYPASS;
  });

  it("blocks curl to an OpenCLI-supported site and suggests the tool", async () => {
    const { run } = setup();
    const res = await run("curl https://www.reddit.com/r/rust/top.json");
    expect(res.block).toBe(true);
    expect(res.reason).toContain("reddit");
    expect(res.reason).toContain("opencli_run");
  });

  it("blocks wget to an OpenCLI-supported site", async () => {
    const { run } = setup();
    const res = await run("wget -q https://github.com/foo/bar");
    expect(res.block).toBe(true);
  });

  it("never blocks localhost or private-network traffic", async () => {
    const { run } = setup();
    expect(await run("curl http://localhost:8080/health")).toBeUndefined();
    expect(await run("curl http://192.168.1.10/")).toBeUndefined();
  });

  it("ignores commands without scrape patterns", async () => {
    const { run } = setup();
    expect(await run("ls -la && git status")).toBeUndefined();
  });

  it("blocks unknown public URLs too, with an honest bypass hint", async () => {
    const { run } = setup();
    const res = await run("curl -O https://cdn.example.com/file.zip");
    expect(res.block).toBe(true);
    expect(res.reason).toContain("OPENCLI_BYPASS");
  });

  it("honors OPENCLI_BYPASS=1 for supported sites", async () => {
    const { run } = setup();
    process.env.OPENCLI_BYPASS = "1";
    try {
      expect(await run("curl https://www.reddit.com/r/rust/top.json")).toBeUndefined();
    } finally {
      delete process.env.OPENCLI_BYPASS;
    }
  });

  it("does nothing when enforcement is disabled", async () => {
    const { run } = setup(false);
    expect(await run("curl https://www.reddit.com/r/rust/top.json")).toBeUndefined();
  });

  it("ignores non-bash tool calls", async () => {
    const { run } = setup();
    expect(await run("curl https://www.reddit.com/", "read")).toBeUndefined();
  });
});
