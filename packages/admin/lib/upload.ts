/**
 * File Name: upload.ts
 * Purpose: XHR-based media upload with real progress events — fetch() cannot
 *          report request-body progress, so every uploader that wants a
 *          percentage goes through here.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: resolves with the parsed JSON response; rejects with an
 *          Error carrying the server's error.message when available.
 */

export interface UploadProgress {
  /** 0–100 (integer). Indeterminate uploads report -1. */
  percent: number
  loadedBytes: number
  totalBytes: number
}

/**
 * POST a FormData body with upload-progress callbacks.
 * @param url - Absolute or relative upload endpoint.
 * @param form - The multipart body.
 * @param opts.token - Bearer token (Authorization header).
 * @param opts.onProgress - Called with percentage as bytes leave the browser.
 */
export function uploadWithProgress<T = unknown>(
  url: string,
  form: FormData,
  opts: { token?: string | null; onProgress?: (p: UploadProgress) => void } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    if (opts.token) xhr.setRequestHeader('Authorization', `Bearer ${opts.token}`)

    xhr.upload.onprogress = (e) => {
      if (!opts.onProgress) return
      if (e.lengthComputable) {
        opts.onProgress({ percent: Math.round((e.loaded / e.total) * 100), loadedBytes: e.loaded, totalBytes: e.total })
      } else {
        opts.onProgress({ percent: -1, loadedBytes: e.loaded, totalBytes: 0 })
      }
    }

    xhr.onload = () => {
      let body: unknown = null
      try { body = JSON.parse(xhr.responseText) } catch { /* non-JSON response */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T)
      } else {
        const msg = (body as { error?: { message?: string } } | null)?.error?.message ?? `Upload failed (${xhr.status})`
        reject(new Error(msg))
      }
    }
    xhr.onerror = () => reject(new Error('Upload failed - network error'))
    xhr.onabort = () => reject(new Error('Upload cancelled'))

    xhr.send(form)
  })
}
