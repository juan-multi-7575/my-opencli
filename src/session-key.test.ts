import { describe, expect, it } from 'vitest';
import type { CliCommand } from './registry.js';
import { resolveAdapterBrowserSession, resolveSiteSession } from './execution.js';

const cmd = { site: 'chatgpt' } as CliCommand;

describe('resolveSiteSession', () => {
  it('defaults to ephemeral when nothing is given', () => {
    expect(resolveSiteSession(cmd)).toBe('ephemeral');
    expect(resolveSiteSession(cmd, undefined)).toBe('ephemeral');
  });

  it('honors an explicit --site-session option', () => {
    expect(resolveSiteSession(cmd, 'persistent')).toBe('persistent');
    expect(resolveSiteSession(cmd, 'ephemeral')).toBe('ephemeral');
  });

  it('a session key implies persistent (window must survive between invocations)', () => {
    expect(resolveSiteSession(cmd, undefined, 'agent-1')).toBe('persistent');
    // even when the user explicitly asked for ephemeral
    expect(resolveSiteSession(cmd, 'ephemeral', 'agent-1')).toBe('persistent');
  });
});

describe('resolveAdapterBrowserSession', () => {
  it('keeps the default ephemeral session random per invocation', () => {
    const a = resolveAdapterBrowserSession(cmd, 'ephemeral');
    const b = resolveAdapterBrowserSession(cmd, 'ephemeral');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^site:chatgpt:/);
  });

  it('uses a deterministic site-scoped name for persistent sessions', () => {
    expect(resolveAdapterBrowserSession(cmd, 'persistent')).toBe('site:chatgpt');
  });

  it('scopes the session by key: same key ⇒ same window', () => {
    const a = resolveAdapterBrowserSession(cmd, 'persistent', 'agent-1');
    const b = resolveAdapterBrowserSession(cmd, 'persistent', 'agent-1');
    expect(a).toBe(b);
    expect(a).toBe('site:chatgpt:agent-1');
  });

  it('different keys ⇒ different windows', () => {
    const a = resolveAdapterBrowserSession(cmd, 'persistent', 'agent-1');
    const b = resolveAdapterBrowserSession(cmd, 'persistent', 'agent-2');
    expect(a).not.toBe(b);
  });

  it('a key works even when the session mode would be ephemeral', () => {
    expect(resolveAdapterBrowserSession(cmd, 'ephemeral', 'agent-1')).toBe('site:chatgpt:agent-1');
  });
});
