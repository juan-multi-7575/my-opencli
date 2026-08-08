/**
 * registry.ts — Live opencli registry cache
 *
 * On startup, runs `opencli list -f json` and builds:
 *  - a domain → site map  (enforce.ts curl/wget blocking)
 *  - a site → commands map (router.ts, opencli_list)
 *  - a full command schema index (opencli_help tool, write-command gating)
 */

export interface CommandArg {
  name: string;
  type: string;
  required: boolean;
  positional: boolean;
  help: string;
  default?: unknown;
}

export interface CommandSchema {
  site: string;
  name: string;
  aliases: string[];
  description: string;
  access: string; // "read" | "write"
  args: CommandArg[];
  example?: string;
  browser: boolean; // runs in Chrome via the Browser Bridge (needs a session window)
}

import { ALLOWED_SITES } from "./allowed-sites";

export interface SiteEntry {
  site: string;
  domain: string;
  strategy: string;
  browser: boolean;
  description: string;
}

export interface Registry {
  sites: SiteEntry[];
  domainMap: Map<string, string>;                      // hostname → site name
  siteCommands: Map<string, string[]>;                 // site → command names
  commands: Map<string, Map<string, CommandSchema>>;   // site → name → schema
  lastRefresh: number;
}

let _registry: Registry | null = null;

/**
 * Fetch or return cached opencli registry.
 */
export async function getRegistry(
  exec: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>
): Promise<Registry | null> {
  // Re-use if <1h old
  if (_registry && Date.now() - _registry.lastRefresh < 3600_000) {
    return _registry;
  }

  try {
    const result = await exec("opencli", ["list", "-f", "json"]);
    if (result.code !== 0) return _registry;
    const commands = JSON.parse(result.stdout);
    return buildRegistry(commands);
  } catch {
    return _registry;
  }
}

/**
 * Get the singleton registry without refreshing.
 */
export function getCachedRegistry(): Registry | null {
  return _registry;
}

export function buildRegistry(commands: any[]): Registry {
  // Prune to the agent's allowlist (site-checklist.md) — the agent only sees
  // and can call kept sites. Opencli itself is untouched.
  commands = commands.filter((c) => c && ALLOWED_SITES.has(c.site));
  const sites: SiteEntry[] = [];
  const domainMap = new Map<string, string>();
  const existingDomainLen = new Map<string, number>();
  const siteCommands = new Map<string, string[]>();
  const commandSchemas = new Map<string, Map<string, CommandSchema>>();

  // Deduplicate sites
  const seen = new Set<string>();
  for (const cmd of commands) {
    if (!cmd || !cmd.site) continue;
    if (!seen.has(cmd.site)) {
      seen.add(cmd.site);
      sites.push({
        site: cmd.site,
        domain: cmd.domain ?? "",
        strategy: cmd.strategy ?? "unknown",
        browser: cmd.browser ?? false,
        description: `${cmd.site} site`,
      });
      commandSchemas.set(cmd.site, new Map());
    }
    // Map domains from EVERY command (the first command of a site may have null domain).
    // Resolve conflicts by specificity: site-name match first, then longest domain wins.
    if (cmd.domain) {
      const domain = cmd.domain;
      const existing = domainMap.get(domain);
      const primaryLabel = domain.split(".")[0];
      const siteMatchesLabel = cmd.site.includes(primaryLabel) || primaryLabel.includes(cmd.site);
      if (!existing || siteMatchesLabel || domain.length > (existingDomainLen.get(domain) ?? 0)) {
        domainMap.set(domain, cmd.site);
        existingDomainLen.set(domain, domain.length);
      }
      domainMap.set(`www.${domain}`, domainMap.get(domain)!);
    }
    // Track commands per site + full schemas
    if (cmd.name) {
      const list = siteCommands.get(cmd.site) ?? [];
      if (!list.includes(cmd.name)) list.push(cmd.name);
      siteCommands.set(cmd.site, list);

      const schema: CommandSchema = {
        site: cmd.site,
        name: cmd.name,
        aliases: Array.isArray(cmd.aliases) ? cmd.aliases : [],
        description: cmd.description ?? "",
        access: cmd.access ?? "read",
        browser: cmd.browser ?? false,
        args: Array.isArray(cmd.args)
          ? cmd.args.map((a: any) => ({
              name: a.name ?? "",
              type: a.type ?? "str",
              required: !!a.required,
              positional: !!a.positional,
              help: a.help ?? "",
              default: a.default,
            }))
          : [],
        example: cmd.example,
      };
      const siteMap = commandSchemas.get(cmd.site)!;
      siteMap.set(cmd.name, schema);
      for (const alias of schema.aliases) siteMap.set(alias, schema);
    }
  }

  // Fallback domain map for sites whose registry has no domain field.
  const FALLBACK_DOMAINS: [string, string][] = [
    ["arxiv.org", "arxiv"],
    ["doi.org", "arxiv"],
    ["scholar.google.com", "google-scholar"],
    ["en.wikipedia.org", "wikipedia"],
    ["zh.wikipedia.org", "wikipedia"],
    ["github.com", "github"],
    ["www.arxiv.org", "arxiv"],
  ];
  for (const [domain, site] of FALLBACK_DOMAINS) {
    if (!domainMap.has(domain)) domainMap.set(domain, site);
  }

  _registry = {
    sites,
    domainMap,
    siteCommands,
    commands: commandSchemas,
    lastRefresh: Date.now(),
  };

  return _registry;
}

/**
 * Look up a command schema by site + command name (or alias).
 */
export function getCommandSchema(registry: Registry | null, site: string, name: string): CommandSchema | null {
  if (!registry) return null;
  return registry.commands.get(site)?.get(name) ?? null;
}

/**
 * Match a hostname to an opencli site using the live registry.
 */
export function matchSiteFromHostname(hostname: string, registry: Registry): string | null {
  const h = hostname.toLowerCase().replace(/^www\./, "");
  // Direct match
  if (registry.domainMap.has(h)) return registry.domainMap.get(h)!;
  // Partial match (e.g., "news.ycombinator.com" → check "ycombinator.com")
  for (const [domain, site] of registry.domainMap) {
    if (h.endsWith(`.${domain}`) || h === domain) return site;
  }
  return null;
}

/**
 * Extract all URLs from a bash command string.
 */
export function extractUrls(cmd: string): URL[] {
  const urls: URL[] = [];
  // Match http(s) URLs
  const regex = /https?:\/\/[^\s'"`<>)}\]]+/g;
  let match;
  while ((match = regex.exec(cmd))) {
    try {
      // Clean trailing punctuation
      const cleaned = match[0].replace(/[.,;:!?)\]}>]+$/, "");
      urls.push(new URL(cleaned));
    } catch { /* not a valid URL, skip */ }
  }
  return urls;
}

/**
 * Known static/dev endpoints that should NEVER be blocked.
 */
const SAFE_HOSTS = new Set([
  "localhost", "127.0.0.1", "::1", "0.0.0.0",
  "192.168.", "10.", "172.",
]);

export function isSafeHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  for (const prefix of SAFE_HOSTS) {
    if (prefix.endsWith(".") && h.startsWith(prefix)) return true;
  }
  return false;
}
