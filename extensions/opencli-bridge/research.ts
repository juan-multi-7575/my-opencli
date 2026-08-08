/**
 * research.ts — Multi-source research engine
 *
 * Orchestrates OpenCLI research across AI-chat synthesis + specialized sources.
 * Enforces strict budgets: 1 AI site (1 call max), up to 2 non-AI sites.
 */

import type { Registry } from "./registry";
import { getCommandSchema } from "./registry";
import { routeQuery, siteExists } from "./router";
import { sessionKeyArgs } from "./capabilities";

export type ResearchProfile = "default" | "pi-extension" | "pi-agent" | "coding-agent" | "tech-news" | "deep-research";

interface ResearchStep {
  site: string;
  command: string;
  args: string[];
  kind: "ai" | "specialized";
  browser?: boolean; // runs in Chrome; gets a --session-key so the window is reused
}

const PROFILES: Record<ResearchProfile, ResearchStep[]> = {
  default: [
    { site: "grok", command: "ask", args: [], kind: "ai" },
    { site: "hackernews", command: "search", args: [], kind: "specialized" },
    { site: "duckduckgo", command: "search", args: [], kind: "specialized" },
  ],
  "pi-extension": [
    { site: "gemini", command: "ask", args: [], kind: "ai" },
    { site: "aibase", command: "news", args: [], kind: "specialized" },
    { site: "hackernews", command: "search", args: [], kind: "specialized" },
  ],
  "pi-agent": [
    { site: "grok", command: "ask", args: [], kind: "ai" },
    { site: "reddit", command: "search", args: [], kind: "specialized" },
    { site: "medium", command: "search", args: [], kind: "specialized" },
  ],
  "coding-agent": [
    { site: "grok", command: "ask", args: [], kind: "ai" },
    { site: "stackoverflow", command: "search", args: [], kind: "specialized" },
    { site: "hackernews", command: "search", args: [], kind: "specialized" },
  ],
  "tech-news": [
    { site: "grok", command: "ask", args: [], kind: "ai" },
    { site: "aibase", command: "news", args: [], kind: "specialized" },
    { site: "bloomberg", command: "tech", args: [], kind: "specialized" },
  ],
  "deep-research": [
    // gemini's deep-research agent does the synthesis; no chain override (ADR-0004)
    { site: "gemini", command: "deep-research", args: [], kind: "ai" },
    { site: "arxiv", command: "search", args: [], kind: "specialized" },
    { site: "hackernews", command: "search", args: [], kind: "specialized" },
  ],
};

export interface ResearchCall {
  site: string;
  command: string;
  query: string;
  status: "ok" | "error" | "skipped";
  error?: string;
}

export interface ResearchResult {
  topic: string;
  profile: ResearchProfile;
  calls: ResearchCall[];
  summary: string;
}

/**
 * Build a research plan for a topic, validating sites against the live registry.
 * Falls back to a reachable AI site if the preferred one is not in the registry.
 */
export function buildResearchPlan(
  topic: string,
  profile: ResearchProfile,
  registry: Registry | null,
  aiFallbacks: string[],
  depth = 2
): ResearchStep[] {
  const base = PROFILES[profile] ?? PROFILES.default;

  // AI step: deep-research pins its own site (gemini) — no chain override.
  // Otherwise try the fallback chain (chatgpt→gemini→qwen→deepseek→grok→kimi) against
  // the registry; terminal fallback = the profile's own AI site (ADR-0004).
  const aiStep = base.find((s) => s.kind === "ai");
  const aiSite = aiStep
    ? aiStep.command === "deep-research"
      ? siteExists(aiStep.site, registry)
        ? aiStep.site
        : undefined
      : aiFallbacks.find((s) => siteExists(s, registry)) ?? aiStep.site
    : undefined;

  const steps: ResearchStep[] = [];
  if (aiStep && aiSite) {
    // args are filled at execution time (the ask prompt embeds the topic)
    steps.push({
      ...aiStep,
      site: aiSite,
      args: [],
      browser: getCommandSchema(registry, aiSite, aiStep.command)?.browser ?? false,
    });
  }

  // Specialized steps: keep at most depth, validating against registry
  let specializedCount = 0;
  for (const step of base) {
    if (step.kind !== "specialized") continue;
    if (specializedCount >= Math.max(1, Math.min(depth, 3))) break;
    if (!siteExists(step.site, registry)) continue;
    steps.push({
      ...step,
      args: [topic],
      browser: getCommandSchema(registry, step.site, step.command)?.browser ?? false,
    });
    specializedCount++;
  }

  return steps;
}

/**
 * Execute a research plan, collecting per-call results.
 */
export async function executeResearchPlan(
  plan: ResearchStep[],
  topic: string,
  exec: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>,
  signal?: AbortSignal,
  profile: ResearchProfile = "default"
): Promise<ResearchResult> {
  const calls: ResearchCall[] = [];
  const snippets: string[] = [];

  for (const step of plan) {
    if (signal?.aborted) {
      calls.push({ site: step.site, command: step.command, query: topic, status: "skipped", error: "aborted" });
      break;
    }

    const args = [...step.args];
    if (step.command === "ask" || step.command === "deep-research") {
      // AI synthesis: build a research prompt from the topic
      args[0] = `Research: "${topic}". Provide a concise, accurate answer with sources.`;
    }

    try {
      const result = await exec("opencli", [
        step.site,
        step.command,
        ...args,
        ...(step.browser ? sessionKeyArgs() : []),
        "-f",
        "json",
      ]);

      if (result.code !== 0) {
        calls.push({ site: step.site, command: step.command, query: topic, status: "error", error: result.stderr?.slice(0, 200) });
        continue;
      }

      const parsed = safeJsonParse(result.stdout);
      const text = formatOutput(parsed, result.stdout);
      snippets.push(`## ${step.site}/${step.command}\n${truncate(text, 2000)}`);
      calls.push({ site: step.site, command: step.command, query: topic, status: "ok" });
    } catch (e: any) {
      calls.push({ site: step.site, command: step.command, query: topic, status: "error", error: String(e?.message ?? e).slice(0, 200) });
    }
  }

  return {
    topic,
    profile,
    calls,
    summary: snippets.join("\n\n"),
  };
}

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function formatOutput(parsed: any | null, raw: string): string {
  if (!parsed) return truncate(raw, 3000);
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => {
        if (item.response) return item.response;
        if (item.title) return `• ${item.title}${item.url ? ` (${item.url})` : ""}`;
        return JSON.stringify(item).slice(0, 300);
      })
      .join("\n");
  }
  if (parsed.response) return parsed.response;
  if (parsed.content) return typeof parsed.content === "string" ? parsed.content : JSON.stringify(parsed.content);
  return JSON.stringify(parsed).slice(0, 3000);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + `\n…[truncated ${s.length - max} chars]` : s;
}
