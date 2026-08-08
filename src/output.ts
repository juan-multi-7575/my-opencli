/**
 * Output formatting: table, JSON, Markdown, CSV, YAML.
 *
 * Renderers are pure: they build a string. `render()` then either writes it
 * to stdout (default) or saves it to a file when `opts.output` is set.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import Table from 'cli-table3';
import yaml from 'js-yaml';

export interface RenderOptions {
  fmt?: string;
  /** True when the user explicitly passed -f on the command line */
  fmtExplicit?: boolean;
  columns?: string[];
  title?: string;
  elapsed?: number;
  source?: string;
  footerExtra?: string;
  /**
   * Save the rendered output to this path instead of stdout.
   * `-` means stdout (explicit passthrough). A trailing `/` or an existing
   * directory gets an auto-generated filename.
   */
  output?: string;
}

function normalizeRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data as Record<string, unknown>];
  return [{ value: data }];
}

function resolveColumns(rows: Record<string, unknown>[], opts: RenderOptions): string[] {
  return opts.columns ?? Object.keys(rows[0] ?? {});
}

const FORMAT_EXTENSIONS: Record<string, string> = {
  json: '.json',
  yaml: '.yml',
  yml: '.yml',
  md: '.md',
  markdown: '.md',
  csv: '.csv',
  plain: '.txt',
  table: '.txt',
};

/** Resolve the final file path for `-o`: append format extension, auto-name inside directories. */
export function resolveOutputPath(target: string, opts: RenderOptions): string {
  if (target === '-') return target;
  const fmt = opts.fmt ?? 'table';
  const ext = FORMAT_EXTENSIONS[fmt] ?? '.txt';

  const isDirTarget = target.endsWith('/') || target.endsWith(path.sep) ||
    (fs.existsSync(target) && fs.statSync(target).isDirectory());

  if (isDirTarget) {
    const source = (opts.source ?? 'output').replace(/[^a-zA-Z0-9_-]+/g, '-');
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    return path.join(target, `${source}-${ts}${ext}`);
  }
  return target.endsWith(ext) ? target : target + ext;
}

export function render(data: unknown, opts: RenderOptions = {}): void {
  const out = renderToString(data, opts);
  const target = opts.output;
  if (!target || target === '-') {
    // console.log matches the historical stdout path (and test spies on it).
    console.log(out.replace(/\n$/, ''));
    return;
  }
  const filePath = resolveOutputPath(target, opts);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, out, 'utf-8');
  process.stderr.write(`# saved: ${filePath}\n`);
}

export function renderToString(data: unknown, opts: RenderOptions = {}): string {
  let fmt = opts.fmt ?? 'table';
  // Non-TTY auto-downgrade only when format was NOT explicitly passed by user.
  if (!opts.fmtExplicit) {
    if (fmt === 'table' && !process.stdout.isTTY) fmt = 'yaml';
  }
  if (data === null || data === undefined) {
    return String(data) + '\n';
  }
  switch (fmt) {
    case 'json': return renderJson(data);
    case 'plain': return renderPlain(data, opts);
    case 'md': case 'markdown': return renderMarkdown(data, opts);
    case 'csv': return renderCsv(data, opts);
    case 'yaml': case 'yml': return renderYaml(data);
    default: return renderTable(data, opts);
  }
}

function renderTable(data: unknown, opts: RenderOptions): string {
  const rows = normalizeRows(data);
  if (!rows.length) return '(no data)\n';
  const columns = resolveColumns(rows, opts);

  const header = columns.map(c => capitalize(c));
  const table = new Table({
    head: [...header],
    style: { head: [], border: [] },
    wordWrap: true,
    wrapOnWordBoundary: true,
  });

  for (const row of rows) {
    table.push(columns.map(c => {
      const v = (row as Record<string, unknown>)[c];
      return v === null || v === undefined ? '' : String(v);
    }));
  }

  const lines: string[] = [''];
  if (opts.title) lines.push(`  ${opts.title}`);
  lines.push(table.toString());
  const footer: string[] = [];
  footer.push(`${rows.length} items`);
  if (opts.elapsed !== undefined) footer.push(`${opts.elapsed.toFixed(1)}s`);
  if (opts.source) footer.push(opts.source);
  if (opts.footerExtra) footer.push(opts.footerExtra);
  lines.push(footer.join(' · '));
  return lines.join('\n') + '\n';
}

function renderJson(data: unknown): string {
  return JSON.stringify(data, null, 2) + '\n';
}

function renderPlain(data: unknown, opts: RenderOptions): string {
  const rows = normalizeRows(data);
  if (!rows.length) return '';

  // Single-row single-field shortcuts for chat-style commands.
  if (rows.length === 1) {
    const row = rows[0];
    const entries = Object.entries(row);
    if (entries.length === 1) {
      const [key, value] = entries[0];
      if (key === 'response' || key === 'content' || key === 'markdown' || key === 'text' || key === 'value') {
        return String(value ?? '') + '\n';
      }
    }
  }

  const blocks: string[] = [];
  rows.forEach((row, index) => {
    const lines: string[] = [];
    const entries = Object.entries(row).filter(([, value]) => value !== undefined && value !== null && String(value) !== '');
    for (const [key, value] of entries) lines.push(`${key}: ${value}`);
    blocks.push(lines.join('\n'));
    if (index < rows.length - 1) blocks.push('');
  });
  return blocks.join('\n') + '\n';
}

function renderMarkdown(data: unknown, opts: RenderOptions): string {
  const rows = normalizeRows(data);
  if (!rows.length) return '';
  if (rows.length === 1) {
    const entries = Object.entries(rows[0]);
    if (entries.length === 1) {
      const [key, value] = entries[0];
      if (key === 'content' || key === 'markdown' || key === 'text' || key === 'value') {
        return String(value ?? '') + '\n';
      }
    }
  }
  const columns = resolveColumns(rows, opts);
  const lines = [
    '| ' + columns.join(' | ') + ' |',
    '| ' + columns.map(() => '---').join(' | ') + ' |',
  ];
  for (const row of rows) {
    lines.push('| ' + columns.map(c => String((row as Record<string, unknown>)[c] ?? '').replace(/\|/g, '\\|')).join(' | ') + ' |');
  }
  return lines.join('\n') + '\n';
}

function renderCsv(data: unknown, opts: RenderOptions): string {
  const rows = normalizeRows(data);
  if (!rows.length) return '';
  const columns = resolveColumns(rows, opts);
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map(c => {
      const v = String((row as Record<string, unknown>)[c] ?? '');
      return v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')
        ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(','));
  }
  return lines.join('\n') + '\n';
}

function renderYaml(data: unknown): string {
  return yaml.dump(data, { sortKeys: false, lineWidth: 120, noRefs: true });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
