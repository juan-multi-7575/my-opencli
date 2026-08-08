import { describe, it, expect } from "vitest";
import { createBudget, budgetedExec } from "../budget";

describe("createBudget", () => {
  it("serves identical (site, query) repeats from cache", () => {
    const b = createBudget();
    const { hit } = b.lookup("reddit", "rust async");
    expect(hit).toBe(false);
    b.store("reddit", "rust async", "cached-content");
    const again = b.lookup("reddit", "rust async");
    expect(again.hit).toBe(true);
    expect(again.content).toBe("cached-content");
  });

  it("normalizes query case/whitespace for cache keys", () => {
    const b = createBudget();
    b.store("reddit", "Rust   ASYNC", "x");
    expect(b.lookup("reddit", "rust async").hit).toBe(true);
  });

  it("keeps distinct queries distinct", () => {
    const b = createBudget();
    b.lookup("reddit", "a");
    expect(b.lookup("reddit", "b").hit).toBe(false);
    expect(b.lookup("reddit", "c").hit).toBe(false);
  });

  it("warns after the soft cap but never blocks", () => {
    const b = createBudget({ softCap: 2 });
    expect(b.lookup("reddit", "q1").warning).toBeUndefined();
    expect(b.lookup("reddit", "q2").warning).toBeUndefined();
    const over = b.lookup("reddit", "q3");
    expect(over.hit).toBe(false);
    expect(over.warning).toContain("soft cap");
    expect(over.warning).toContain("reddit");
  });

  it("does not warn across different sites", () => {
    const b = createBudget({ softCap: 1 });
    b.lookup("reddit", "q1");
    expect(b.lookup("hackernews", "q1").warning).toBeUndefined();
  });

  it("expires cache entries after ttl", () => {
    const b = createBudget({ ttlMs: -1 }); // always expired
    b.store("reddit", "q", "old");
    const res = b.lookup("reddit", "q");
    expect(res.hit).toBe(false);
  });
});

describe("budgetedExec", () => {
  const ok = (stdout: string) => Promise.resolve({ stdout, stderr: "", code: 0 });

  it("re-executes on first call, serves cache on identical repeat", async () => {
    let calls = 0;
    const exec = (_cmd: string, _args: string[]) => {
      calls++;
      return ok("first-run");
    };
    const b = createBudget();
    const wrapped = budgetedExec(exec, b);

    const r1 = await wrapped("opencli", ["reddit", "search", "rust", "-f", "json"]);
    expect(r1.stdout).toBe("first-run");
    const r2 = await wrapped("opencli", ["reddit", "search", "rust", "-f", "json"]);
    expect(r2.stdout).toBe("first-run");
    expect(calls).toBe(1); // cached — no re-exec
  });

  it("annotates stderr with the warning past the cap", async () => {
    const exec = (_cmd: string, _args: string[]) => ok("data");
    const b = createBudget({ softCap: 1 });
    const wrapped = budgetedExec(exec, b);

    await wrapped("opencli", ["reddit", "search", "q1", "-f", "json"]);
    const r2 = await wrapped("opencli", ["reddit", "search", "q2", "-f", "json"]);
    expect(r2.stderr).toContain("soft cap");
  });
});
