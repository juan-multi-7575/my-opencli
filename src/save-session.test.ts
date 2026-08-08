import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { conversationIdFromUrl, withConversationMeta } from './conversation-id.js';
import { saveConversation, topicSlug } from './save-session.js';

describe('topicSlug', () => {
  it('drops stopwords and keeps up to 3 significant words', () => {
    expect(topicSlug('what is the rate of mangoes in usa')).toBe('mangoes-usa');
  });
  it('handles punctuation and mixed case', () => {
    expect(topicSlug('Explain, please, the COBOL Ecosystem!')).toBe('cobol-ecosystem');
  });
  it('falls back to chat when nothing survives', () => {
    expect(topicSlug('the and of')).toBe('chat');
    expect(topicSlug('')).toBe('chat');
  });
});

describe('conversationIdFromUrl', () => {
  it('extracts /c/<id> (chatgpt), /chat/<id> (grok/claude/kimi), /app/<id> (gemini)', () => {
    expect(conversationIdFromUrl('https://chatgpt.com/c/67f0a1b2c3d4e5f6a7b8c9d0')).toBe('67f0a1b2c3d4e5f6a7b8c9d0');
    expect(conversationIdFromUrl('https://grok.com/chat/abc123xyz456')).toBe('abc123xyz456');
    expect(conversationIdFromUrl('https://claude.ai/chat/9f8e7d6c5b4a3210')).toBe('9f8e7d6c5b4a3210');
    expect(conversationIdFromUrl('https://gemini.google.com/app/AbC123_xYz')).toBe('AbC123_xYz');
  });
  it('falls back to a stable hash of the URL', () => {
    const a = conversationIdFromUrl('https://kimi.moonshot.cn/chatroom');
    const b = conversationIdFromUrl('https://kimi.moonshot.cn/chatroom');
    expect(a).toBe(b);
    expect(a).toMatch(/^url-/);
  });
  it('returns empty for garbage', () => {
    expect(conversationIdFromUrl('')).toBe('');
    expect(conversationIdFromUrl(undefined)).toBe('');
    expect(conversationIdFromUrl(null)).toBe('');
  });
});

describe('withConversationMeta', () => {
  it('is invisible to JSON and iteration', () => {
    const rows = withConversationMeta([{ response: 'hi' }], { id: 'x1', url: 'https://x' });
    expect(JSON.stringify(rows)).toBe('[{"response":"hi"}]');
    expect(Object.keys(rows as unknown as object)).toEqual(['0']);
    expect((rows as unknown as { __opencliConversation: unknown }).__opencliConversation).toEqual({ id: 'x1', url: 'https://x' });
  });
});

describe('saveConversation', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-conv-'));

  it('creates a dir + transcript + index for a new conversation', () => {
    const r = saveConversation({
      site: 'chatgpt', prompt: 'what is the rate of mangoes in usa',
      response: 'about $2 per pound', conversationId: 'conv-1', baseDir: base,
    });
    expect(r?.appended).toBe(false);
    expect(r?.file).toMatch(/chatgpt-mangoes-usa\/\d{14}-mangoes-usa\.md$/);
    expect(fs.existsSync(r!.file)).toBe(true);
    const text = fs.readFileSync(r!.file, 'utf-8');
    expect(text).toContain('## user');
    expect(text).toContain('what is the rate of mangoes in usa');
    expect(text).toContain('about $2 per pound');
    const index = JSON.parse(fs.readFileSync(path.join(base, '.opencli-sessions.json'), 'utf-8'));
    expect(index.chatgpt['conv-1']).toBe('chatgpt-mangoes-usa');
  });

  it('appends follow-ups with the same conversationId to the same file', () => {
    const r1 = saveConversation({
      site: 'chatgpt', prompt: 'first question', response: 'first answer', conversationId: 'conv-1b', baseDir: base,
    });
    const r2 = saveConversation({
      site: 'chatgpt', prompt: 'follow-up question', response: 'second answer', conversationId: 'conv-1b', baseDir: base,
    });
    expect(r2?.appended).toBe(true);
    expect(r2?.file).toBe(r1?.file);
    const text = fs.readFileSync(r2!.file, 'utf-8');
    expect(text.match(/^## user/gm)).toHaveLength(2);
    expect(text).toContain('follow-up question');
    expect(text).toContain('second answer');
  });

  it('creates a new suffixed dir when the slug dir is taken by a different conversation', () => {
    const r = saveConversation({
      site: 'chatgpt', prompt: 'what is the rate of mangoes in usa', response: 'x', conversationId: 'conv-2', baseDir: base,
    });
    expect(r?.file).toMatch(/chatgpt-mangoes-usa-2\//);
    expect(fs.existsSync(r!.file)).toBe(true);
  });

  it('writes structured json with -f json', () => {
    const r = saveConversation({
      site: 'gemini', prompt: 'hello', response: 'hi there', conversationId: 'conv-3',
      fmt: 'json', baseDir: base,
    });
    expect(r?.file).toMatch(/\.json$/);
    const parsed = JSON.parse(fs.readFileSync(r!.file, 'utf-8'));
    expect(parsed.site).toBe('gemini');
    expect(parsed.turns).toHaveLength(2);
    expect(parsed.turns[0].role).toBe('user');
    expect(parsed.turns[0].content).toBe('hello');
  });

  it('creates an anon dir when no conversationId is present', () => {
    const r = saveConversation({ site: 'grok', prompt: 'ping', response: 'pong', baseDir: base });
    expect(r?.file).toMatch(/grok-ping\//);
    expect(fs.existsSync(r!.file)).toBe(true);
  });
});

describe('saveConversation md round-trip', () => {
  it('readTurns-parsed md matches what was written', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-conv-rt-'));
    saveConversation({
      site: 'claude', prompt: 'question one', response: 'answer one', conversationId: 'rt-1', baseDir: base,
    });
    const r2 = saveConversation({
      site: 'claude', prompt: 'question two', response: 'answer two', conversationId: 'rt-1', baseDir: base,
    });
    const text = fs.readFileSync(r2!.file, 'utf-8');
    expect(text).toContain('question one');
    expect(text).toContain('answer one');
    expect(text).toContain('question two');
    expect(text).toContain('answer two');
  });
});
