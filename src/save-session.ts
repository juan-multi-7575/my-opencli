/**
 * Conversation transcript saving for AI chat adapters.
 *
 * Every `ask` call writes (or appends to) a session transcript under a base
 * directory, default `~/.opencli/conversations/`. A conversation is keyed by
 * its stable conversationId (same browser tab + same chat = same id), so
 * follow-up questions append to the same file instead of creating a new one.
 *
 * Layout:
 *   <base>/
 *     .opencli-sessions.json          # { site: { convId: dirName } } index
 *     <site>-<topic-slug>/            # e.g. chatgpt-mangoes
 *       <created>-<topic-slug>.md     # transcript, appended across turns
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  ts: string;
  content: string;
}

export interface SaveConversationOptions {
  site: string;
  prompt: string;
  response: string;
  /** Stable thread id; when absent a fresh dir is created every call. */
  conversationId?: string;
  conversationUrl?: string;
  tool?: string;
  /** md (default) or json */
  fmt?: string;
  baseDir?: string;
  /** When false, a failed write only warns via stderr. */
  failHard?: boolean;
}

export interface SaveConversationResult {
  dir: string;
  file: string;
  appended: boolean;
  conversationId: string;
}

export function defaultConversationsDir(): string {
  const configDir = process.env.OPENCLI_CONFIG_DIR || path.join(os.homedir(), '.opencli');
  return path.join(configDir, 'conversations');
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'so', 'for', 'to', 'of', 'in',
  'on', 'at', 'by', 'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'would', 'should', 'will', 'shall',
  'may', 'might', 'must', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'this',
  'that', 'these', 'those', 'i', 'me', 'my', 'mine', 'you', 'your', 'it', 'its', 'we', 'us',
  'they', 'them', 'their', 'please', 'about', 'into', 'upon', 'vs', 'versus', 'need', 'want',
  'tell', 'explain', 'describe', 'give', 'show', 'list', 'write', 'summarize', 'summarise',
  'help', 'there', 'here', 'up', 'down', 'out', 'off', 'over', 'under', 'again', 'once',
]);

/**
 * `"what is the rate of mangoes in usa"` → `mangoes-usa`.
 * First 3 non-stopword words, sanitized; falls back to `chat` when empty.
 */
export function topicSlug(prompt: string): string {
  const cleaned = prompt.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ');
  const tokens = cleaned.split(/\s+/).filter((w) => w.length > 0);
  const words = tokens.filter((w) => !STOPWORDS.has(w));
  // "what is the rate of mangoes in usa" → drop the subject noun after the
  // question lead, leaving a noun-centric slug: mangoes-usa.
  const dropFirst = /^(what|which|how|when|where|why|who)$/.test(tokens[0] ?? '');
  const picked = dropFirst ? words.slice(1) : words;
  const slug = picked.slice(0, 3).join('-') || 'chat';
  return slug.replace(/[^a-z0-9-]+/g, '').slice(0, 60) || 'chat';
}

interface SessionIndex {
  [site: string]: { [conversationId: string]: string };
}

function readIndex(baseDir: string): SessionIndex {
  try {
    const raw = fs.readFileSync(path.join(baseDir, '.opencli-sessions.json'), 'utf-8');
    return JSON.parse(raw) as SessionIndex;
  } catch {
    return {};
  }
}

function writeIndex(baseDir: string, index: SessionIndex): void {
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(
    path.join(baseDir, '.opencli-sessions.json'),
    JSON.stringify(index, null, 2) + '\n',
    'utf-8',
  );
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[-:TZ]/g, '').slice(0, 14); // 20260808134500
}

function renderTranscriptMarkdown(opts: SaveConversationOptions, existing: ConversationTurn[]): string {
  const slug = topicSlug(opts.prompt);
  const all = [...existing, { role: 'user', ts: nowStamp(), content: opts.prompt }];
  if (opts.response) all.push({ role: 'assistant', ts: nowStamp(), content: opts.response });

  const meta = [
    `# ${opts.site} — ${slug}`,
    '',
    `> site: ${opts.site}`,
    `> conversation: ${opts.conversationId ?? '-'}`,
  ];
  if (opts.conversationUrl) meta.push(`> url: ${opts.conversationUrl}`);
  if (opts.tool) meta.push(`> tool: ${opts.tool}`);
  meta.push(`> created: ${new Date().toISOString()}`);
  meta.push('');

  const body: string[] = [];
  for (const turn of all) {
    body.push(`## ${turn.role} — ${turn.ts}`);
    body.push('');
    body.push(turn.content);
    body.push('');
  }
  return meta.join('\n') + '\n' + body.join('\n');
}

