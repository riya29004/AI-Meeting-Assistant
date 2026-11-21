import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, AudioLines, BarChart3, Check, Circle, Headphones, ShieldCheck, Target, X } from 'lucide-react';
import CapturePanel from '../components/CapturePanel';
import TaskWorkspace from '../components/TaskWorkspace';
import Logo from '../components/Logo';
import { API_BASE, checkBackend, getCurrentUserEmail, listMeetings, type MeetingRecord, type MeetingStatistics, type MeetingWithTasks } from '../services/api';
import type { Navigate, Route, WorkspaceRole } from '../types';

type BackendStatus = 'checking' | 'online' | 'offline';

export default function WorkspacePage({ route, navigate, role, setRole }: {
  route: Route;
  navigate: Navigate;
  role: WorkspaceRole;
  setRole: (role: WorkspaceRole) => void;
}) {
  const [backend, setBackend] = useState<BackendStatus>('checking');
  const [meetings, setMeetings] = useState<MeetingWithTasks[] | null>(null);
  const [statistics, setStatistics] = useState<MeetingStatistics | null>(null);
  const [meetingsLoading, setMeetingsLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const isCapture = route === '/capture' || route === '/upload';
  const pageTitle = getPageTitle(route, role);
  const refreshData = useCallback(async () => { setRefreshKey((key) => key + 1); }, []);

  useEffect(() => {
    let active = true;
    setMeetingsLoading(true);
    setApiError('');
    checkBackend().then(() => {
      if (active) setBackend('online');
      return listMeetings();
    }).then((result) => {
      if (active) {
        setMeetings(result.records as MeetingWithTasks[] | null);
        setStatistics(result.statistics);
      }
    }).catch((reason: unknown) => {
      if (!active) return;
      setBackend('offline');
      setApiError(reason instanceof Error ? reason.message : 'Could not connect to the MeetMind backend.');
    }).finally(() => {
      if (active) setMeetingsLoading(false);
    });
    return () => { active = false; };
  }, [refreshKey]);

  useEffect(() => {
    let active = true;
    getCurrentUserEmail().then((email) => { if (active) setUserEmail(email); }).catch(() => { if (active) setUserEmail(''); });
    return () => { active = false; };
  }, [backend]);

  const isAdminMeetings = role === 'admin' && (route === '/app' || route === '/meetings');
  const pageHeading = isAdminMeetings ? 'Meetings' : isCapture
    ? 'Capture a meeting.'
    : route === '/meetings'
      ? role === 'admin' ? 'Meetings.' : 'Your meetings.'
      : route === '/review' ? 'Review AI suggestions.'
        : route === '/tasks' ? role === 'admin' ? 'Team tasks.' : 'Your assigned tasks.'
          : route === '/analytics' ? 'Meeting activity.'
            : role === 'assignee' ? 'Your work at a glance.' : 'Meeting workspace.';

  const pageDescription = isAdminMeetings ? 'Your meeting recordings and notes.' : isCapture
    ? 'Capture meeting-tab audio and your microphone separately.'
    : role === 'assignee' ? 'See the meetings and action items assigned to you.'
      : route === '/review' ? 'Check suggested action items before assigning them.'
        : route === '/tasks' ? 'Assign owners, set deadlines, and monitor progress.'
          : route === '/analytics' ? 'Review meeting duration and task progress from actual data.'
            : 'Manage meetings and the work that follows.';

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <button className="logo-button" onClick={() => navigate('/')} aria-label="MeetMind home"><Logo /></button>
        <div className="workspace-label">{role === 'admin' ? 'ADMIN' : 'ASSIGNEE'}</div>
        <button className={route === '/app' ? 'active' : ''} onClick={() => navigate('/app')}><Circle size={8} fill="currentColor" /> Overview</button>
        {role === 'admin' ? <>
          <button className={isCapture ? 'active' : ''} onClick={() => navigate('/capture')}><AudioLines size={16} /> Capture</button>
          <button className={route === '/meetings' ? 'active' : ''} onClick={() => navigate('/meetings')}><Headphones size={16} /> Meetings</button>
          <button className={route === '/review' ? 'active' : ''} onClick={() => navigate('/review')}><Check size={15} /> Review</button>
          <button className={route === '/tasks' ? 'active' : ''} onClick={() => navigate('/tasks')}><Target size={16} /> Tasks</button>
          <button className={route === '/analytics' ? 'active' : ''} onClick={() => navigate('/analytics')}><BarChart3 size={16} /> Analytics</button>
        </> : <>
          <button className={route === '/meetings' ? 'active' : ''} onClick={() => navigate('/meetings')}><Headphones size={16} /> My meetings</button>
          <button className={route === '/tasks' ? 'active' : ''} onClick={() => navigate('/tasks')}><Target size={16} /> My tasks</button>
        </>}
        <button className="workspace-back" onClick={() => navigate('/')}><ArrowRight size={15} /> Back to MeetMind</button>
      </aside>

      <main className="workspace-content">
        <header className="workspace-topbar">
          <div className="workspace-breadcrumb"><span>MeetMind</span><span>/</span><b>{pageTitle}</b></div>
          <div className="workspace-topbar-actions">
            <div className="role-preview" aria-label="Preview role">
              <span>PREVIEW</span>
              <button className={role === 'admin' ? 'selected' : ''} onClick={() => setRole('admin')}>Admin</button>
              <button className={role === 'assignee' ? 'selected' : ''} onClick={() => { setRole('assignee'); if (isCapture || route === '/review' || route === '/analytics') navigate('/app'); }}>Assignee</button>
            </div>
            <div className={`connection ${backend}`}><i />{backend === 'checking' ? 'Connecting' : backend === 'online' ? 'Connected' : 'Offline'}</div>
          </div>
        </header>

        <div className="workspace-page">
          {backend === 'offline' && <p className="api-status-message" role="status">{apiError || `Backend unavailable: ${API_BASE}`}</p>}
          <div className="workspace-page-heading">
            <div><h1>{pageHeading}</h1><p>{pageDescription}</p></div>
            {role === 'admin' && isAdminMeetings && <button className="primary-button" onClick={() => navigate('/capture')}><AudioLines size={15} /> New meeting</button>}
          </div>

          {isCapture && role === 'admin'
            ? <CapturePanel backendOnline={backend === 'online'} />
              : route === '/review' && role === 'admin'
                ? <TaskWorkspace mode="review" meetings={meetings} loading={meetingsLoading} error={apiError} role={role} email={userEmail} refresh={refreshData} />
                : route === '/tasks'
                  ? <TaskWorkspace mode="tasks" meetings={meetings} loading={meetingsLoading} error={apiError} role={role} email={userEmail} refresh={refreshData} />
              : route === '/analytics'
              ? <WorkspacePlaceholder route={route} role={role} />
              : role === 'assignee'
                ? <AssigneeOverview route={route} backend={backend} navigate={navigate} />
                : <AdminOverview meetings={meetings} statistics={statistics} meetingsLoading={meetingsLoading} />}
        </div>
      </main>
    </div>
  );
}

