export interface HealthData {
  service: string;
  status: string;
  releaseId: string;
  schemaVersion: number;
}

interface ApiResponse<T> {
  data: T;
  meta: { requestId: string; version: number };
}

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? 'http://127.0.0.1:43111';

export async function fetchHealth(signal?: AbortSignal): Promise<HealthData> {
  const response = await fetch(`${API_ORIGIN}/health`, signal === undefined ? {} : { signal });
  if (!response.ok) {
    throw new Error(`健康检查失败：${response.status}`);
  }
  const body = await response.json() as ApiResponse<HealthData>;
  return body.data;
}
