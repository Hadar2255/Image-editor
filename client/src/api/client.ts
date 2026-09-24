import type { CropRect, EditParams } from '@raw/shared';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

const PASSWORD_KEY = 'raw-studio:app-password';

function storedPassword(): string {
  try {
    return localStorage.getItem(PASSWORD_KEY) ?? '';
  } catch {
    return '';
  }
}

async function post<T>(path: string, body: unknown, retried = false): Promise<T> {
  const res = await fetch(`/api/ai/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-password': storedPassword() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === 'password' && !retried) {
    const pw = window.prompt('This app is password protected. Enter the password (set as APP_PASSWORD on the server):');
    if (pw) {
      try {
        localStorage.setItem(PASSWORD_KEY, pw);
      } catch {
        /* storage unavailable: the password is only used for this request */
      }
      return post(path, body, true);
    }
  }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.code);
  return data as T;
}

export interface Health {
  ok: boolean;
  claudeConfigured: boolean;
  model: string;
  passwordRequired: boolean;
}

let healthPromise: Promise<Health> | null = null;
export function getHealth(): Promise<Health> {
  healthPromise ??= fetch('/api/health')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Health check failed (${r.status})`))))
    .catch((e) => {
      healthPromise = null;
      throw e;
    });
  return healthPromise;
}

export interface AnalyzeResponse {
  params: EditParams;
  sceneType: string;
  reasoning: string;
  geometry: { angle: number; crop: CropRect | null };
}

export function analyze(body: { image: string; meta: object; stats: object; suggestion: EditParams }) {
  return post<AnalyzeResponse>('analyze', body);
}

export function instruct(body: { image: string; params: EditParams; instruction: string }) {
  return post<{ params: EditParams; explanation: string }>('instruct', body);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
