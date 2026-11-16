const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export type MeetingRecord = {
  id?: string | number;
  title?: string;
  filename?: string;
  status?: string;
  processing_status?: string;
  date?: string;
  meeting_date?: string;
  created_at?: string;
  task_count?: number;
  tasks?: Array<{ status?: string }>;
};

export type MeetingStatistics = { total_meetings?: number; processed_meetings?: number; open_tasks?: number };
type MeetingsResponse = { meetings?: MeetingRecord[]; statistics?: MeetingStatistics };
type UploadResponse = { message?: string; filename?: string; detail?: string };

export type MeetingsResult = { records: MeetingRecord[] | null; statistics: MeetingStatistics | null };

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({})) as { detail?: string };
  return new Error(body.detail || fallback);
}

export async function checkBackend() {
  const response = await fetch(`${API_BASE}/health`);
  if (!response.ok) throw await readError(response, 'Backend health check failed.');
}

export async function listMeetings(): Promise<MeetingsResult> {
  const response = await fetch(`${API_BASE}/meetings`);
  if (!response.ok) throw await readError(response, 'Could not load meetings.');
  const data = await response.json() as MeetingsResponse | MeetingRecord[];
  if (Array.isArray(data)) return { records: data, statistics: null };
  return {
    records: Array.isArray(data.meetings) ? data.meetings : null,
    statistics: data.statistics ?? null,
  };
}

export async function uploadAudio(blob: Blob, filename: string) {
  const form = new FormData();
  form.append('file', blob, filename);
  const response = await fetch(`${API_BASE}/meetings/upload`, { method: 'POST', body: form });
  if (!response.ok) throw await readError(response, 'Audio upload failed.');
  return await response.json() as UploadResponse;
}

export { API_BASE };
