/** 设置页与仪表盘共用的展示格式化，避免各组件各写一套。 */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** ISO 时间戳 → 本地 `YYYY-MM-DD HH:mm`；无法解析时原样返回。 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** 字节数 → 人类可读；null 表示浏览器不支持估算。 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) {
    return '不可用';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
