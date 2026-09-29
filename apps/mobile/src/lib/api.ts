/**
 * API client. Holds the short-lived access token in memory and transparently
 * refreshes it once on a 401 using the stored refresh token.
 */
import { getRefreshToken, setRefreshToken } from './storage';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/**
 * A file or photo link from the server (…/files/… or …/uploads/…), pointed at the address this app
 * reaches the API on. The server builds these from its PUBLIC_URL setting; if that's set differently
 * (e.g. without /api), pictures would otherwise fail to load. Other URLs are left as they are.
 */
export function serverFileUrl(url: string): string;
export function serverFileUrl(url: string | null | undefined): string | null | undefined;
export function serverFileUrl(url: string | null | undefined) {
  const m = url && /^https?:\/\/[^/]+(?:\/.*?)?(\/(?:files|uploads)\/[^/?#]+.*)$/i.exec(url);
  return m ? API_URL + m[1] : url;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSignedOut: (() => void) | null = null;

export const getAccessToken = () => accessToken;
export const setSignedOutHandler = (fn: () => void) => (onSignedOut = fn);

export async function setSession(access: string | null, refresh: string | null) {
  accessToken = access;
  await setRefreshToken(refresh);
}

/** Exchange the stored refresh token for a new pair. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const token = await getRefreshToken();
      if (!token) return false;
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      }).catch(() => null);
      if (!res) return !!accessToken; // offline: keep whatever we have
      if (!res.ok) {
        await setSession(null, null);
        return false;
      }
      const data = await res.json();
      await setSession(data.accessToken, data.refreshToken);
      return true;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      // For FormData the runtime sets the multipart boundary itself.
      ...(body !== undefined && !isForm ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  }).catch(() => {
    throw new ApiError(0, 'offline', 'Cannot reach the server. Check your connection.');
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return request<T>(method, path, body, false);
    onSignedOut?.();
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? 'Something went wrong');
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  put: <T>(p: string, b: unknown = {}) => request<T>('PUT', p, b),
  patch: <T>(p: string, b: unknown = {}) => request<T>('PATCH', p, b),
  del: <T>(p: string) => request<T>('DELETE', p),
  /** Upload one picked image as multipart field "file". Works on iOS, Android and web. */
  /** Upload one file as multipart field "file" (photos, class files). */
  uploadFile: async <T>(p: string, asset: { uri: string; mimeType?: string | null; fileName?: string | null; file?: File }) => {
    const form = new FormData();
    const name = asset.fileName ?? 'photo.jpg';
    if (asset.file) form.append('file', asset.file, name); // web: real File object
    else if (asset.uri.startsWith('blob:') || asset.uri.startsWith('data:')) {
      form.append('file', await (await fetch(asset.uri)).blob(), name);
    } else {
      // React Native's FormData accepts { uri, name, type } for local files.
      form.append('file', { uri: asset.uri, name, type: asset.mimeType ?? 'application/octet-stream' } as any);
    }
    return request<T>('POST', p, form);
  },
};
