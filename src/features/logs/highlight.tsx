import type { ReactNode } from 'react';

export interface HighlightPart {
  text: string;
  match: boolean;
}

/** 大小写不敏感的子串切分：只切出现过的关键词，其余原样返回。 */
export function splitHighlight(text: string, keyword: string): HighlightPart[] {
  const needle = keyword.trim().toLowerCase();
  if (needle.length === 0 || text.length === 0) {
    return [{ text, match: false }];
  }

  const haystack = text.toLowerCase();
  const parts: HighlightPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const found = haystack.indexOf(needle, cursor);
    if (found < 0) {
      parts.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (found > cursor) {
      parts.push({ text: text.slice(cursor, found), match: false });
    }
    parts.push({ text: text.slice(found, found + needle.length), match: true });
    cursor = found + needle.length;
  }
  return parts;
}

export interface HighlightedTextProps {
  text: string;
  keyword: string;
  className?: string;
}

export function HighlightedText({ text, keyword, className }: HighlightedTextProps): ReactNode {
  const parts = splitHighlight(text, keyword);
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.match ? (
          <mark key={`${part.text}-${String(index)}`} className="search-hit">
            {part.text}
          </mark>
        ) : (
          <span key={`${part.text}-${String(index)}`}>{part.text}</span>
        ),
      )}
    </span>
  );
}

/**
 * 列表摘要：命中关键词时以关键词为中心开窗，否则取前 length 个字符。
 * 这样命中位置在正文后半段时也能在列表里看到上下文。
 */
export function makeSnippet(text: string, keyword: string, length = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= length) {
    return flat;
  }
  const needle = keyword.trim().toLowerCase();
  const found = needle.length > 0 ? flat.toLowerCase().indexOf(needle) : -1;
  if (found < 0) {
    return `${flat.slice(0, length)}…`;
  }
  const start = Math.max(0, found - Math.floor(length / 3));
  const end = Math.min(flat.length, start + length);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < flat.length ? '…' : '';
  return `${prefix}${flat.slice(start, end)}${suffix}`;
}
