import { useState, type FormEvent } from 'react';
import { Check, Circle, LoaderCircle, Plus, RefreshCw, Save, X } from 'lucide-react';
import { analyzeMeeting, createMeetingTask, updateMeetingTask, type MeetingTask, type MeetingWithTasks, type TaskChanges } from '../services/api';
import type { WorkspaceRole } from '../types';

type WorkspaceMode = 'review' | 'tasks';

export default function TaskWorkspace({ mode, meetings, loading, error, role, email, refresh }: {
  mode: WorkspaceMode;
  meetings: MeetingWithTasks[] | null;
  loading: boolean;
  error: string;
  role: WorkspaceRole;
  email: string;
  refresh: () => Promise<void>;
}) {
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [analyzingId, setAnalyzingId] = useState('');
  const [creating, setCreating] = useState(false);
  const allTasks = (meetings || []).flatMap((meeting) => (meeting.tasks || []).map((task) => ({
    ...task,
    meeting_id: task.meeting_id || String(meeting.id),
    meeting_title: meeting.title || 'Meeting',
  })));
  const pendingReview = allTasks.filter((task) => task.status === 'needs_review');
  const visibleTasks = role === 'assignee'
    ? allTasks.filter((task) => task.assignee.trim().toLowerCase() === email.trim().toLowerCase() && task.status !== 'rejected')
    : allTasks;
  const meetingsToAnalyze = (meetings || []).filter((meeting) =>
    Boolean(meeting.id && meeting.transcript?.trim()) && !(meeting.tasks || []).some((task) => task.status === 'needs_review'),
  );

  async function updateTask(task: MeetingTask, changes: TaskChanges) {
    setActionError('');
    setNotice('');
    await updateMeetingTask(task.meeting_id, task.id, changes);
    await refresh();
  }

  async function runAnalysis(meeting: MeetingWithTasks) {
    if (!meeting.id) return;
    setAnalyzingId(meeting.id);
    setActionError('');
    setNotice('');
    try {
      await analyzeMeeting(meeting.id);
      setNotice(`Analysis finished for “${meeting.title || 'Meeting'}”.`);
      await refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not analyze this meeting.');
    } finally {
      setAnalyzingId('');
    }
  }

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    const meetingId = String(data.get('meeting_id') || '');
    const title = String(data.get('title') || '').trim();
    if (!meetingId || !title || creating) return;
    setCreating(true);
    setActionError('');
    setNotice('');
    try {
      await createMeetingTask(meetingId, {
        title,
        assignee: String(data.get('assignee') || '').trim(),
        due_date: String(data.get('due_date') || '') || null,
      });
      formElement.reset();
      setNotice('Task added to review. Confirm it when it is ready to track.');
      await refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not create the task.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="task-workspace" aria-label={mode === 'review' ? 'Review suggested tasks' : 'Workspace tasks'}>
      {actionError && <p className="task-feedback error" role="alert">{actionError}</p>}
      {notice && <p className="task-feedback success" role="status">{notice}</p>}
      {error && <p className="task-feedback error" role="alert">{error}</p>}
      {loading ? <p className="workspace-recent-empty">Loading tasks…</p> : meetings === null ? <p className="workspace-recent-empty">Task data is unavailable. Check your connection and try again.</p> : mode === 'review' ? (
        <>
          <div className="task-section-heading"><div><h2>Suggested tasks to review</h2><p>Review AI suggestions, edit details, then confirm or reject each task.</p></div><span className="task-count">{pendingReview.length} to review</span></div>
          {pendingReview.length > 0 ? <div className="task-card-list">
            {pendingReview.map((task) => <ReviewTaskCard key={task.id} task={task} onError={setActionError} onNotice={setNotice} onRefresh={refresh} />)}
          </div> : <div className="task-empty-state"><span className="pipeline-placeholder-icon"><Check size={17} /></span><div><b>Nothing to review</b><small>New AI suggestions will appear here after meeting analysis.</small></div></div>}
          {meetingsToAnalyze.length > 0 && <div className="analyze-meeting-list">
            <div className="task-section-heading"><div><h2>Analyze a meeting</h2><p>Run analysis on a saved transcript to generate review suggestions.</p></div></div>
            {meetingsToAnalyze.map((meeting) => <div className="analyze-meeting-row" key={meeting.id}>
              <div><b>{meeting.title || 'Meeting'}</b><small>{meeting.status ? `Status: ${meeting.status}` : 'Transcript available'}</small></div>
              <button className="small-action-button" disabled={Boolean(analyzingId)} onClick={() => void runAnalysis(meeting)}>{analyzingId === meeting.id ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />} Analyze</button>
            </div>)}
          </div>}
        </>
      ) : (
        <>
          {role === 'admin' && meetings.some((meeting) => Boolean(meeting.id)) && <form className="create-task-form" onSubmit={(event) => void addTask(event)}>
            <div className="task-section-heading"><div><h2>Add a task</h2><p>Create a task for a meeting, then confirm it from Review.</p></div></div>
            <div className="create-task-fields">
              <label>Meeting<select name="meeting_id" required defaultValue=""><option value="" disabled>Select a meeting</option>{meetings.filter((meeting) => meeting.id).map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.title || 'Meeting'}</option>)}</select></label>
              <label>Task title<input name="title" required maxLength={300} placeholder="What needs to be done?" /></label>
              <label>Assignee email<input name="assignee" type="email" maxLength={160} placeholder="name@example.com" /></label>
              <label>Due date<input name="due_date" type="date" /></label>
              <button className="small-action-button" type="submit" disabled={creating}>{creating ? <LoaderCircle size={13} className="spin" /> : <Plus size={13} />} Add task</button>
            </div>
          </form>}
          <div className="task-section-heading task-list-heading"><div><h2>{role === 'assignee' ? 'Tasks assigned to you' : 'All workspace tasks'}</h2><p>{role === 'assignee' ? `Showing tasks assigned to ${email || 'your account'}.` : 'Update task owners, due dates, and progress.'}</p></div><span className="task-count">{visibleTasks.length} task{visibleTasks.length === 1 ? '' : 's'}</span></div>
          {visibleTasks.length > 0 ? <div className="task-card-list">
            {visibleTasks.map((task) => <EditableTaskCard key={task.id} task={task} onSave={updateTask} />)}
          </div> : <div className="task-empty-state"><span className="pipeline-placeholder-icon"><Circle size={16} /></span><div><b>{role === 'assignee' ? 'No tasks assigned yet' : 'No tasks yet'}</b><small>{role === 'assignee' ? 'Tasks assigned to your account will appear here.' : 'Tasks created from meeting analysis will appear here.'}</small></div></div>}
        </>
      )}
    </section>
  );
}

