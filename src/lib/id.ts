/** 生成唯一 id。优先用 crypto.randomUUID，缺失时退化为时间戳 + 随机串。 */
export function createId(prefix?: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${uuid}` : uuid;
}

export function createTagId(): string {
  return createId('tag');
}
