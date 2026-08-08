/**
 * tools.ts — Custom tools callable by the LLM
 *
 * opencli_run      — run any opencli command
 * opencli_search   — one-shot search, smart site routing
 * opencli_download — media download from supported sites
 * opencli_research — multi-source research orchestrator
 * opencli_list     — query the live opencli registry
 */

import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Registry } from "./registry";
import { getRegistry, matchSiteFromHostname, getCommandSchema } from "./registry";
import { routeQuery, siteExists } from "./router";
import { buildResearchPlan, executeResearchPlan, type ResearchProfile } from "./research";
import { sessionKeyArgs } from "./capabilities";
import { createBudget, budgetedExec } from "./budget";

// AI-slot fallback chain (ADR-0004): kimi → gemini → grok → chatgpt → deepseek,
// terminal = the profile's own AI site. claude stays reachable via explicit sites.
const AI_FALLBACKS = ["kimi", "gemini", "grok", "chatgpt", "deepseek"];
const ASK_SITES = new Set([...AI_FALLBACKS, "claude", "qwen"]);

// Session-wide budget guard (ADR-0003): dedupe cache + soft per-site cap.
const budget = createBudget();

// Destructive opencli verbs — blocked unless the agent confirms the user asked (ADR-0005).
const DESTRUCTIVE_RE = /^(delete|remove|unfollow|unsubscribe|uncheck|unlike|cancel|clear|revoke|logout|ban|mute|block)(\b|-)/;
// remove-bg is a generator (remove background), not destructive.
const DESTRUCTIVE_EXCEPTIONS = new Set(["remove-bg"]);

const FORMAT_ENUM = StringEnum(["json", "table", "yaml", "md", "csv", "plain"] as const);

interface ExecOptions {
  signal?: AbortSignal;
  timeout?: number;
}

/**
 * Build the truncated content for a tool result.
 */
function truncate(s: string, max = 30_000): string {
  return s.length > max ? s.slice(0, max) + `\n…[truncated ${s.length - max} chars — full output available via -f json locally]` : s;
}

/**
 * Compact one-line-per-result markdown for JSON array output.
 */
function compactMarkdown(stdout: string): string {
  try {
    const data = JSON.parse(stdout);
    if (!Array.isArray(data) || data.length === 0) return stdout;
    const lines = data.slice(0, 20).map((item) => {
      const title = item.title ?? item.name ?? item.headline ?? item.query ?? item.id ?? "";
      const url = item.url ?? item.link ?? item.href ?? "";
      const snippet = (item.snippet ?? item.summary ?? item.description ?? item.text ?? "")
        .toString()
        .replace(/\s+/g, " ")
        .slice(0, 120);
      return `• ${title}${url ? ` (${url})` : ""}${snippet ? ` — ${snippet}` : ""}`;
    });
    if (data.length > 20) lines.push(`… ${data.length - 20} more results`);
    return lines.join("\n");
  } catch {
    return stdout;
  }
}
/**
 * Run an opencli command and return structured output.
 */
// Shell-quote a part containing whitespace or quotes so multi-word queries stay one arg.
export const shellQuote = (p: string) => (/[\s"']/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p);

async function runOpencli(
  pi: ExtensionAPI,
  parts: string[],
  opts: ExecOptions = {}
): Promise<{ ok: boolean; content: string; code: number; stderr: string }> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);

  const cmdStr = ["opencli", ...parts.map(shellQuote)].join(" ");
  try {
    const { stdout, stderr } = (await execAsync(cmdStr, {
      timeout: opts.timeout ?? 60_000,
      maxBuffer: 50 * 1024 * 1024,
    })) as any;
    return {
      ok: true,
      content: truncate(stdout ?? ""),
      code: 0,
      stderr: String(stderr ?? ""),
    };
  } catch (e: any) {
    // execAsync throws on non-zero exit; err.stdout/stderr carry output
    const stdout = e?.stdout ?? "";
    const stderr = e?.stderr ?? String(e?.message ?? e);
    return { ok: false, content: truncate(stdout), code: e?.code ?? 1, stderr: truncate(stderr, 2000) };
  }
}

