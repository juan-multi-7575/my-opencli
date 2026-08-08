/**
 * budget.ts — Budget guard (ADR-0003)
 *
 * Two rules per (site, query) pair, enforced at the exec boundary:
 *  1. Dedupe cache — an identical normalized query on the same site is served
 *     from cache within the TTL; never re-executed.
 *  2. Soft per-site cap — after N distinct queries on a site in one session,
 *     results carry a ⚠ warning so the agent reframes instead of looping.
 *     Soft = warn, never block.
 */

export interface BudgetOptions {
  /** Distinct queries per site before warning (default 6). */
  softCap?: number;
  /** Cache freshness in ms (default 5 min). */
  ttlMs?: number;
}

export const DEFAULT_SOFT_CAP = 6;
export const DEFAULT_TTL_MS = 5 * 60_000;

interface CacheEntry {
  content: string;
  ts: number;
}

function key(site: string, query: string): string {
  return `${site}\u0000${query.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

let _globalCache = new Map<string, CacheEntry>();
let _globalDistinct = new Map<string, Set<string>>();

export type Budget = ReturnType<typeof createBudget>;

export function createBudget(opts: BudgetOptions = {}) {
  const softCap = opts.softCap ?? DEFAULT_SOFT_CAP;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const cache = new Map<string, CacheEntry>();
  const distinct = new Map<string, Set<string>>();

  return {
    lookup(site: string, query: string) { return lookupImpl(site, query, { softCap, ttlMs, cache, distinct }); },
    store(site: string, query: string, content: string) { storeImpl(site, query, content, cache); },
    softCap,
    ttlMs,
    _cache: cache,
    _distinct: distinct,
  };
}

export function getGlobalBudget(): Budget {
  return {
    lookup(site: string, query: string) { return lookupImpl(site, query, { softCap: DEFAULT_SOFT_CAP, ttlMs: DEFAULT_TTL_MS, cache: _globalCache, distinct: _globalDistinct }); },
    store(site: string, query: string, content: string) { storeImpl(site, query, content, _globalCache); },
    softCap: DEFAULT_SOFT_CAP,
    ttlMs: DEFAULT_TTL_MS,
    _cache: _globalCache,
    _distinct: _globalDistinct,
  };
}

/** Test hook: reset the global budget state. */
export function __resetGlobalBudgetForTests(): void {
  _globalCache = new Map();
  _globalDistinct = new Map();
}

function lookupImpl(
  site: string,
  query: string,
  opts: { softCap: number; ttlMs: number; cache: Map<string, CacheEntry>; distinct: Map<string, Set<string>> }
): { hit: boolean; content?: string; warning?: string } {
  const k = key(site, query);
  const entry = opts.cache.get(k);
  if (entry && Date.now() - entry.ts < opts.ttlMs) {
    return { hit: true, content: entry.content };
  }
  const seen = opts.distinct.get(site) ?? new Set<string>();
  const isNew = !seen.has(k);
  seen.add(k);
  opts.distinct.set(site, seen);
  const warning =
    isNew && seen.size > opts.softCap
      ? `⚠️ budget: ${seen.size - opts.softCap} over the soft cap of ${opts.softCap} distinct queries on "${site}" this session — reframe the query or use another site.`
      : undefined;
  return { hit: false, warning };
}

function storeImpl(site: string, query: string, content: string, cache: Map<string, CacheEntry>): void {
  cache.set(key(site, query), { content, ts: Date.now() });
}

/**
 * Run an exec function through the budget guard.
 */
export async function withBudget(
  budget: Budget,
  exec: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>,
  cmd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  const site = args[0] ?? "";
  const query = args[2] ?? "";
  const { hit, content, warning } = budget.lookup(site, query);
  if (hit && content !== undefined) {
    return { stdout: content, stderr: warning ?? "", code: 0 };
  }
  const result = await exec(cmd, args);
  if (result.code === 0) budget.store(site, query, result.stdout);
  if (warning) result.stderr = `${result.stderr}\n${warning}`.trim();
  return result;
}

/** Legacy wrapper kept for compatibility. */
export function budgetedExec(
  exec: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>,
  budget: Budget
) {
  return async (cmd: string, args: string[]) => withBudget(budget, exec, cmd, args);
}
