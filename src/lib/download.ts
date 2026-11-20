/** 触发浏览器下载一段文本（备份 JSON、CSV、Markdown 都用它）。 */
export function downloadTextFile(
  content: string,
  fileName: string,
  type = 'text/plain;charset=utf-8',
): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
