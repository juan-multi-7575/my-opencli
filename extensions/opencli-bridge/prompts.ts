/**
 * prompts.ts — System prompt fragments injected into the agent context.
 *
 * The static blob is replaced by a builder: the agent gets the bridge rules
 * plus a LIVE curated site index (verified against the registry) and the
 * browser-bridge connectivity signal — so it flies with the map, not blind.
 */

import type { Registry } from "./registry";

export interface ConnectivityInfo {
  daemon: boolean;
  browserBridge: boolean;
}

/**
 * Curated top ~30 sites with verified command hints (checked against
 * `opencli list -f json`, e.g. pypi has no `search` — only `package`).
 */
const CURATED_SITES: Array<[site: string, hint: string]> = [
  ["duckduckgo", "search — general web search (no auth)"],
  ["web", "read — fetch any URL, browser-driven"],
  ["hackernews", "search | top | new | show — tech news"],
  ["reddit", "search | hot | popular — communities"],
  ["arxiv", "search | recent | paper — academic papers"],
  ["wikipedia", "search | summary | trending"],
  ["stackoverflow", "search | hot | tag — code Q&A"],
  ["github-trending", "repos — trending GitHub repos"],
  ["crates", "search — Rust crates"],
  ["pypi", "package — Python packages"],
  ["npm", "search | package — Node packages"],
  ["dockerhub", "search | image — container images"],
  ["youtube", "search | transcript | video"],
  ["bilibili", "search | hot | ranking — CN video"],
  ["xiaohongshu", "search | feed — CN lifestyle"],
  ["twitter", "search | article | download"],
  ["instagram", "search | explore | post | download"],
  ["spotify", "search | play"],
  ["apple-podcasts", "search | top"],
  ["google", "search | news | trends"],
  ["yahoo-finance", "quote — stock prices"],
  ["coingecko", "coin | trending — crypto"],
  ["wttr", "current | forecast — weather"],
  ["gemini", "ask | deep-research — Google AI"],
  ["kimi", "ask — Moonshot AI"],
  ["chatgpt", "ask — OpenAI"],
  ["grok", "ask — xAI"],
  ["claude", "ask — Anthropic"],
  ["google-scholar", "search | profile — academic"],
  ["devto", "latest | top — dev articles"],
];

export function buildSystemPrompt(
  registry: Registry | null,
  connectivity: ConnectivityInfo | null
): string {
  const siteCount = registry?.sites.length ?? "?";
  const conn = connectivity
    ? connectivity.browserBridge
      ? "browser bridge: ✓ connected — browser/cookie-authenticated sites work"
      : "browser bridge: ✗ NOT connected — browser/cookie-authenticated sites will fail; prefer api-strategy sites"
    : "browser bridge: unknown";

  const curated = CURATED_SITES.map(([site, hint]) => `  - ${site}: ${hint}`).join("\n");

  return `
[OpenCLI Bridge]

You have a strict, always-available bridge to the OpenCLI agent toolkit for web access.
OpenCLI wraps ${siteCount}+ sites into uniform \`opencli <site> <command>\` calls that handle
auth, cookies, parsing, and DOM interaction automatically.

=== RULES ===
1. NEVER use curl, wget, requests, or node fetch for public web URLs.
2. NEVER use curl, wget, requests, or node fetch against any site that OpenCLI supports.
3. ALWAYS prefer the opencli tools (opencli_run, opencli_search, opencli_research,
   opencli_download) over built-in bash for ANY web task.
4. If a site is NOT in the opencli registry, use opencli_run { command: "web read --url <url>" }.

=== CONNECTIVITY ===
${conn}

=== CURATED SITES (verified) ===
${curated}

The FULL list (${siteCount} sites, 1200+ commands) is available via opencli_list.
Use opencli_help { site, command } for args/access/examples before running anything unfamiliar.

=== TOOL SELECTION ===
- opencli_run       — Run any opencli command (e.g., "hackernews top --limit 10").
- opencli_search    — One-shot search; the bridge picks the best site from keywords.
- opencli_research  — Multi-source research: AI synthesis + up to 2 specialized sources.
- opencli_download  — Download media (images, videos) from supported sites.
- opencli_list      — Discover sites/commands.
- opencli_help      — Command schema: args, access (read/write), example.

=== RESEARCH MODE ===
For "what is", "how to", "compare", "explain", "best practices", "how does X work":
→ Use opencli_research with the appropriate profile.
Profiles: default, pi-extension, pi-agent, coding-agent, tech-news.

=== BUDGET RULES (enforced) ===
- opencli_research: 1 AI-chat site + up to 2 specialized sites per call.
- opencli_search: 1 site per call.
- Identical (site, query) repeats are served from cache — never re-executed.
- After 6 distinct queries on one site per session, results carry a ⚠ budget note:
  reframe the query or use another site instead of rephrasing in a loop.
- NEVER loop the same search site more than 2 times for the same topic.
`;
}

export const OPENCLI_INTENT_INJECTION =
  "[OpenCLI Bridge] The user's request requires web access. " +
  "MUST use OpenCLI tools — never curl/wget for public web content.";
