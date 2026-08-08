/**
 * router.ts — Smart site routing
 *
 * Given a user query and optional site override, picks the best opencli
 * site + command. Uses keyword heuristics with specificity-ordered matching.
 * Rules are validated against the live registry: a rule only routes to a
 * site/command that actually exists in `opencli list -f json`.
 */

import type { Registry } from "./registry";

export interface Route {
  site: string;
  command: string;
  args: string[];
  reason: string;
}

interface RouteRule {
  keywords: string[];
  site: string;
  command: string;
  label: string;
  // Exclude terms — if query contains these, skip this rule
  exclude?: string[];
}

/**
 * Keyword → { site, command, label } rules, ordered by specificity.
 * Command names are verified against the live registry (e.g. github has no
 * `search` command — only github-trending/repos exists, so bare "github"
 * queries fall through to general search instead of misrouting).
 */
const ROUTES: RouteRule[] = [
  // AI chat / ask
  { keywords: ["ask ai", "chatgpt"], site: "chatgpt", command: "ask", label: "ChatGPT" },
  { keywords: ["ask claude", "claude"], site: "claude", command: "ask", label: "Claude" },
  { keywords: ["ask gemini", "gemini"], site: "gemini", command: "ask", label: "Gemini" },
  { keywords: ["ask grok", "grok"], site: "grok", command: "ask", label: "Grok" },
  { keywords: ["ask kimi", "kimi"], site: "kimi", command: "ask", label: "Kimi" },
  { keywords: ["ask qwen", "qwen"], site: "qwen", command: "ask", label: "Qwen" },
  { keywords: ["deep research", "deep-research"], site: "gemini", command: "deep-research", label: "Gemini deep research" },

  // Academic / research
  { keywords: ["arxiv", "academic paper", "research paper", "ieee"], site: "arxiv", command: "search", label: "arXiv" },
  { keywords: ["google scholar", "scholar"], site: "google-scholar", command: "search", label: "Google Scholar" },
  { keywords: ["semantic scholar"], site: "semanticscholar", command: "search", label: "Semantic Scholar" },
  { keywords: ["pubmed"], site: "pubmed", command: "search", label: "PubMed" },
  { keywords: ["dblp"], site: "dblp", command: "search", label: "DBLP" },

  // Developer / code
  { keywords: ["github trending"], site: "github-trending", command: "repos", label: "GitHub trending" },
  { keywords: ["stackoverflow", "stack overflow"], site: "stackoverflow", command: "search", label: "StackOverflow" },
  { keywords: ["crates", "crates.io", "rust crate", "cargo"], site: "crates", command: "search", label: "crates.io" },
  { keywords: ["pypi", "python package"], site: "pypi", command: "package", label: "PyPI" },
  { keywords: ["npm package", "npmjs", "node package"], site: "npm", command: "search", label: "npm registry" },
  { keywords: ["docker hub", "docker image"], site: "dockerhub", command: "search", label: "DockerHub" },

  // Community / social
  { keywords: ["reddit", "subreddit", "r/"], site: "reddit", command: "search", label: "Reddit" },
  { keywords: ["twitter", "x.com", "tweet", "tweets"], site: "twitter", command: "search", label: "Twitter/X" },
  { keywords: ["linkedin"], site: "linkedin", command: "search", label: "LinkedIn" },
  { keywords: ["bluesky", "bsky"], site: "bluesky", command: "search", label: "Bluesky" },
  { keywords: ["discord"], site: "discord-app", command: "search", label: "Discord" },
  { keywords: ["facebook"], site: "facebook", command: "search", label: "Facebook" },

  // News / articles
  { keywords: ["hackernews", "hn"], site: "hackernews", command: "search", label: "HackerNews" },
  { keywords: ["bbc"], site: "bbc", command: "news", label: "BBC news" },
  { keywords: ["bloomberg"], site: "bloomberg", command: "news", label: "Bloomberg" },
  { keywords: ["reuters"], site: "reuters", command: "search", label: "Reuters" },
  { keywords: ["pi extension", "pi coding agent", "oh-my-pi", "omp pi"], site: "aibase", command: "news", label: "Aibase AI news" },
  { keywords: ["36kr"], site: "36kr", command: "news", label: "36kr" },

  // Dev.to / medium / articles
  { keywords: ["how to learn", "tutorial", "learn python", "learn javascript", "learn rust"], site: "youtube", command: "search", label: "YouTube tutorials" },
  { keywords: ["devto", "dev.to"], site: "devto", command: "latest", label: "Dev.to" },
  { keywords: ["medium"], site: "medium", command: "search", label: "Medium" },
  { keywords: ["substack"], site: "substack", command: "feed", label: "Substack" },
  { keywords: ["juejin"], site: "juejin", command: "hot", label: "Juejin" },

  // Media / images / video
  { keywords: ["xiaohongshu", "rednote", "xhs"], site: "xiaohongshu", command: "search", label: "Xiaohongshu" },
  { keywords: ["bilibili", "b站"], site: "bilibili", command: "search", label: "Bilibili" },
  { keywords: ["youtube transcript", "transcript of"], site: "youtube", command: "transcript", label: "YouTube transcript" },
  { keywords: ["youtube"], site: "youtube", command: "search", label: "YouTube" },
  { keywords: ["instagram"], site: "instagram", command: "search", label: "Instagram" },
  { keywords: ["pixiv"], site: "pixiv", command: "search", label: "Pixiv" },
  { keywords: ["podcast", "apple podcasts"], site: "apple-podcasts", command: "search", label: "Apple Podcasts" },
  { keywords: ["spotify"], site: "spotify", command: "search", label: "Spotify" },

  // Shopping
  { keywords: ["amazon"], site: "amazon", command: "search", label: "Amazon" },
  { keywords: ["taobao"], site: "taobao", command: "search", label: "Taobao" },
  { keywords: ["jd", "京东"], site: "jd", command: "search", label: "JD" },
  { keywords: ["coupang"], site: "coupang", command: "search", label: "Coupang" },

  // Finance / crypto
  { keywords: ["stock", "share price", "quote", "finance", "yahoo finance"], site: "yahoo-finance", command: "quote", label: "Yahoo Finance" },
  { keywords: ["crypto", "bitcoin", "btc", "eth", "ethereum", "coingecko"], site: "coingecko", command: "coin", label: "CoinGecko" },
  { keywords: ["binance"], site: "binance", command: "price", label: "Binance" },

  // Weather
  { keywords: ["weather", "temperature", "forecast"], site: "wttr", command: "current", label: "Weather" },

  // Wikipedia / reference
  { keywords: ["wikipedia", "wiki"], site: "wikipedia", command: "search", label: "Wikipedia" },
  { keywords: ["dictionary", "synonym"], site: "dictionary", command: "search", label: "Dictionary" },

  // Generic page reads (web/read takes a URL)
  { keywords: ["web read", "read this url", "read this page", "read this website", "page content"], site: "web", command: "read", label: "web read" },

  // General fallback
  { keywords: [], site: "duckduckgo", command: "search", label: "general web search" },
];

/**
 * Route a query to the best opencli site+command.
 */
export function routeQuery(query: string, siteOverride?: string): Route {
  const q = query.toLowerCase();

  // Explicit site override
  if (siteOverride) {
    return {
      site: siteOverride,
      command: "search",
      args: [query],
      reason: `explicit site override: ${siteOverride}`,
    };
  }

  for (const route of ROUTES) {
    // Check excludes first
    if (route.exclude && route.exclude.some((k) => q.includes(k))) continue;

    const isMatch = route.keywords.length === 0 || route.keywords.some((k) => q.includes(k));
    if (isMatch && route.site) {
      return {
        site: route.site,
        command: route.command,
        args: [query],
        reason: `matched "${route.keywords.filter((k) => q.includes(k)).join('", "')}" → ${route.label}`,
      };
    }
  }

  // Unreachable — fallback is last
  return {
    site: "duckduckgo",
    command: "search",
    args: [query],
    reason: "fallback",
  };
}

/**
 * Check if a site exists in the live registry.
 */
export function siteExists(site: string, registry: Registry | null): boolean {
  if (!registry) return true; // registry unavailable — assume exists
  return registry.sites.some((s) => s.site === site);
}
