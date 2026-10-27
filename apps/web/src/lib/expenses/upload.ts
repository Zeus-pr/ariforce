/** Receipt upload (docs/EXPENSES.md): ask for a URL, PUT the bytes straight to storage, then confirm. */
import { api, toApiError } from '@/lib/api';
import { contentTypeFor, messageFor } from './model';

export class UploadError extends Error {}

function put(url: string, headers: Record<string, string>, file: File, onProgress: (p: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new UploadError('Upload failed. Try again.')));
    x.onerror = () => reject(new UploadError('Upload failed. Check your connection.'));
    x.onabort = () => reject(new UploadError('Upload cancelled.'));
    signal?.addEventListener('abort', () => x.abort());
    x.send(file);
  });
}

/** fetch fallback where XHR progress is not available (MSW in mock mode intercepts fetch, not XHR). */
async function putFetch(url: string, headers: Record<string, string>, file: File, onProgress: (p: number) => void, signal?: AbortSignal) {
  onProgress(0.5);
  const r = await fetch(url, { method: 'PUT', headers, body: file, signal }).catch(() => null);
  if (!r?.ok) throw new UploadError('Upload failed. Try again.');
}

export async function uploadReceipt(
  claimId: string,
  lineId: string,
  file: File,
  onProgress: (p: number) => void,
  opts: { signal?: AbortSignal; viaFetch?: boolean } = {},
) {
  const contentType = contentTypeFor(file);
  if (!contentType) throw new UploadError('Unsupported file type.');
  const r = await api.POST('/v1/expense-claims/{id}/lines/{lineId}/attachments', {
    params: { path: { id: claimId, lineId } },
    body: { fileName: file.name, contentType, sizeBytes: file.size },
  });
  if (r.error || !r.data) throw new UploadError(messageFor(toApiError(r)));
  const { attachment, uploadUrl, headers } = r.data;
  try {
    await (opts.viaFetch ? putFetch : put)(uploadUrl, headers, file, onProgress, opts.signal);
  } catch (e) {
    // Leave no pending attachment behind.
    await api.DELETE('/v1/expense-attachments/{id}', { params: { path: { id: attachment.id } } });
    throw e;
  }
  onProgress(1);
  const c = await api.POST('/v1/expense-attachments/{id}/confirm', { params: { path: { id: attachment.id } } });
  if (c.error || !c.data) throw new UploadError(messageFor(toApiError(c)));
  return c.data;
}

export async function openReceipt(id: string) {
  // Open the tab first (inside the click) so Safari does not block it, then point it at the short-lived URL.
  const w = window.open('', '_blank');
  const r = await api.POST('/v1/expense-attachments/{id}/download-url', { params: { path: { id } } });
  if (r.error || !r.data) {
    w?.close();
    throw new UploadError(messageFor(toApiError(r)));
  }
  if (w) w.location.href = r.data.downloadUrl;
  else window.location.assign(r.data.downloadUrl);
}
