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

const cache = new Map<string, CacheEntry>();
const distinct = new Map<string, Set<string>>();

/** Module-level singleton so every exec path shares the same budget state. */
export function createBudget(opts: BudgetOptions = {}) {
  const softCap = opts.softCap ?? DEFAULT_SOFT_CAP;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  return { lookup, store, _cache: cache, _distinct: distinct, softCap, ttlMs };
}

export type Budget = ReturnType<typeof createBudget>;

function lookup(
  site: string,
  query: string,
  opts: { softCap: number; ttlMs: number }
): { hit: boolean; content?: string; warning?: string } {
  const k = key(site, query);
  const entry = cache.get(k);
  if (entry && Date.now() - entry.ts < opts.ttlMs) {
    return { hit: true, content: entry.content };
  }
  const seen = distinct.get(site) ?? new Set<string>();
  const isNew = !seen.has(k);
  seen.add(k);
  distinct.set(site, seen);
  const warning =
    isNew && seen.size > opts.softCap
      ? `⚠️ budget: ${seen.size - opts.softCap} over the soft cap of ${opts.softCap} distinct queries on "${site}" this session — reframe the query or use another site.`
      : undefined;
  return { hit: false, warning };
}

function store(site: string, query: string, content: string): void {
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
  const { hit, content, warning } = lookup(site, query, { softCap: budget.softCap, ttlMs: budget.ttlMs });
  if (hit && content !== undefined) {
    return { stdout: content, stderr: warning ?? "", code: 0 };
  }
  const result = await exec(cmd, args);
  if (result.code === 0) store(site, query, result.stdout);
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