function ReviewTaskCard({ task, onError, onNotice, onRefresh }: {
  task: MeetingTask;
  onError: (error: string) => void;
  onNotice: (notice: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [assignee, setAssignee] = useState(task.assignee || '');
  const [dueDate, setDueDate] = useState(task.due_date?.slice(0, 10) || '');
  const [busy, setBusy] = useState(false);

  async function decide(status: 'pending' | 'rejected') {
    if (busy) return;
    if (status === 'pending' && !title.trim()) { onError('Add a task title before confirming it.'); return; }
    setBusy(true);
    onError('');
    onNotice('');
    try {
      const changes: TaskChanges = status === 'pending'
        ? { title: title.trim(), assignee: assignee.trim(), due_date: dueDate || null, status }
        : { status };
      await updateMeetingTask(task.meeting_id, task.id, changes);
      onNotice(status === 'pending' ? 'Task confirmed and added to your task list.' : 'Suggestion rejected.');
      await onRefresh();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Could not update this suggestion.');
    } finally {
      setBusy(false);
    }
  }

  return <form className="workspace-task-card" onSubmit={(event) => { event.preventDefault(); void decide('pending'); }}>
    <div className="workspace-task-context"><b>{task.meeting_title}</b>{task.source_text && <small>“{task.source_text}”</small>}</div>
    <div className="workspace-task-fields">
      <label>Task<input required maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Assignee email<input type="email" maxLength={160} placeholder="name@example.com" value={assignee} onChange={(event) => setAssignee(event.target.value)} /></label>
      <label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
    </div>
    <div className="workspace-task-actions"><button className="small-action-button secondary" type="button" disabled={busy} onClick={() => void decide('rejected')}><X size={13} /> Reject</button><button className="small-action-button" type="submit" disabled={busy}>{busy ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />} Confirm task</button></div>
  </form>;
}

function EditableTaskCard({ task, onSave }: { task: MeetingTask; onSave: (task: MeetingTask, changes: TaskChanges) => Promise<void> }) {
  const [title, setTitle] = useState(task.title);
  const [assignee, setAssignee] = useState(task.assignee || '');
  const [dueDate, setDueDate] = useState(task.due_date?.slice(0, 10) || '');
  const [status, setStatus] = useState<MeetingTask['status']>(task.status);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !title.trim()) return;
    setBusy(true);
    setFeedback('');
    try {
      await onSave(task, { title: title.trim(), assignee: assignee.trim(), due_date: dueDate || null, status });
      setFeedback('Saved');
    } catch (reason) {
      setFeedback(reason instanceof Error ? reason.message : 'Could not save changes.');
    } finally {
      setBusy(false);
    }
  }

  return <form className="workspace-task-card editable-task-card" onSubmit={(event) => void save(event)}>
    <div className="workspace-task-context"><b>{task.meeting_title}</b>{task.source_text && <small>“{task.source_text}”</small>}</div>
    <div className="workspace-task-fields">
      <label>Task<input required maxLength={300} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Assignee email<input type="email" maxLength={160} placeholder="name@example.com" value={assignee} onChange={(event) => setAssignee(event.target.value)} /></label>
      <label>Due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as MeetingTask['status'])}><option value="needs_review">Needs review</option><option value="pending">Pending</option><option value="completed">Completed</option><option value="rejected">Rejected</option></select></label>
    </div>
    <div className="workspace-task-actions"><small className={feedback.includes('Could not') ? 'task-inline-error' : 'task-inline-note'} role="status">{feedback}</small><button className="small-action-button" type="submit" disabled={busy}>{busy ? <LoaderCircle size={13} className="spin" /> : <Save size={13} />} Save changes</button></div>
  </form>;
}
