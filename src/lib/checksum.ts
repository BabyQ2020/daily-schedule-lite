/**
 * 稳定序列化与校验和。
 *
 * 备份文件需要「同样的数据 → 同样的字符串」，否则校验和无法比对：
 * 1) 对象键按字典序排序；
 * 2) 数组保持原顺序（顺序本身是数据）；
 * 3) undefined 字段在序列化时丢弃，与 JSON.stringify 行为一致。
 */

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      if (item !== undefined) {
        result[key] = normalize(item);
      }
    }
    return result;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function fnv1a32(input: string, basis: number): number {
  let hash = basis >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 16 位十六进制校验和：两个不同种子的 FNV-1a 拼接，降低碰撞概率。 */
export function checksumOf(value: unknown): string {
  const text = stableStringify(value);
  const first = fnv1a32(text, 0x811c9dc5).toString(16).padStart(8, '0');
  const second = fnv1a32(text, 0x01000193).toString(16).padStart(8, '0');
  return `${first}${second}`;
}

/** 统一检索文本：小写、去多余空白，供子串搜索使用。 */
export function toSearchText(parts: readonly (string | null | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
