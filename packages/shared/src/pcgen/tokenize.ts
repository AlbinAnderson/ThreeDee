/**
 * Low-level tokenizer for PCGen (.pcg) line syntax:
 *   TAG:VALUE|SUBTAG:[NESTED:A|NESTED2:B]|...
 *
 * Handles bracket-aware splitting and single-pass PCGen entity decoding.
 */
import type { PcgenRawLine, PcgenToken } from './schema';

const ENTITY_MAP: Record<string, string> = {
  nl: '\n',
  cr: '\r',
  colon: ':',
  pipe: '|',
  lbracket: '[',
  rbracket: ']',
  amp: '&',
};

const ENTITY_RE = /&(nl|cr|colon|pipe|lbracket|rbracket|amp);/g;

/**
 * Decode PCGen `EntityEncoder` escape sequences in a single pass so sequences
 * like `&amp;pipe;` decode to `&pipe;` rather than `|`.
 */
export function decodePcgenEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY_RE, (match, key: string) => ENTITY_MAP[key] ?? match);
}

/**
 * Split `input` on single-character `delimiter` only when outside `[...]`.
 */
export function splitBracketAware(input: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      if (depth > 0) depth--;
    } else if (ch === delimiter && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

/** Find index of the first `:` at bracket depth 0, or -1 if none. */
function findTopLevelColon(segment: string): number {
  let depth = 0;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      if (depth > 0) depth--;
    } else if (ch === ':' && depth === 0) {
      return i;
    }
  }
  return -1;
}

/**
 * True if `raw` is wrapped in a single matching `[...]` pair (index 0 opens and
 * closes at `raw.length - 1`).
 */
function isSingleBracketBlock(raw: string): boolean {
  if (raw.length < 2 || raw[0] !== '[' || raw[raw.length - 1] !== ']') return false;
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0 && i < raw.length - 1) return false;
    }
  }
  return depth === 0;
}

/**
 * Parse a single pipe-delimited segment into a `PcgenToken`.
 * If the value is a structured `[...]` block, recursively parses `subTokens`.
 */
export function parseToken(segment: string): PcgenToken {
  const colonIdx = findTopLevelColon(segment);
  if (colonIdx === -1) {
    return { tag: '', value: decodePcgenEntities(segment) };
  }

  const tag = decodePcgenEntities(segment.slice(0, colonIdx)).trim();
  const rawValue = segment.slice(colonIdx + 1);

  if (isSingleBracketBlock(rawValue)) {
    const inner = rawValue.slice(1, -1);
    if (inner.length === 0) {
      return { tag, value: '', subTokens: [] };
    }
    const innerParts = splitBracketAware(inner, '|');
    const hasStructuredEntry = innerParts.some((part) => findTopLevelColon(part) !== -1);
    if (hasStructuredEntry) {
      return {
        tag,
        value: decodePcgenEntities(inner),
        subTokens: innerParts.map(parseToken),
      };
    }
  }

  return { tag, value: decodePcgenEntities(rawValue) };
}

/**
 * Parse one line from a `.pcg` file. Returns `null` for blank lines and `#` comments.
 */
export function parseLine(line: string, lineNumber: number): PcgenRawLine | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const segments = splitBracketAware(trimmed, '|');
  const tokens = segments.map(parseToken);
  const tag = tokens[0]?.tag ?? '';

  return {
    lineNumber,
    tag,
    raw: trimmed,
    tokens,
  };
}

/**
 * Parse PCGen equipment `CUSTOMIZATION` `DATA` payload (`KEY=Val$NAME=Val$EQMOD=Mod1$EQMOD=Mod2`).
 */
export function parseCustomizationData(raw: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!raw) return result;

  for (const part of raw.split('$')) {
    if (!part) continue;
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) {
      const list = (result['_'] ??= []);
      list.push(part);
    } else {
      const key = part.slice(0, eqIdx).trim();
      const val = part.slice(eqIdx + 1);
      const list = (result[key] ??= []);
      list.push(val);
    }
  }
  return result;
}
