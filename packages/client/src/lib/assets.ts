/** Upload an image to the server and return its URL. */
export async function uploadAsset(file: File): Promise<string> {
  const res = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error ?? `Upload failed (${res.status})`);
  return body.url;
}

/** Natural pixel size of an image URL. */
export function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}
