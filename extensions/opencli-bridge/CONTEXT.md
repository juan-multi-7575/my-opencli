# OpenCLI Bridge

The OpenCLI Bridge is a pi coding-agent extension. It connects the agent to OpenCLI, the web tool kit. The Bridge gives the agent five Tools, a Registry of sites, Enforcement against raw scraping, and a research engine.

## Language

**OpenCLI**:
The external command-line tool kit. It wraps 170+ web sites into uniform `opencli <site> <command>` calls. The Bridge never re-implements site access; it delegates to OpenCLI.
_Avoid_: "the CLI"

**Bridge**:
The opencli-bridge pi extension. It is the agent's sanctioned path to the web.
_Avoid_: "the extension" (ambiguous — pi loads many extensions)

**Tool**:
One of the five capabilities the Bridge registers for the agent: `opencli_run`, `opencli_search`, `opencli_download`, `opencli_research`, `opencli_list`.
_Avoid_: "function", "command" (commands belong to OpenCLI sites)

**Registry**:
The live inventory of OpenCLI sites — their names, domains, and commands — cached at session start. It is the single source of truth for Routing and Enforcement.
_Avoid_: "site list" (implies static), "manifest" (the repo's cli-manifest.json is a different artifact)

**Enforcement**:
The feature that stops bash commands from scraping public web URLs with curl/wget/requests/fetch, and redirects the agent to the Tools. It never blocks local and private-network traffic.
_Avoid_: "blocking" (a behavior, not the feature), "policing"

**Route**:
The decision of which site + command a query maps to. Keyword rules against the Registry make it, or an explicit site override.
_Avoid_: "search routing" (Routes also cover non-search commands)

**Research profile**:
A preset set of sources for `opencli_research`: exactly one AI-chat site plus up to two specialized sites.
_Avoid_: "plan" (a plan is one concrete instance of a profile)

**Budget guard**:
The tool-level rule that limits repeated queries. Identical repeats are served from a cache; each site gets a soft cap of distinct queries per session.
_Avoid_: "rate limit" (suggests time-based limits)

**Auth status**:
Whether an OpenCLI adapter (gemini, grok, chatgpt, …) is logged in. The Bridge surfaces it so the agent stops calling dead adapters.
_Avoid_: "login state", "connection"

**Intent injection**:
Extra system-prompt text the Bridge appends when the user's message looks like web intent, reminding the agent to use the Tools.

**Schema**:
The per-command argument specification from the Registry: name, type, required, help, example. The `opencli_help` Tool answers Schema questions from cache, so the agent stops inventing flags.
_Avoid_: "arg spec", "signature"

**Write command**:
A Registry command with `access: write`. It changes state or spends quota (comment, follow, reply — and every AI `ask`).
_Avoid_: "mutation" (covers data changes only, not quota)

**Destructive command**:
A Write command whose verb is destructive (delete, buy, pay, purchase, transfer, order, cancel). Enforcement blocks it unless the user's message explicitly asked.
_Avoid_: "dangerous command" (vague)

**AI slot**:
The AI-chat site a Research profile uses. Resolution order: explicit `sites` parameter → first reachable adapter in the chain (kimi → gemini → grok → chatgpt → deepseek) → profile default.
_Avoid_: "AI adapter" (that is the underlying site itself)
