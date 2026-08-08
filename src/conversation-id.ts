/**
 * Stable conversation identity for AI chat adapters.
 *
 * Chat sites carry the current conversation id in the URL (`/c/<id>`,
 * `/chat/<id>`, `/app/<id>`). Same browser tab + same chat = same URL = same
 * id, which is what lets follow-up `ask` calls append to the same transcript.
 * When no id pattern matches, the full URL is hashed — stable for the life of
 * the tab, which is good enough to group follow-ups.
 */

export function conversationIdFromUrl(url: string | null | undefined): string {
  const u = String(url ?? '');
  if (!u) return '';
  const m = u.match(/\/(?:chat|c|app|conversations?)\/([A-Za-z0-9_-]{6,})(?:[/?#]|$)/i);
  if (m) return m[1];
  return 'url-' + hashString(u);
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36) + '-' + s.length.toString(36);
}

/**
 * Attach conversation metadata to a result array without affecting display:
 * non-enumerable, so renderers (which iterate rows) and JSON.stringify ignore
 * it; the adapter runner reads it back for transcript saving.
 */
export function withConversationMeta<T>(result: T[], meta: { id?: string; url?: string; tool?: string }): T[] {
  Object.defineProperty(result, '__opencliConversation', {
    value: meta,
    enumerable: false,
    configurable: true,
  });
  return result;
}

export type ConversationMeta = { id?: string; url?: string; tool?: string };