function renderTranscriptJson(opts: SaveConversationOptions, existing: ConversationTurn[]): string {
  const turns: ConversationTurn[] = [
    ...existing,
    { role: 'user', ts: nowStamp(), content: opts.prompt },
  ];
  if (opts.response) turns.push({ role: 'assistant', ts: nowStamp(), content: opts.response });

  return JSON.stringify({
    site: opts.site,
    conversationId: opts.conversationId ?? null,
    url: opts.conversationUrl ?? null,
    tool: opts.tool ?? null,
    created: new Date().toISOString(),
    turns,
  }, null, 2) + '\n';
}

/** Parse an existing transcript file back into turns (md or json). */
function readTurns(file: string, fmt: string): ConversationTurn[] {
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    if (fmt === 'json') {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.turns)) return parsed.turns as ConversationTurn[];
      return [];
    }
    const turns: ConversationTurn[] = [];
    const lines = raw.split('\n');
    let role: 'user' | 'assistant' | null = null;
    let ts = '';
    const buf: string[] = [];
    const flush = () => {
      if (role) turns.push({ role, ts, content: buf.join('\n').trim() });
      buf.length = 0;
    };
    for (const line of lines) {
      const m = /^## (user|assistant) — (.+)$/.exec(line.trim());
      if (m) {
        flush();
        role = m[1] as 'user' | 'assistant';
        ts = m[2];
      } else if (role) {
        buf.push(line);
      }
    }
    flush();
    return turns;
  } catch {
    return [];
  }
}

/**
 * Save (or append to) a conversation transcript. Returns null when the write
 * fails and `failHard` is false (caller should warn, never fail the ask).
 */
export function saveConversation(opts: SaveConversationOptions): SaveConversationResult | null {
  const baseDir = opts.baseDir ?? defaultConversationsDir();
  const fmt = opts.fmt === 'json' ? 'json' : 'md';
  const slug = topicSlug(opts.prompt);
  const conversationId = opts.conversationId || `anon-${nowStamp()}`;
  const index = readIndex(baseDir);

  try {
    let dirName: string | undefined = index[opts.site]?.[conversationId];
    let file: string | undefined;
    let appended = false;

    if (dirName) {
      // Known conversation → reuse dir + file, append the new turn.
      const dir = path.join(baseDir, dirName);
      const existing = fs.readdirSync(dir).filter((f) => f.endsWith(`.${fmt}`))[0];
      if (existing) {
        const turns = readTurns(path.join(dir, existing), fmt);
        const body = fmt === 'json' ? renderTranscriptJson(opts, turns) : renderTranscriptMarkdown(opts, turns);
        fs.writeFileSync(path.join(dir, existing), body, 'utf-8');
        return { dir, file: path.join(dir, existing), appended: true, conversationId };
      }
      file = path.join(dir, `${nowStamp()}-${slug}.${fmt}`);
    } else {
      // New conversation → find a free `<site>-<slug>` dir (suffix -2, -3… on clash).
      let candidate = `${opts.site}-${slug}`;
      let n = 2;
      while (fs.existsSync(path.join(baseDir, candidate))) {
        candidate = `${opts.site}-${slug}-${n++}`;
      }
      dirName = candidate;
      file = path.join(baseDir, candidate, `${nowStamp()}-${slug}.${fmt}`);
      appended = false;
    }

    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    const turns = appended ? readTurns(file, fmt) : [];
    const body = fmt === 'json' ? renderTranscriptJson(opts, turns) : renderTranscriptMarkdown(opts, turns);
    fs.writeFileSync(file, body, 'utf-8');

    // Update index: this conversationId now maps to this dir.
    if (opts.conversationId) {
      const siteIndex = index[opts.site] ?? {};
      siteIndex[conversationId] = dirName;
      index[opts.site] = siteIndex;
      writeIndex(baseDir, index);
    }
    return { dir, file, appended, conversationId };
  } catch (err) {
    if (opts.failHard) throw err;
    process.stderr.write(`# warn: could not save conversation transcript: ${err instanceof Error ? err.message : String(err)}\n`);
    return null;
  }
}
