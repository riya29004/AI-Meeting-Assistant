export const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

export function apiFetch(path: string, init: RequestInit = {}) {
  const url = /^https?:\/\//i.test(path) ? path : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  return fetch(url, { ...init, credentials: 'include' });
}

export function audioSocketUrl(meetingId: string) {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${url.origin}/api/meetings/${encodeURIComponent(meetingId)}/audio`;
}

export async function authenticate(path: '/api/auth/login' | '/api/auth/register', email: string, password: string) {
  const response = await apiFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!response.ok) throw await readError(response, path.endsWith('login') ? 'Sign in failed.' : 'Registration failed.');
  return response.json();
}

export type ContactMessage = { name: string; email: string; subject: string; message: string };

export async function getContactEmail(): Promise<string> {
  const response = await apiFetch('/api/contact/config');
  if (!response.ok) throw await readError(response, 'Contact details are unavailable.');
  const result = await response.json() as { email?: string };
  return result.email || '';
}

export async function sendContactMessage(message: ContactMessage): Promise<string> {
  const response = await apiFetch('/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  });
  if (!response.ok) throw await readError(response, 'We could not send your message. Please try again.');
  const result = await response.json() as { message?: string };
  return result.message || 'Your message has been sent. We’ll get back to you soon.';
}

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
  tasks?: MeetingTask[];
  transcript?: string;
};

export type MeetingTask = {
  id: string;
  meeting_id: string;
  meeting_title?: string;
  title: string;
  assignee: string;
  due_date: string | null;
  status: 'needs_review' | 'pending' | 'completed' | 'rejected';
  source_text?: string;
};

export type TaskChanges = Partial<Pick<MeetingTask, 'title' | 'assignee' | 'due_date' | 'status'>>;

export type MeetingWithTasks = MeetingRecord & { id: string; tasks?: MeetingTask[] };

export async function getCurrentUserEmail(): Promise<string> {
  const response = await apiFetch('/api/auth/me');
  if (!response.ok) throw await readError(response, 'Sign in to view your workspace tasks.');
  const result = await response.json() as { email?: string };
  return result.email || '';
}

export type MeetingStatistics = { total_meetings?: number; processed_meetings?: number; open_tasks?: number };
type MeetingsResponse = { meetings?: MeetingRecord[]; statistics?: MeetingStatistics };
type UploadResponse = { message?: string; filename?: string; detail?: string };

export type MeetingsResult = { records: MeetingRecord[] | null; statistics: MeetingStatistics | null };

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({})) as { detail?: string };
  return new Error(body.detail || fallback);
}

export async function checkBackend() {
  const response = await apiFetch('/health');
  if (!response.ok) throw await readError(response, 'Backend health check failed.');
}

export async function listMeetings(): Promise<MeetingsResult> {
  const response = await apiFetch('/api/meetings');
  if (!response.ok) throw await readError(response, 'Could not load meetings.');
  const data = await response.json() as MeetingsResponse | MeetingRecord[];
  if (Array.isArray(data)) return { records: data, statistics: null };
  return {
    records: Array.isArray(data.meetings) ? data.meetings : null,
    statistics: data.statistics ?? null,
  };
}

export async function updateMeetingTask(meetingId: string, taskId: string, changes: TaskChanges): Promise<MeetingTask> {
  const response = await apiFetch(`/api/meetings/${encodeURIComponent(meetingId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  if (!response.ok) throw await readError(response, 'Could not update the task. Please try again.');
  return response.json() as Promise<MeetingTask>;
}

export async function createMeetingTask(meetingId: string, task: { title: string; assignee: string; due_date: string | null }): Promise<MeetingTask> {
  const response = await apiFetch(`/api/meetings/${encodeURIComponent(meetingId)}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task),
  });
  if (!response.ok) throw await readError(response, 'Could not create the task. Please try again.');
  return response.json() as Promise<MeetingTask>;
}

export async function analyzeMeeting(meetingId: string): Promise<MeetingWithTasks> {
  const response = await apiFetch(`/api/meetings/${encodeURIComponent(meetingId)}/analyze`, { method: 'POST' });
  if (!response.ok) throw await readError(response, 'Could not analyze this meeting.');
  return response.json() as Promise<MeetingWithTasks>;
}

export async function uploadAudio(blob: Blob, filename: string) {
  const form = new FormData();
  form.append('file', blob, filename);
  const response = await apiFetch('/api/meetings/upload', { method: 'POST', body: form });
  if (!response.ok) throw await readError(response, 'Audio upload failed.');
  return await response.json() as UploadResponse;
}

