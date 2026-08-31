const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// The access-token cookie is short-lived (15 min). When a request comes
// back 401 we transparently rotate it via the refresh-token cookie and
// retry once, so the user never notices the access token expired. Multiple
// requests failing at once share a single in-flight refresh call.
let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

const NO_REFRESH_RETRY_PATHS = ["/auth/refresh", "/auth/login", "/auth/register"];

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}, _retried = false): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (res.status === 401 && !_retried && !NO_REFRESH_RETRY_PATHS.includes(path)) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return apiFetch<T>(path, options, true);
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T,>(path: string) => apiFetch<T>(path, { method: "GET" }),
  post: <T,>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T,>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T,>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T,>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

export interface BulkSkipped {
  id: string;
  reason: "not_found" | "forbidden";
}

export interface BulkUpdateResult<T = unknown> {
  updated: T[];
  skipped: BulkSkipped[];
}

export interface BulkDeleteResult {
  deletedIds: string[];
  skipped: BulkSkipped[];
}

export function bulkUpdateItems<T = unknown>(
  ids: string[],
  patch: { status?: string; assignedToId?: string | null; important?: boolean; urgent?: boolean }
) {
  return api.patch<BulkUpdateResult<T>>("/items/bulk", { ids, patch });
}

export function bulkDeleteItems(ids: string[]) {
  return apiFetch<BulkDeleteResult>("/items/bulk", { method: "DELETE", body: JSON.stringify({ ids }) });
}

// Multipart file uploads (e.g. the camera-scan attachment) must NOT go
// through apiFetch: it hard-sets Content-Type: application/json, whereas a
// multipart request needs the browser to set Content-Type (incl. boundary)
// itself from the FormData body.
export async function apiUpload<T = unknown>(path: string, file: File | Blob, fieldName = "file"): Promise<T> {
  const formData = new FormData();
  formData.append(fieldName, file);

  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return apiUpload<T>(path, file, fieldName);
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message);
  }

  return res.json();
}

/**
 * Fetches an authenticated attachment (cookie-protected, so it cannot be
 * used as a plain <img src>) and returns a local blob: URL for display.
 * Caller is responsible for revoking it (URL.revokeObjectURL) when done.
 */
export async function fetchAttachmentUrl(itemId: string): Promise<string> {
  const res = await fetch(`${API_URL}/items/${itemId}/attachment`, { credentials: "include" });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
