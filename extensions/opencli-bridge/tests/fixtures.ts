/** Shared `opencli list -f json` fixture: sites with args, aliases, write access, null domains. */
export const listFixture = [
  {
    command: "reddit/search", site: "reddit", name: "search", aliases: ["s"],
    description: "Search Reddit", access: "read", strategy: "api", browser: false,
    args: [{ name: "query", type: "str", required: true, positional: true, valueRequired: false, choices: [], default: null, help: "Search query" }],
    columns: ["title", "url"], domain: "reddit.com",
    example: "opencli reddit search <query> -f json", defaultFormat: null, siteSession: null,
  },
  {
    command: "reddit/reply", site: "reddit", name: "reply", aliases: [],
    description: "Reply to a comment", access: "write", strategy: "cookie", browser: true,
    args: [
      { name: "comment_id", type: "str", required: true, positional: true, valueRequired: false, choices: [], default: null, help: "Comment ID" },
      { name: "message", type: "str", required: true, positional: true, valueRequired: false, choices: [], default: null, help: "Reply text" },
    ],
    columns: ["ok"], domain: "reddit.com",
    example: "opencli reddit reply <comment_id> <message> -f json", defaultFormat: null, siteSession: null,
  },
  {
    command: "github/login", site: "github", name: "login", aliases: [],
    description: "Login to GitHub", access: "write", strategy: "cookie", browser: true,
    args: [], columns: ["status"], domain: "github.com",
    example: "opencli github login -f json", defaultFormat: null, siteSession: null,
  },
  {
    command: "crates/search", site: "crates", name: "search", aliases: [],
    description: "Search crates.io", access: "read", strategy: "api", browser: false,
    args: [{ name: "query", type: "str", required: true, positional: true, valueRequired: false, choices: [], default: null, help: "Query" }],
    columns: ["name", "version"], domain: "crates.io",
    example: "opencli crates search <query> -f json", defaultFormat: null, siteSession: null,
  },
  {
    command: "web/read", site: "web", name: "read", aliases: ["r"],
    description: "Read a page", access: "read", strategy: "browser", browser: true,
    args: [{ name: "url", type: "str", required: true, positional: false, valueRequired: false, choices: [], default: null, help: "URL" }],
    columns: ["title", "content"], domain: null,
    example: "opencli web read --url <url> -f json", defaultFormat: null, siteSession: null,
  },
  {
    command: "gemini/ask", site: "gemini", name: "ask", aliases: [],
    description: "Ask Gemini", access: "write", strategy: "cookie", browser: true,
    args: [{ name: "prompt", type: "str", required: true, positional: true, valueRequired: false, choices: [], default: null, help: "Prompt" }],
    columns: ["response"], domain: "gemini.google.com",
    example: "opencli gemini ask <prompt> -f json", defaultFormat: null, siteSession: null,
  },
  {
    command: "hackernews/search", site: "hackernews", name: "search", aliases: [],
    description: "Search HackerNews", access: "read", strategy: "api", browser: false,
    args: [{ name: "query", type: "str", required: true, positional: true, valueRequired: false, choices: [], default: null, help: "Query" }],
    columns: ["title", "url"], domain: "news.ycombinator.com",
    example: "opencli hackernews search <query> -f json", defaultFormat: null, siteSession: null,
  },
  {
    command: "duckduckgo/search", site: "duckduckgo", name: "search", aliases: [],
    description: "Search the web", access: "read", strategy: "api", browser: false,
    args: [{ name: "query", type: "str", required: true, positional: true, valueRequired: false, choices: [], default: null, help: "Query" }],
    columns: ["title", "url"], domain: "duckduckgo.com",
    example: "opencli duckduckgo search <query> -f json", defaultFormat: null, siteSession: null,
  },
];
