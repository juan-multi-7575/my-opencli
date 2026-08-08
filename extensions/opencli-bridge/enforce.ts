/**
 * enforce.ts — STRICT tool_call interception
 *
 * Blocks bash commands that try to curl/wget/requests/fetch public web URLs
 * when the target site is supported by OpenCLI. Keeps localhost/dev traffic free.
 */

import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Registry } from "./registry";
import { extractUrls, isSafeHost, matchSiteFromHostname } from "./registry";

// Web-scrape patterns in bash commands
const SCRAPE_PATTERNS = [
  /\bcurl\b/,
  /\bwget\b/,
  /requests\.(get|post|head)/,
  /\bfetch\s*\(/,
  /python.*requests/,
  /node.*(axios|node-fetch|got|undici)/,
];

// Local host check — never block dev traffic
function isLocalOrDev(hostname: string): boolean {
  return isSafeHost(hostname);
}

export function registerEnforcement(
  pi: ExtensionAPI,
  getRegistryRef: () => Registry | null,
  isEnabled: () => boolean
) {
  pi.on("tool_call", async (event, _ctx) => {
    if (!isEnabled()) return;

    // Documented escape hatch (ADR-0001): set OPENCLI_BYPASS=1 to let a
    // command through untouched. The message below promises it — it must exist.
    if (process.env.OPENCLI_BYPASS === "1") return;

    if (!isToolCallEventType("bash", event)) return;

    const command: string = event.input.command ?? "";
    if (!command.trim()) return;

    // Only interested in commands that scrape the web
    const isScrape = SCRAPE_PATTERNS.some((p) => p.test(command));
    if (!isScrape) return;

    const urls = extractUrls(command);
    if (urls.length === 0) return;

    // Check each URL: if it maps to an opencli site → block with redirect
    for (const url of urls) {
      if (isLocalOrDev(url.hostname)) continue; // never block localhost/dev

      const registry = getRegistryRef();
      const site = registry ? matchSiteFromHostname(url.hostname, registry) : null;

      if (site) {
        return {
          block: true,
          reason:
            `⛔ OpenCLI Bridge: "${url.hostname}" is an OpenCLI-supported site. ` +
            `Do NOT scrape it with ${command.split(/\s+/)[0]}. ` +
            `Use the opencli_run tool instead, e.g.: opencli_run { command: "${site} <operation> <args>" } ` +
            `or opencli_search { query: "<topic>", site: "${site}" }. ` +
            `OpenCLI handles auth, cookies, rate-limiting, and parsing automatically.`,
        };
      }
    }

    // URL exists but site unknown → still strict, but honest: the bypass
    // env var (checked above) is the way out, and it applies to any public URL.
    const first = urls[0];
    if (!isLocalOrDev(first.hostname)) {
      return {
        block: true,
        reason:
          `⛔ OpenCLI Bridge: prefer OpenCLI over raw web scraping. ` +
          `For ${first.hostname}, use opencli_run { command: "web read --url ${first.href}" } ` +
          `or opencli_run { command: "browser <session> open --url ${first.href}" } for ad-hoc browser automation ` +
          `(requires the Browser Bridge extension — check "/oc doctor"). ` +
          `If you genuinely need curl/wget for this URL, rerun with OPENCLI_BYPASS=1 in the environment.`,
      };
    }
  });
}