function getPageTitle(route: Route, role: WorkspaceRole) {
  if (route === '/capture' || route === '/upload') return 'Capture';
  if (route === '/meetings') return role === 'admin' ? 'Meetings' : 'My meetings';
  if (route === '/review') return 'Review';
  if (route === '/tasks') return role === 'admin' ? 'Tasks' : 'My tasks';
  if (route === '/analytics') return 'Analytics';
  return 'Overview';
}

function AdminOverview({ meetings, statistics, meetingsLoading }: {
  meetings: MeetingWithTasks[] | null;
  statistics: MeetingStatistics | null;
  meetingsLoading: boolean;
}) {
  const [selectedMeeting, setSelectedMeeting] = useState<MeetingRecord | null>(null);
  const total = statistics?.total_meetings ?? meetings?.length;
  const processed = statistics?.processed_meetings ?? getProcessedCount(meetings);
  const openTasks = statistics?.open_tasks ?? getOpenTaskCount(meetings);

  return (
    <>
      <dl className="meeting-stats" aria-label="Meeting statistics">
        <Stat label="Total meetings" value={total} />
        <Stat label="Processed meetings" value={processed} />
        <Stat label="Open tasks" value={openTasks} />
      </dl>
      <section className="workspace-recent">
        <div className="workspace-recent-heading"><h2>Recent Meetings</h2></div>
        {meetingsLoading ? <p className="workspace-recent-empty">Loading…</p>
          : meetings === null ? <p className="workspace-recent-empty">Meeting data unavailable.</p>
            : meetings.length === 0 ? <p className="workspace-recent-empty">No meetings yet.</p>
              : <div className="meeting-table-wrap"><table className="meeting-table"><thead><tr><th>Meeting</th><th>Date</th><th>Status</th><th>Tasks</th><th><span className="sr-only">Action</span></th></tr></thead><tbody>{meetings.map((meeting, index) => <tr key={String(meeting.id ?? index)}><td className="meeting-title-cell">{meeting.title || meeting.filename || 'Meeting'}</td><td>{formatMeetingDate(meeting)}</td><td><span className={`meeting-status ${getMeetingStatus(meeting).className}`}>{getMeetingStatus(meeting).label}</span></td><td>{getTaskCount(meeting) ?? '—'}</td><td><button className="meeting-open" onClick={() => setSelectedMeeting(meeting)}>Open</button></td></tr>)}</tbody></table></div>}
      </section>
      {selectedMeeting && <MeetingDetails meeting={selectedMeeting} onClose={() => setSelectedMeeting(null)} />}
    </>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return <div className="meeting-stat"><dt>{label}</dt><dd>{value ?? '—'}</dd></div>;
}

function getProcessedCount(meetings: MeetingRecord[] | null) {
  if (!meetings) return undefined;
  if (meetings.length === 0) return 0;
  if (meetings.some((meeting) => !meeting.status && !meeting.processing_status)) return undefined;
  return meetings.filter((meeting) => ['completed', 'processed', 'complete'].includes((meeting.processing_status || meeting.status || '').toLowerCase())).length;
}

function getOpenTaskCount(meetings: MeetingRecord[] | null) {
  if (!meetings?.length || meetings.some((meeting) => !Array.isArray(meeting.tasks) || meeting.tasks.some((task) => !task.status))) return undefined;
  return meetings.reduce((count, meeting) => count + (meeting.tasks?.filter((task) => task.status?.toLowerCase() !== 'completed').length ?? 0), 0);
}

function getTaskCount(meeting: MeetingRecord) {
  return Array.isArray(meeting.tasks) ? meeting.tasks.length : meeting.task_count;
}

function formatMeetingDate(meeting: MeetingRecord) {
  const value = meeting.meeting_date || meeting.date || meeting.created_at;
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function getMeetingStatus(meeting: MeetingRecord) {
  const status = (meeting.processing_status || meeting.status || '').toLowerCase();
  if (!status) return { label: '—', className: 'unknown' };
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  return { label, className: status.replace(/[^a-z0-9-]/g, '-') };
}

function MeetingDetails({ meeting, onClose }: { meeting: MeetingRecord; onClose: () => void }) {
  return <div className="meeting-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="meeting-modal" role="dialog" aria-modal="true" aria-labelledby="meeting-modal-title"><button className="meeting-modal-close" onClick={onClose} aria-label="Close meeting details"><X size={16} /></button><h2 id="meeting-modal-title">{meeting.title || meeting.filename || 'Meeting'}</h2><dl><div><dt>Date</dt><dd>{formatMeetingDate(meeting)}</dd></div><div><dt>Status</dt><dd>{getMeetingStatus(meeting).label}</dd></div><div><dt>Tasks</dt><dd>{getTaskCount(meeting) ?? '—'}</dd></div></dl></section></div>;
}

function AssigneeOverview({ route, backend, navigate }: { route: Route; backend: BackendStatus; navigate: Navigate }) {
  const meetingsPage = route === '/meetings';
  return <section className="assignee-dashboard"><div className="assignee-welcome"><span className="assignee-welcome-icon">{meetingsPage ? <Headphones size={17} /> : <Target size={17} />}</span><div><h2>{meetingsPage ? 'Meetings shared with you' : 'Your assigned tasks'}</h2><p>{meetingsPage ? 'Review the meeting details relevant to your work.' : 'Track deadlines and update your task progress.'}</p></div></div><div className="assignee-empty"><strong>{backend === 'checking' ? 'Connecting to your workspace…' : meetingsPage ? 'No assigned meetings to show' : 'No tasks assigned to you yet'}</strong><span>{backend === 'online' ? 'The current backend does not provide assignee-specific data.' : 'Check the backend connection and try again.'}</span></div><div className="assignee-shortcuts">{!meetingsPage && <button onClick={() => navigate('/tasks')}><Target size={14} /> My tasks <ArrowRight size={13} /></button>}<button onClick={() => navigate('/meetings')}><Headphones size={14} /> My meetings <ArrowRight size={13} /></button></div></section>;
}

function WorkspacePlaceholder({ route, role }: { route: Route; role: WorkspaceRole }) {
  const content = role === 'assignee' && route === '/tasks'
    ? { eyebrow: 'MY TASKS', title: 'Your assigned tasks', body: 'See task details, deadlines, and update the status of work assigned to you.', missing: 'The backend does not yet provide authentication or an assignee-specific task endpoint.' }
    : route === '/review'
      ? { eyebrow: 'ACTION ITEMS', title: 'Review suggested tasks', body: 'Confirm, edit, or reject AI suggestions before the Admin assigns them.', missing: 'The backend does not yet provide transcript, AI analysis, or review endpoints.' }
      : route === '/tasks'
        ? { eyebrow: 'TASK MANAGEMENT', title: 'Team tasks', body: 'Assign owners, set deadlines, and monitor progress across meetings.', missing: 'The backend does not yet provide user, task, status, or reminder endpoints.' }
        : { eyebrow: 'ANALYTICS', title: 'Meeting and task activity', body: 'Review meeting duration, completion, overdue tasks, and workload from actual data.', missing: 'The backend does not yet provide analytics data or Power BI configuration.' };

  return <section className="pipeline-placeholder"><span className="capture-kicker">{content.eyebrow}</span><h2>{content.title}</h2><p>{content.body}</p><div className="pipeline-placeholder-state"><span className="pipeline-placeholder-icon"><ShieldCheck size={18} /></span><div><strong>Waiting for backend support</strong><small>{content.missing}</small></div></div></section>;
}
