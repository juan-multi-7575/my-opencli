/**
 * index.ts — OpenCLI Bridge for Pi Coding Agent
 *
 * Entry point: health check, registry cache, event wiring,
 * slash commands, enforcement toggle, system prompt injection.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildRegistry, type Registry } from "./registry";
import { registerOpenCliTools } from "./tools";
import { registerEnforcement } from "./enforce";
import { buildSystemPrompt, OPENCLI_INTENT_INJECTION, type ConnectivityInfo } from "./prompts";
import { type ResearchProfile } from "./research";

// ---------- State ----------

let enforcementEnabled = true;
let cachedRegistry: Registry | null = null;
let cachedConnectivity: ConnectivityInfo | null = null;

function getRegistryRef(): Registry | null {
  return cachedRegistry;
}

// ---------- Health + registry cache ----------

async function refreshRegistry(pi: ExtensionAPI) {
  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);
    const { stdout } = (await execAsync("opencli list -f json", {
      timeout: 30_000,
      maxBuffer: 50 * 1024 * 1024,
    })) as any;
    cachedRegistry = buildRegistry(JSON.parse(stdout));
  } catch (e: any) {
    cachedRegistry = null;
  }
}

/**
 * Cheap global connectivity signal (opencli doctor). Per-site login status is
 * NOT cheaply available — `opencli auth status` hangs probing the browser — so
 * the prompt carries this global signal instead (ADR: auth-status surfacing).
 */
async function refreshConnectivity() {
  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);
    const { stdout } = (await execAsync("opencli doctor", {
      timeout: 8_000,
    })) as any;
    const out = String(stdout ?? "");
    cachedConnectivity = {
      daemon: /\[OK\] Daemon/.test(out),
      browserBridge: /\[OK\] Connectivity/.test(out) && !/not connected/.test(out),
    };
  } catch {
    cachedConnectivity = null;
  }
}

// ---------- Main extension ----------

export default async function (pi: ExtensionAPI) {
  // 1. Refresh registry + connectivity on startup (doctor is fast; list is cached 1h)
  await refreshRegistry(pi);
  await refreshConnectivity();

  // 2. Register tools (with registry getter for live lookups)
  registerOpenCliTools(pi, getRegistryRef);

  // 3. Register strict enforcement (always on by default)
  registerEnforcement(pi, getRegistryRef, () => enforcementEnabled);

  // 4. System prompt injection — rules + LIVE curated site index + connectivity
  pi.on("before_agent_start", async (event, ctx) => {
    let systemPrompt = event.systemPrompt + "\n" + buildSystemPrompt(cachedRegistry, cachedConnectivity);

    // If user's message has web/research intent → inject extra
    const prompt = event.prompt?.toLowerCase() ?? "";
    const webIntent =
      /search|look up|find|research|what is|how to|compare|explain|latest|trend|news|download|website|web/
        .test(prompt);
    if (webIntent) {
      systemPrompt += "\n" + OPENCLI_INTENT_INJECTION;
    }

    return { systemPrompt };
  });

  // 5. Health status on startup
  pi.on("session_start", async (_event, ctx) => {
    if (cachedRegistry) {
      const conn = cachedConnectivity?.browserBridge ? "browser ✓" : "browser ✗";
      ctx.ui.setStatus(
        "opencli-bridge",
        `opencli ✓ ${cachedRegistry.sites.length} sites | ${conn} | enforcement ${enforcementEnabled ? "ON" : "OFF"}`
      );
    } else {
      ctx.ui.setStatus("opencli-bridge", "opencli ⚠ registry unavailable");
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("opencli-bridge", "");
  });

  // 6. Slash commands

  pi.registerCommand("oc", {
    description: "OpenCLI bridge: /oc search|research|download|sites|doctor|on|off",
    getArgumentCompletions: (prefix: string) => {
      const items = ["search", "research", "download", "sites", "doctor", "on", "off"];
      const filtered = items.filter((i) => i.startsWith(prefix));
      return filtered.map((value) => ({ value, label: value }));
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0] ?? "";

      switch (sub) {
        case "on":
          enforcementEnabled = true;
          ctx.ui.notify("OpenCLI enforcement: ON (curl/wget to public sites will be blocked)", "info");
          break;

        case "off":
          enforcementEnabled = false;
          ctx.ui.notify("OpenCLI enforcement: OFF (curl/wget allowed, tools still available)", "warning");
          break;

        case "doctor": {
          ctx.ui.notify("Checking opencli daemon...", "info");
          try {
            const { exec } = await import("node:child_process");
            const { promisify } = await import("node:util");
            const execAsync = promisify(exec);
            const { stdout } = await execAsync("opencli doctor", { timeout: 10_000 });
            ctx.ui.notify(String(stdout ?? "opencli doctor completed"), "info");
          } catch (e: any) {
            ctx.ui.notify(`opencli doctor failed: ${e?.message ?? e}`, "error");
          }
          break;
        }

        case "sites":
        case "list": {
          const site = parts[1];
          if (site) {
            const cmds = cachedRegistry?.siteCommands.get(site);
            if (cmds) {
              ctx.ui.notify(`${site}: ${cmds.join(", ")}`, "info");
            } else {
              ctx.ui.notify(`Site "${site}" not in registry.`, "warning");
            }
          } else {
            const count = cachedRegistry?.sites.length ?? 0;
            const list = cachedRegistry?.sites.map((s) => s.site).join(", ") ?? "unavailable";
            ctx.ui.notify(`${count} sites: ${list}`, "info");
          }
          break;
        }

        case "download": {
          const url = parts[1];
          if (!url) {
            ctx.ui.notify("Usage: /oc download <url>", "warning");
            return;
          }
          // Same pattern as search/research: delegate to the tool via a follow-up.
          pi.sendUserMessage(`Download "${url}" using opencli_download`, {
            deliverAs: "followUp",
          });
          break;
        }

        case "search": {
          const query = parts.slice(1).join(" ");
          if (!query) {
            ctx.ui.notify("Usage: /oc search <query>", "warning");
            return;
          }
          // Trigger a user message to run the search
          pi.sendUserMessage(`Search for "${query}" using opencli_search`, {
            deliverAs: "followUp",
          });
          break;
        }

        case "research": {
          const topic = parts.slice(1).join(" ");
          if (!topic) {
            ctx.ui.notify("Usage: /oc research <topic>", "warning");
            return;
          }
          pi.sendUserMessage(`Research topic "${topic}" using opencli_research`, {
            deliverAs: "followUp",
          });
          break;
        }

        default:
          ctx.ui.notify(
            "Usage: /oc [search <query>|research <topic>|download <url>|sites [site]|doctor|on|off]",
            "info"
          );
      }
    },
  });
}