export function registerOpenCliTools(pi: ExtensionAPI, getRegistryRef: () => Registry | null) {
  // ---------- opencli_run ----------

  pi.registerTool({
    name: "opencli_run",
    label: "OpenCLI Run",
    description:
      "Run any opencli command. Prefer this over curl/wget for any site-specific web task. " +
      "Examples: 'hackernews top --limit 5', 'reddit search \"rust async\"', 'arxiv search \"coding agents\"', " +
      "'bilibili search 教程', 'xiaohongshu search python', 'gemini ask \"<question>\"'. " +
      "Discover sites: opencli_list. Use -f json for structured output.",
    promptSnippet:
      "Run any opencli <site> <command> web operation — prefer this over curl/wget for site-specific tasks",
    promptGuidelines: [
      "Use opencli_run for ALL site-specific web access (search, posts, news, media) — never curl/wget for public web URLs.",
      "Use opencli_run when the user asks about content on a specific site (Reddit, HackerNews, arXiv, Twitter, GitHub, Bilibili, Xiaohongshu, etc.).",
    ],
    parameters: Type.Object({
      command: Type.String({
        description: "Full opencli command args after 'opencli', e.g. 'hackernews top --limit 5' or 'arxiv search \"coding agents\"'",
      }),
      format: Type.Optional(FORMAT_ENUM),
      confirm: Type.Optional(
        Type.Boolean({
          description: "Required to run a destructive command (delete/unfollow/block/...). Set true only when the user explicitly asked for it.",
        })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Cancelled" }], details: { cancelled: true } };
      }

      // Parse the command into parts (respect quotes)
      const parts = parseCommand(params.command);
      if (parts.length === 0) {
        throw new Error("opencli_run: empty command");
      }

      // Destructive-verb guard (ADR-0005): block unless explicitly confirmed.
      const site = parts[0] ?? "";
      const cmd = parts[1] ?? "";
      const schema = getCommandSchema(getRegistryRef()!, site, cmd);
      const isDestructive = schema != null && DESTRUCTIVE_RE.test(cmd) && !DESTRUCTIVE_EXCEPTIONS.has(cmd);
      if (isDestructive && !params.confirm) {
        return {
          content: [
            {
              type: "text",
              text:
                `⛔ "${site}/${cmd}" is destructive — ${schema.description}. It was NOT run. ` +
                `If the user explicitly asked for this, rerun with confirm: true.`,
            },
          ],
          details: { site, command: params.command, blocked: true, destructive: true, ok: false },
        };
      }

      const fmt = params.format ?? "json";
      // Don't double-append a format flag if the command already carries one.
      const hasFormat = parts.some((p) => p === "-f" || p === "--format" || p.startsWith("--format="));
      const result = await runOpencli(pi, hasFormat ? parts : [...parts, "-f", fmt], { signal });

      const output = result.ok
        ? `${schema?.access === "write" ? `⚠ write command — mutates state (${schema.description})\n\n` : ""}${result.content}`
        : `⚠️ opencli command failed (exit ${result.code})\nstderr: ${result.stderr}\n\n` +
          `Command was: opencli ${parts.join(" ")}`;

      return {
        content: [{ type: "text", text: output }],
        details: {
          site,
          command: parts.join(" "),
          exitCode: result.code,
          ok: result.ok,
        },
      };
    },
  });

  // ---------- opencli_search ----------

  pi.registerTool({
    name: "opencli_search",
    label: "OpenCLI Search",
    description:
      "One-shot web search via OpenCLI. Automatically picks the best site (HackerNews, Reddit, arXiv, DuckDuckGo, etc.) based on query keywords. " +
      "Pass an explicit site to target a specific platform.",
    promptSnippet:
      "Search the web via OpenCLI with smart site routing (search / latest / top across supported sites)",
    promptGuidelines: [
      "Use opencli_search for quick single-site web searches (news, docs, code, products, discussions).",
      "Use opencli_search before opencli_research when the user just wants a quick answer or list.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      site: Type.Optional(Type.String({ description: "Optional site override, e.g. 'reddit', 'hackernews', 'arxiv', 'duckduckgo'" })),
      limit: Type.Optional(Type.Integer({ description: "Max results (default 10)", minimum: 1, maximum: 25 })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Cancelled" }], details: { cancelled: true } };
      }

      const registry = getRegistryRef();
      const route = routeQuery(params.query, params.site);

      if (!siteExists(route.site, registry)) {
        // Fall back to a general search engine
        return {
          content: [{ type: "text", text: `Site "${route.site}" not found in opencli registry. Try a general query or check opencli_list.` }],
          details: { site: route.site, ok: false },
        };
      }

      const limit = params.limit ?? 10;

      // Budget guard: identical (site, query) repeats are served from cache.
      const { hit, content: cached, warning } = budget.lookup(route.site, params.query);
      if (hit && cached !== undefined) {
        const cachedOutput = `[${route.site}/${route.command}] (cached)\n${compactMarkdown(cached)}`;
        return {
          content: [{ type: "text", text: truncate(cachedOutput, 30_000) }],
          details: { site: route.site, command: route.command, query: params.query, cached: true, ok: true },
        };
      }

      const searchParts = [route.site, route.command, params.query, "--limit", String(limit)];
      if (getCommandSchema(getRegistryRef()!, route.site, route.command)?.browser) searchParts.push(...sessionKeyArgs());
      const result = await runOpencli(pi, [...searchParts, "-f", "json"], { signal });
      if (result.ok) budget.store(route.site, params.query, result.content);

      const output = result.ok
        ? `[${route.site}/${route.command}]\n${compactMarkdown(result.content)}`
        : `⚠️ ${route.site} search failed (exit ${result.code})\nstderr: ${result.stderr}\n\nTry opencli_list to find an alternative site.`;

      const budgetNote = warning ? `\n\n${warning}` : "";

      return {
        content: [{ type: "text", text: truncate(output + budgetNote, 30_000) }],
        details: {
          site: route.site,
          command: route.command,
          query: params.query,
          routeReason: route.reason,
          exitCode: result.code,
          ok: result.ok,
        },
      };
    },
  });

  // ---------- opencli_download ----------

  pi.registerTool({
    name: "opencli_download",
    label: "OpenCLI Download",
    description:
      "Download images, videos, audio, or documents from a supported site URL. " +
      "Auto-detects the site from the URL domain. Saves to ~/Downloads by default.",
    promptSnippet:
      "Download media (images, video, audio) from supported sites (Twitter, Instagram, Bilibili, Xiaohongshu, etc.)",
    promptGuidelines: [
      "Use opencli_download when the user wants to download images, videos, or other media from a site URL.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "Full URL of the media to download" }),
      site: Type.Optional(Type.String({ description: "Optional site override if auto-detection fails" })),
      output: Type.Optional(Type.String({ description: "Output directory (default: ~/Downloads)" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Cancelled" }], details: { cancelled: true } };
      }

      const registry = getRegistryRef();
      let site: string | undefined = params.site;

      if (!site) {
        // Auto-detect from URL
        try {
          const url = new URL(params.url);
          site = matchSiteFromHostname(url.hostname, registry!) ?? undefined;
        } catch {
          site = undefined;
        }
      }

      if (!site || !siteExists(site, registry)) {
        return {
          content: [{ type: "text", text: `Cannot determine a supported opencli site for: ${params.url}. Try opencli_list to see supported sites.` }],
          details: { url: params.url, ok: false },
        };
      }

      const outDir = params.output ?? "~/Downloads";
      const dlParts = [site, "download", params.url, "--output", outDir];
      if (getCommandSchema(getRegistryRef()!, site, "download")?.browser) dlParts.push(...sessionKeyArgs());
      const result = await runOpencli(pi, [...dlParts, "-f", "json"], { signal });

      const output = result.ok
        ? `✅ Downloaded via ${site}:\n${result.content}`
        : `⚠️ ${site} download failed (exit ${result.code})\nstderr: ${result.stderr}`;

      return {
        content: [{ type: "text", text: truncate(output, 10_000) }],
        details: { site, url: params.url, output: outDir, exitCode: result.code, ok: result.ok },
      };
    },
  });

  // ---------- opencli_research ----------

  pi.registerTool({
    name: "opencli_research",
    label: "OpenCLI Research",
    description:
      "Deep multi-source research on a topic via OpenCLI. Uses 1 AI-chat site for synthesis + up to 2 specialized sources. " +
      "Profiles: default (AI+HN+web), pi-extension (AI+aibase+HN), pi-agent (AI+reddit+medium), " +
      "coding-agent (AI+stackoverflow+HN), tech-news (AI+aibase+bloomberg). " +
      "Use for 'what is', 'how to', 'compare', 'best practices', 'explain', or any doubt-clarification that needs web knowledge.",
    promptSnippet:
      "Deep multi-source research: AI-chat synthesis + specialized web sources, with call budgets",
    promptGuidelines: [
      "Use opencli_research when the user asks a research question, wants doubt clarification, or needs knowledge synthesis from multiple sources.",
      "Use opencli_research profile 'pi-extension' when the question is about pi extensions, skills, or the pi coding agent ecosystem.",
    ],
    parameters: Type.Object({
      topic: Type.String({ description: "Research topic or question" }),
      profile: Type.Optional(
        StringEnum(["default", "pi-extension", "pi-agent", "coding-agent", "tech-news", "deep-research"] as const)
      ),
      sites: Type.Optional(
        Type.Array(Type.String({ description: "Explicit site list to research (overrides profile)" }))
      ),
      depth: Type.Optional(Type.Integer({ description: "Research depth 1-3 (default 2)", minimum: 1, maximum: 3 })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Cancelled" }], details: { cancelled: true } };
      }

      const registry = getRegistryRef();
      const profile: ResearchProfile = params.profile ?? "default";
      const depth = params.depth ?? 2;

      // Build the plan EXACTLY once. Explicit sites win; otherwise profile+depth.
      let plan;
      if (params.sites && params.sites.length > 0) {
        plan = params.sites.map((s) => {
          const command = ASK_SITES.has(s) ? "ask" : s === "web" ? "read" : "search";
          return {
            site: s,
            command,
            args: [params.topic],
            kind: ASK_SITES.has(s) ? ("ai" as const) : ("specialized" as const),
            browser: getCommandSchema(registry, s, command)?.browser ?? false,
          };
        });
      } else {
        plan = buildResearchPlan(params.topic, profile, registry, AI_FALLBACKS, depth);
      }

      const result = await executeResearchPlan(plan, params.topic, budgetedExec(runExecHelper, budget), signal, profile);

      const lines = [
        `# Research: ${params.topic}`,
        `Profile: ${profile} | Depth: ${depth}`,
        "",
        ...result.calls.map((c) => `- ${c.site}/${c.command}: ${c.status}${c.error ? ` (${c.error})` : ""}`),
        "",
        result.summary || "(no results collected)",
      ];

      return {
        content: [{ type: "text", text: truncate(lines.join("\n"), 40_000) }],
        details: {
          topic: params.topic,
          profile,
          calls: result.calls,
          ok: result.calls.some((c) => c.status === "ok"),
        },
      };
    },
  });

  // ---------- opencli_list ----------

  pi.registerTool({
    name: "opencli_list",
    label: "OpenCLI List",
    description:
      "List all opencli-supported sites and their commands. " +
      "Use to discover what's available before running opencli_run. " +
      "Optional site filter narrows to one platform.",
    promptSnippet:
      "List supported opencli sites/commands (discovery)",
    promptGuidelines: [
      "Use opencli_list to discover which sites opencli supports and what commands each has.",
    ],
    parameters: Type.Object({
      site: Type.Optional(Type.String({ description: "Filter by site name, e.g. 'reddit', 'bilibili'" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const registry = getRegistryRef();
      if (!registry) {
        return {
          content: [{ type: "text", text: "Registry unavailable — run `opencli list -f json` manually." }],
          details: { ok: false },
        };
      }

      if (params.site) {
        const cmds = registry.siteCommands.get(params.site);
        if (!cmds) {
          return {
            content: [{ type: "text", text: `Site "${params.site}" not in registry.` }],
            details: { ok: false, site: params.site },
          };
        }
        return {
          content: [{ type: "text", text: `${params.site} commands:\n${cmds.join(", ")}` }],
          details: { ok: true, site: params.site, commands: cmds },
        };
      }

      const siteList = registry.sites.map((s) => s.site).join(", ");
      return {
        content: [{ type: "text", text: `OpenCLI supports ${registry.sites.length} sites:\n${siteList}` }],
        details: { ok: true, siteCount: registry.sites.length, sites: registry.sites.map((s) => s.site) },
      };
    },
  });

  // ---------- opencli_help ----------

  pi.registerTool({
    name: "opencli_help",
    label: "OpenCLI Help",
    description:
      "Get the schema for an opencli command: arguments, access level (read/write), and an example. " +
      "Use before running any opencli command you are unsure about. Omit command to list a site's commands.",
    promptSnippet:
      "Look up opencli command schemas (args, access level, examples)",
    promptGuidelines: [
      "Use opencli_help to check command arguments and whether a command writes or destroys data before running it.",
    ],
    parameters: Type.Object({
      site: Type.String({ description: "Site name, e.g. 'reddit'" }),
      command: Type.Optional(Type.String({ description: "Command name, e.g. 'search'. Omit to list all commands for the site." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const registry = getRegistryRef();
      if (!registry) {
        return {
          content: [{ type: "text", text: "Registry unavailable — run `opencli list -f json` manually." }],
          details: { ok: false },
        };
      }

      if (!params.command) {
        const cmds = registry.siteCommands.get(params.site);
        return {
          content: [
            {
              type: "text",
              text: cmds
                ? `${params.site} commands: ${cmds.join(", ")}`
                : `Site not found: ${params.site}`,
            },
          ],
          details: { ok: !!cmds, site: params.site },
        };
      }

      const schema = getCommandSchema(registry, params.site, params.command);
      if (!schema) {
        return {
          content: [
            { type: "text", text: `No command "${params.command}" for site "${params.site}". Try opencli_list.` },
          ],
          details: { ok: false, site: params.site, command: params.command },
        };
      }

      const argLines = schema.args
        .map(
          (a) =>
            `${a.required ? "req" : "opt"} ${a.name} (${a.type})${a.positional ? " [positional]" : ""} — ${a.help}`
        )
        .join("\n");
      const text = [
        `${schema.site}/${schema.name} — ${schema.description}`,
        `access: ${schema.access}${schema.access === "write" ? " ⚠ mutates state" : ""}`,
        schema.example ? `example: ${schema.example}` : "",
        schema.args.length ? `args:\n${argLines}` : "args: none",
      ]
        .filter(Boolean)
        .join("\n");

      return { content: [{ type: "text", text }], details: { ok: true, site: params.site, command: params.command } };
    },
  });
}

/**
 * Parse a command string into parts, respecting quoted arguments.
 */
function parseCommand(input: string): string[] {
  const parts: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(input))) {
    parts.push(m[1] ?? m[2] ?? m[3]);
  }
  return parts;
}

/**
 * exec helper for research.ts — runs opencli via pi.exec.
 */
async function runExecHelper(
  cmd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  const { exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);
  const cmdStr = [cmd, ...args.map(shellQuote)].join(" ");
  try {
    const { stdout, stderr } = (await execAsync(cmdStr, {
      timeout: 90_000,
      maxBuffer: 50 * 1024 * 1024,
    })) as any;
    return { stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code: 0 };
  } catch (e: any) {
    return {
      stdout: String(e?.stdout ?? ""),
      stderr: String(e?.stderr ?? e?.message ?? ""),
      code: e?.code ?? 1,
    };
  }
}
