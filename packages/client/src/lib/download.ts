/** Save a string as a file via the browser's download mechanism. */
export function downloadText(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Turn a server-relative asset path into an absolute URL that works outside the app. */
export function absoluteUrl(url: string | null): string {
  if (!url) return '';
  return url.startsWith('/') ? `${location.origin}${url}` : url;
}

/** Local date stamp for file names, e.g. 2026-11-25. */
export function dateStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
