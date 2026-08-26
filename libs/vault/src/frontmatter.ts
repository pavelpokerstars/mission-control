/**
 * A deliberately small YAML subset — enough for note frontmatter, and nothing
 * more.
 *
 * Why not a YAML library: the vault has to stay openable in Obsidian, a plain
 * editor, or `cat`, which rules out storing notes as JSON. But full YAML is a
 * large surface for six field types, and the project ships with zero markdown
 * dependencies. So we support exactly what a Note needs:
 *
 *   scalar      key: value
 *   inline list key: [a, b, c]
 *   block list  key:
 *                 - a
 *                 - b
 *   objects     evidence:
 *                 - {"surface":"zoom","label":"..."}
 *
 * That last one is a YAML flow mapping, so it is valid YAML *and* it parses
 * with JSON.parse. Nested block mappings are the part of YAML that is genuinely
 * annoying to hand-roll, and this sidesteps them without leaving the format.
 */

export type FrontmatterValue = string | string[] | Record<string, unknown>[];
export type Frontmatter = Record<string, FrontmatterValue>;

const FENCE = '---';

export interface ParsedDocument {
  data: Frontmatter;
  body: string;
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

function parseInlineList(raw: string): string[] {
  const inner = raw.trim().slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map(unquote).filter(Boolean);
}

/** `- {...}` is an object entry; anything else in a block list is a scalar. */
function parseListItem(raw: string): string | Record<string, unknown> {
  const t = raw.trim();
  if (t.startsWith('{')) {
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      // A malformed object entry becomes a plain string rather than taking the
      // whole note down. Losing one evidence row beats losing the note.
      return t;
    }
  }
  return unquote(t);
}

export function parse(source: string): ParsedDocument {
  // [judge-local patch] strip CR so key:value regexes match on Windows checkouts
  const text = source.replace(/^\uFEFF/, '').split('\r').join('');
  if (!text.startsWith(FENCE)) return { data: {}, body: text.trim() };

  const end = text.indexOf(`\n${FENCE}`, FENCE.length);
  if (end === -1) return { data: {}, body: text.trim() };

  const head = text.slice(FENCE.length, end);
  const body = text.slice(end + FENCE.length + 1).replace(/^\r?\n/, '');

  const data: Frontmatter = {};
  const lines = head.split('\n');
  let currentKey: string | undefined;
  let block: (string | Record<string, unknown>)[] = [];

  const flush = (): void => {
    if (currentKey === undefined) return;
    // Homogeneity is not enforced: a list is either all scalars or all objects
    // in practice, and the Note decoder coerces either way.
    data[currentKey] = block as FrontmatterValue;
    currentKey = undefined;
    block = [];
  };

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && currentKey !== undefined) {
      block.push(parseListItem(item[1] ?? ''));
      continue;
    }

    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;

    flush();
    const key = kv[1] ?? '';
    const value = (kv[2] ?? '').trim();

    if (!value) {
      // Bare `key:` opens a block list. If no items follow, it flushes to [].
      currentKey = key;
      block = [];
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = parseInlineList(value);
    } else {
      data[key] = unquote(value);
    }
  }
  flush();

  return { data, body: body.trim() };
}

/** Quote only when a bare scalar would be ambiguous to a real YAML reader. */
function scalar(v: string): string {
  return /^[\s]|[\s]$|^[[{>|*&!%@`#-]|:\s|^(true|false|null|~)$|^-?\d+(\.\d+)?$/i.test(v)
    ? JSON.stringify(v)
    : v;
}

export function stringify(data: Frontmatter, body: string): string {
  const lines: string[] = [FENCE];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
        continue;
      }
      const allScalar = value.every((v) => typeof v === 'string');
      if (allScalar) {
        lines.push(`${key}: [${(value as string[]).map(scalar).join(', ')}]`);
      } else {
        lines.push(`${key}:`);
        for (const v of value) lines.push(`  - ${JSON.stringify(v)}`);
      }
      continue;
    }
    lines.push(`${key}: ${scalar(String(value))}`);
  }

  lines.push(FENCE, '', body.trim(), '');
  return lines.join('\n');
}