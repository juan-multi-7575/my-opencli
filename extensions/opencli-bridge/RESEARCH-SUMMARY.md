# Research Summary: Pi Extension + OpenCLI Integration

## 1. Pi Extension System Architecture

### Placement Rules
- `~/.pi/agent/extensions/` - Global (all projects)
- `.pi/extensions/` - Project-local
- Both support hot-reload via `/reload`

### Core Capabilities (from docs)
- `pi.registerTool()` - Register tools callable by LLM
- Event interception - Block/modify tool calls, inject context
- Custom UI via `ctx.ui` methods
- State management via `pi.appendEntry()`
- Custom rendering for messages/entries
- Slash commands with autocomplete
- Runtime tool activation via `pi.setActiveTools()`

### Example Extension Files (80+ examples in repo)
- `hello.ts` - Minimal tool with `defineTool`
- `dynamic-tools.ts` - Register tools dynamically at runtime
- `tool-override.ts` - Override built-in tools
- `truncated-tool.ts` - Proper output truncation
- `commands.ts` - Slash command registration
- `todo.ts` - Stateful tool with session reconstruction
- `plan-mode/` - Claude Code-style plan mode
- `input-transform.ts` - Transform user input before processing

## 2. OpenCLI Capability Analysis

### AI Chat Adapters (Live Status)
- **gemini** - Connected, Logged in ✓
- **grok** - Connected, Guest logged in ✓
- **chatgpt** - Connected, Guest logged in ✓
- **claude** - Not ready, Not logged in ❌
- **deepseek** - Not ready, Not logged in ❌
- **kimi** - 29 commands, most feature-rich AI adapter ✓
- **qwen** - Unknown status
- **doubao** - Unknown status
- **yuanbao** - Unknown status

### Available Search/Research Sites
| Category | Sites | Example Commands |
|---|---|---|
| General Search | google, duckduckgo, brave, yahoo | `search`, `trends`, `suggest` |
| Community | hackernews, reddit, stackoverflow, devto | `search`, `top`, `hot` |
| Academic | arxiv, semanticscholar, dblp | `search`, `paper`, `author` |
| Media | youtube, bilibili, twitter, instagram | `search`, `video`, `download` |
| Images | xiaohongshu, rednote, pixiv | `search`, `download` |

### Media Download Support
| Site | Command | Notes |
|---|---|---|
| twitter | `download` | Media from tweets |
| instagram | `download` | Posts, stories |
| bilibili | `download`, `subtitle`, `summary` | Video + subtitle |
| xiaohongshu | `download` | Notes, images |
| rednote | `download` | Notes |

## 3. Best-Practice Takeaways for This Extension

### Events to Use
1. **`before_agent_start`** - Inject system prompt telling agent about OpenCLI
2. **`tool_call`** - Intercept curl/wget and block with OpenCLI alternatives
3. **`session_start`** - Health check and registry cache
4. **`user_bash`** - Intercept user `!` commands for web operations

### Tool Registration Pattern
```typescript
// Use defineTool for better type inference
const opencliRunTool = defineTool({
  name: "opencli_run",
  label: "OpenCLI Runner",
  description: "Run any OpenCLI command - prefer this over curl/wget",
  parameters: Type.Object({
    command: Type.String(),
    format: Type.Optional(StringEnum(["json", "table", "yaml"] as const)),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // Run opencli via pi.exec()
  },
});
```

### State Management
- Store OpenCLI registry in tool result `details` for branching support
- Reconstruct state from session entries on startup
- Use `pi.appendEntry()` for non-LLM state

### Enforcement Strategy
- Hard block curl/wget for public web URLs
- Suggest OpenCLI tools in system prompt
- Maintain registry cache and live routing

## 4. Key Decisions for Implementation

### Tool Design
- `opencli_run` - General purpose (most sites)
- `opencli_search` - Smart router (grok → doubao → gemini, else hackernews, reddit)
- `opencli_download` - Media download (auto-detects site)
- `opencli_research` - Multi-source research with AI synthesis

### Commands
- `/oc search` - Quick search
- `/oc research` - Deep research with profiles
- `/oc download` - Media download
- `/oc doctor` - Health check
- `/oc off` / `/oc on` - Toggle enforcement

### Profiles
- `default` - AI chat synthesis + community
- `pi-extension` - AI chat + pi docs + community
- `pi-agent` - AI chat + reddit + medium
- `coding-agent` - AI chat + stackoverflow + hackernews
- `tech-news` - AI chat + news sites

This summary provides the foundation for building the OpenCLI bridge extension for Pi.