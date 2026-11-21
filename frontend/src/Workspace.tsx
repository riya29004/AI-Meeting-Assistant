/** Workspace screens and local audio-capture workflow for MeetMind. */
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Check, Circle, Download, FileText, Headphones, LoaderCircle, Mic, Play, RefreshCw, Square, Trash2, Wifi, X } from 'lucide-react';
import { API_BASE as API, apiFetch, audioSocketUrl } from './services/api';
import './workspace.css';

type Task = { id: string; title: string; assignee: string; due_date: string | null; status: 'needs_review' | 'pending' | 'completed' | 'rejected'; source_text?: string };
type TranscriptSegment = { start: number; end: number; speaker?: string | null; text: string };
type Meeting = { id: string; title: string; status: string; created_at: string; started_at?: string; ended_at?: string; transcript?: string; segments?: TranscriptSegment[]; summary?: string; key_points?: string[]; decisions?: string[]; tasks?: Task[]; error?: string };

export default function Workspace({ onBack }: { onBack: () => void }) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [title, setTitle] = useState('');
  const [active, setActive] = useState<Meeting | null>(null);
  const [status, setStatus] = useState('ready');
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState('');
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<string[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [view, setView] = useState<'meetings' | 'tasks' | 'analytics' | 'team'>('meetings');
  const [currentEmail, setCurrentEmail] = useState('');
  const [members, setMembers] = useState<{ id: string; email: string; role: string }[]>([]);
  const [inviteCode, setInviteCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [remindersOn, setRemindersOn] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const dataQueueRef = useRef<Promise<void>>(Promise.resolve());
  const remindedRef = useRef<Set<string>>(new Set());

  const loadMeetings = useCallback(async () => {
    try {
      const response = await apiFetch(`${API}/api/meetings`);
      if (response.status === 401) { window.location.replace('/login'); return; }
      if (!response.ok) throw new Error();
      setMeetings(await response.json());
      const profile = await apiFetch(`${API}/api/auth/me`); if (profile.ok) setCurrentEmail((await profile.json()).email);
      setError('');
    } catch { setError('Cannot reach the local backend. Start FastAPI on port 8000 and try again.'); }
  }, []);
  useEffect(() => { void loadMeetings(); return () => { if (timerRef.current) window.clearInterval(timerRef.current); }; }, [loadMeetings]);
  useEffect(() => { if (view === 'team') void apiFetch(`${API}/api/auth/workspace/members`).then(async response => { if (response.ok) setMembers(await response.json()); }); }, [view]);
  useEffect(() => {
    if (!active || status !== 'recording') return;
    const interval = window.setInterval(() => setSeconds(value => value + 1), 1000);
    timerRef.current = interval;
    return () => window.clearInterval(interval);
  }, [active, status]);
  useEffect(() => {
    if (!remindersOn || !('Notification' in window) || Notification.permission !== 'granted') return;
    const check = () => {
      const today = new Date().toLocaleDateString('sv-SE');
      for (const meeting of meetings) for (const task of meeting.tasks || []) {
        if (!task.due_date || task.status === 'completed' || task.status === 'rejected') continue;
        const reminderKey = task.id + ":" + today;
        if (task.due_date.slice(0, 10) <= today && !remindedRef.current.has(reminderKey)) { new Notification('MeetMind task due', { body: task.title }); remindedRef.current.add(reminderKey); }
      }
    };
    check(); const interval = window.setInterval(check, 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [meetings, remindersOn]);

  const showMeeting = useCallback((meeting: Meeting) => {
    const savedTranscript = meeting.transcript || (meeting.segments || []).map(segment => `[${Number(segment.start).toFixed(1)}s] ${segment.speaker ? `${segment.speaker}: ` : ''}${segment.text}`).join('\n');
    setActive(meeting); setStatus(meeting.status); setTranscript(savedTranscript); setSummary(meeting.summary || '');
    setKeyPoints(meeting.key_points || []); setDecisions(meeting.decisions || []); setTasks(meeting.tasks || []); setError(meeting.error || '');
  }, []);
  const startMeeting = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setTranscript(''); setSeconds(0); setBusy(true);
    try {
      // getDisplayMedia must run directly from the Start button gesture.
      let tab: MediaStream;
      try { tab = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); }
      catch { throw new Error('Tab sharing was cancelled or unavailable. Allow tab sharing with audio to record.'); }
      streamsRef.current.push(tab);
      let mic: MediaStream;
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch (permissionError) { throw new Error(permissionError instanceof DOMException && permissionError.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access in your browser settings.' : 'Microphone access is unavailable. Check the selected input device.'); }
      streamsRef.current.push(mic);
      const response = await apiFetch(`${API}/api/meetings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() }) });
      if (!response.ok) throw new Error('Could not create meeting. Check the title and backend.');
      const createdMeeting = await response.json() as Meeting;
      const context = new AudioContext(); audioContextRef.current = context;
      const destination = context.createMediaStreamDestination();
      for (const stream of [mic, tab]) if (stream.getAudioTracks().length) context.createMediaStreamSource(stream).connect(destination);
      if (!tab.getAudioTracks().length) throw new Error('No tab audio was shared. Choose a browser tab and enable “Share tab audio”.');
      let socketOpened = false;
      let terminalReceived = false;
      const stopCaptureAfterFailure = () => {
        const currentRecorder = recorderRef.current;
        if (currentRecorder && currentRecorder.state !== 'inactive') {
          currentRecorder.onstop = null;
          currentRecorder.stop();
        }
        cleanupAudio();
      };
      const failSession = (message: string) => {
        if (terminalReceived) return;
        terminalReceived = true;
        setStatus('failed'); setError(message); stopCaptureAfterFailure();
        void reloadMeeting(createdMeeting.id);
      };
      const socket = new WebSocket(audioSocketUrl(createdMeeting.id)); socketRef.current = socket;
      socket.onmessage = message => {
        try {
          const data = JSON.parse(message.data);
          if (data.type === 'status') setStatus(data.status);
          if (data.type === 'transcript' && data.segment?.text) setTranscript(current => `${current}${current ? '\n' : ''}[${Number(data.segment.start).toFixed(1)}s] ${data.segment.speaker ? data.segment.speaker + ': ' : ''}${data.segment.text}`);
          if (data.type === 'notice') setError(data.message || 'Transcription is taking longer than expected.');
          if (data.type === 'complete') {
            terminalReceived = true;
            setStatus(data.status); setTranscript(data.transcript || ''); setSummary(data.analysis?.summary || '');
            setKeyPoints(data.analysis?.key_points || []); setDecisions(data.analysis?.decisions || []); setError(data.message || '');
            cleanupAudio();
            void reloadMeeting(createdMeeting.id);
          }
          if (data.type === 'error') failSession(data.message || 'The backend stopped processing this recording.');
        } catch {
          failSession('The backend sent an unreadable response. Check its terminal for details.');
        }
      };
      const socketReady = new Promise<void>((resolve, reject) => {
        socket.onopen = () => { socketOpened = true; resolve(); };
        socket.onerror = () => {
          if (!socketOpened) reject(new Error('Audio connection failed. Check that the backend is running.'));
          else failSession('Audio connection failed while processing. The recording was saved when available.');
        };
        socket.onclose = () => {
          if (!socketOpened) reject(new Error('Could not open the audio connection.'));
          else if (!terminalReceived) failSession('The backend connection closed before processing finished. Check meeting history for the saved status.');
        };
      });
      await socketReady;
      socket.send(JSON.stringify({ type: 'start' }));
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(destination.stream, { mimeType }); recorderRef.current = recorder;
      dataQueueRef.current = Promise.resolve();
      recorder.ondataavailable = chunk => {
        if (!chunk.data.size || terminalReceived) return;
        dataQueueRef.current = dataQueueRef.current.then(async () => {
          const bytes = await chunk.data.arrayBuffer();
          if (socket.readyState !== WebSocket.OPEN) throw new Error('Audio WebSocket is no longer connected.');
          socket.send(bytes);
        }).catch(() => failSession('Audio could not be sent to the backend. The recording has stopped.'));
      };
      recorder.start(3000);
      showMeeting(createdMeeting); setStatus('recording'); setTitle('');
      tab.getVideoTracks().forEach(track => track.addEventListener('ended', () => { if (recorder.state !== 'inactive') stopMeeting(); }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the meeting.'); cleanupAudio(); setStatus('failed');
    } finally { setBusy(false); }
  };
  const cleanupAudio = useCallback(() => {
    streamsRef.current.forEach(stream => stream.getTracks().forEach(track => track.stop())); streamsRef.current = [];
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') void audioContextRef.current.close(); audioContextRef.current = null;
  }, []);
  const reloadMeeting = useCallback(async (id: string) => {
    try { const response = await apiFetch(`${API}/api/meetings/${id}`); if (response.ok) showMeeting(await response.json()); await loadMeetings(); }
    catch { /* keep the results already delivered through the socket */ }
  }, [loadMeetings, showMeeting]);
  const activeMeetingId = active?.id;
  useEffect(() => {
    if (!activeMeetingId || status !== 'processing') return;
    let stopped = false;
    let missedResponses = 0;
    const poll = async () => {
      try {
        const response = await apiFetch(`${API}/api/meetings/${activeMeetingId}`);
        if (!response.ok) throw new Error(`Meeting status request failed (${response.status}).`);
        missedResponses = 0;
        const meeting = await response.json() as Meeting;
        if (!stopped && meeting.status !== 'processing') {
          showMeeting(meeting);
          void loadMeetings();
        }
      } catch {
        missedResponses += 1;
        if (!stopped && missedResponses >= 3) {
          setStatus('failed');
          setError('The backend stopped responding while processing. Check the backend terminal; any saved audio remains in meeting history.');
          cleanupAudio();
        }
      }
    };
    const interval = window.setInterval(() => void poll(), 5000);
    return () => { stopped = true; window.clearInterval(interval); };
  }, [activeMeetingId, status, showMeeting, loadMeetings, cleanupAudio]);
  const stopMeeting = () => {
    if (status !== 'recording') return;
    const recorder = recorderRef.current;
    const socket = socketRef.current;
    setStatus('processing'); setError('');
    const sendStopAfterQueuedAudio = async () => {
      try {
        await dataQueueRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('Audio connection closed before the final audio chunk was sent.');
        socket.send(JSON.stringify({ type: 'stop' }));
      } catch {
        setStatus('failed');
        setError('Could not finish sending audio to the backend. Check the backend terminal; the recording may be retained.');
        cleanupAudio();
        if (active) void reloadMeeting(active.id);
      }
    };
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => { cleanupAudio(); void sendStopAfterQueuedAudio(); };
      recorder.stop();
    } else {
      cleanupAudio(); void sendStopAfterQueuedAudio();
    }
  };
  const patchTask = async (task: Task, changes: Partial<Task>) => {
    if (!active) return;
    const response = await apiFetch(`${API}/api/meetings/${active.id}/tasks/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
    if (response.ok) { const updated = await response.json(); setTasks(current => current.map(item => item.id === task.id ? updated : item)); await loadMeetings(); }
    else setError('Could not update task. Please retry.');
  };
  const analyzeAgain = async () => {
    if (!active) return; setBusy(true); setError('');
    try { const response = await apiFetch(`${API}/api/meetings/${active.id}/analyze`, { method: 'POST' }); const result = await response.json(); if (!response.ok) throw new Error(result.detail || 'Analysis failed.'); showMeeting(result); await loadMeetings(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Analysis failed.'); }
    finally { setBusy(false); }
  };
  const deleteMeeting = async () => {
    if (!active || !window.confirm(`Delete “${active.title}” and its local recording?`)) return;
    const response = await apiFetch(`${API}/api/meetings/${active.id}`, { method: 'DELETE' });
    if (response.ok) { setActive(null); setStatus('ready'); setTranscript(''); setSummary(''); setTasks([]); await loadMeetings(); }
    else setError('Could not delete meeting.');
  };
  const signOut = async () => { await apiFetch(`${API}/api/auth/logout`, { method: 'POST' }); window.location.replace('/login'); };
  const makeInvite = async () => { const response = await apiFetch(`${API}/api/auth/workspace/invitations`, { method: 'POST' }); if (response.ok) setInviteCode((await response.json()).code); else setError('Only a workspace owner can create an invite.'); };
  const joinWorkspace = async (event: FormEvent) => { event.preventDefault(); const response = await apiFetch(`${API}/api/auth/workspace/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: joinCode }) }); const result = await response.json(); if (response.ok) { setJoinCode(''); setError(result.message || 'Joined workspace.'); await loadMeetings(); } else setError(result.detail || 'Could not join workspace.'); };
  const enableReminders = async () => {
    if (!('Notification' in window)) { setError('This browser does not support desktop reminders.'); return; }
    const permission = await Notification.requestPermission(); setRemindersOn(permission === 'granted');
    if (permission !== 'granted') setError('Enable browser notifications to receive local due-date reminders.');
  };
  const formatTime = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  const allTasks = meetings.flatMap(meeting => (meeting.tasks || []).map(task => ({ ...task, meeting_title: meeting.title })));
  const completedCount = allTasks.filter(task => task.status === 'completed').length;
  const pendingCount = allTasks.filter(task => task.status === 'pending' || task.status === 'needs_review').length;
  const download = (url: string) => { const anchor = document.createElement('a'); anchor.href = url; anchor.click(); };

  return <div className="workspace"><header className="workspace-header"><button className="ws-back" onClick={onBack}><ArrowLeft size={16} /> MeetMind</button><span className="ws-local"><Circle size={8} fill="currentColor" /> {currentEmail || 'Local workspace'}</span><button className="ws-signout" onClick={() => void signOut()}>Sign out</button></header><div className="workspace-layout"><aside className="meeting-sidebar"><div className="sidebar-heading"><span>WORKSPACE</span><button onClick={() => { setActive(null); setStatus('ready'); setError(''); setView('meetings'); }}>＋ New</button></div><nav className="workspace-tabs"><button className={view === 'meetings' ? 'chosen' : ''} onClick={() => setView('meetings')}><FileText size={14} /> Meetings</button><button className={view === 'tasks' ? 'chosen' : ''} onClick={() => setView('tasks')}><Check size={14} /> Tasks</button><button className={view === 'analytics' ? 'chosen' : ''} onClick={() => setView('analytics')}><CalendarDays size={14} /> Analytics</button><button className={view === 'team' ? 'chosen' : ''} onClick={() => setView('team')}><Circle size={14} /> Team</button></nav>{view === 'meetings' && <><div className="sidebar-heading history-label"><span>MEETING HISTORY</span><button className="icon-button" aria-label="Refresh history" onClick={() => void loadMeetings()}><RefreshCw size={12} /></button></div><div className="meeting-list">{meetings.map(meeting => <button key={meeting.id} className={`meeting-list-item ${active?.id === meeting.id ? 'selected' : ''}`} onClick={() => showMeeting(meeting)}><span>{meeting.title}</span><small>{new Date(meeting.created_at).toLocaleString()}</small><em>{meeting.status}</em></button>)}{meetings.length === 0 && <p className="empty-list">Your saved meetings will appear here.</p>}</div></>}<div className="sidebar-note">Capture only meetings you are authorized to record. Local recordings stay on this machine.</div></aside><main className="meeting-main">
    {view === 'team' ? <><div className="meeting-title-row"><div><small>SHARED WORKSPACE</small><h1>Team members</h1><p>Invite someone by sharing a one-time code. Codes expire after seven days.</p></div></div><div className="team-card"><h2>Members</h2>{members.map(member => <div className="member-row" key={member.id}><span>{member.email}</span><small>{member.role}</small></div>)}<button className="small-button" onClick={() => void makeInvite()}>Create invitation code</button>{inviteCode && <div className="invite-code"><b>Share this code once</b><code>{inviteCode}</code><small>It grants access to this workspace and expires in seven days.</small></div>}<form className="join-form" onSubmit={joinWorkspace}><label>Join another workspace<input required minLength={20} maxLength={128} value={joinCode} onChange={event => setJoinCode(event.target.value)} placeholder="Paste invitation code" /></label><button className="small-button" type="submit">Join workspace</button></form></div></> : view === 'analytics' ? <><div className="meeting-title-row"><div><small>WORKSPACE OVERVIEW</small><h1>Meeting analytics</h1><p>Calculated from meetings stored on this device.</p></div></div><div className="analytics-cards"><div><b>{meetings.length}</b><span>Meetings saved</span></div><div><b>{Math.round(meetings.reduce((sum, m) => sum + (m.started_at && m.ended_at ? (new Date(m.ended_at).getTime() - new Date(m.started_at).getTime()) / 3600000 : 0), 0) * 10) / 10}h</b><span>Meeting time</span></div><div><b>{allTasks.length}</b><span>Suggested tasks</span></div><div><b>{allTasks.length ? Math.round(completedCount / allTasks.length * 100) : 0}%</b><span>Task completion</span></div></div><div className="task-toolbar"><button onClick={() => download(`${API}/api/meetings/calendar/export.ics`)}><CalendarDays size={14} /> Export due dates to calendar (.ics)</button></div></> : view === 'tasks' ? <><div className="meeting-title-row"><div><small>WORKSPACE TASKS</small><h1>Action items</h1><p>Confirm tasks to track them. Assignees receive reminders when tasks are due and daily while overdue.</p></div><button className="small-button" onClick={enableReminders}>Enable browser reminders</button></div><div className="task-toolbar"><button onClick={() => download(`${API}/api/meetings/calendar/export.ics`)}><CalendarDays size={14} /> Export calendar (.ics)</button><span>{pendingCount} open · {completedCount} completed</span></div><div className="task-list">{allTasks.map(task => <article className="task-card" key={task.id}><div><b>{task.title}</b><small>From {task.meeting_title}{task.source_text ? ` · “${task.source_text}”` : ''}</small></div><label>Assignee email<input type="email" placeholder="name@example.com" defaultValue={task.assignee || ''} onBlur={event => { if (event.target.value !== (task.assignee || '')) void patchTask(task, { assignee: event.target.value }); }} /></label><label>Due date<input type="date" value={task.due_date?.slice(0, 10) || ''} onChange={event => void patchTask(task, { due_date: event.target.value || null })} /></label><select aria-label="Task status" value={task.status} onChange={event => void patchTask(task, { status: event.target.value as Task['status'] })}><option value="needs_review">Needs review</option><option value="pending">Pending</option><option value="completed">Completed</option><option value="rejected">Rejected</option></select></article>)}{allTasks.length === 0 && <p className="empty-list">No action items yet. Meeting analysis can suggest tasks after transcription.</p>}</div></> : <><div className="meeting-title-row"><div><small>{active ? 'MEETING DETAILS' : 'MEETING WORKSPACE'}</small><h1>{active?.title || 'Start a meeting'}</h1><p>{active ? `Status: ${status}` : 'Capture audio and save a local meeting record.'}</p></div>{active && status === 'recording' && <span className="recording-pill"><i /> Recording {formatTime(seconds)}</span>}</div>{!active && <form className="start-card" onSubmit={startMeeting}><div className="start-icon"><Headphones size={20} /></div><h2>Start a new meeting</h2><p>We’ll request permission to share a browser tab with audio and access your microphone.</p><label>Meeting title<input required maxLength={160} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Product planning" /></label><button className="start-button" disabled={busy} type="submit">{busy ? <LoaderCircle size={15} /> : <Play size={15} fill="currentColor" />} Start meeting</button><small>In the browser sharing prompt, select the meeting tab and enable “Share tab audio”.</small></form>}{active && <><section className="live-card"><div className="live-card-heading"><span><Wifi size={15} /> AUDIO SESSION</span><span>{status.toUpperCase()}</span></div>{status === 'recording' || status === 'processing' ? <><div className="audio-sources"><div><Mic size={16} /><span><b>Microphone</b><small>Browser capture</small></span><i /></div><div><Headphones size={16} /><span><b>Meeting tab</b><small>Shared tab audio</small></span><i /></div></div>{status === 'recording' && <button className="stop-button" onClick={stopMeeting}><Square size={13} fill="currentColor" /> Stop and process meeting</button>}{status === 'processing' && <p className="processing-note"><LoaderCircle size={15} /> Finalizing transcript and meeting analysis…</p>}</> : <div className="meeting-actions"><button className="small-button" disabled={!transcript || busy} onClick={() => void analyzeAgain()}><RefreshCw size={13} /> Analyze again</button><button className="small-button" onClick={() => download(`${API}/api/meetings/${active.id}/minutes`)}><Download size={13} /> Download minutes</button><button className="icon-button danger" aria-label="Delete meeting" onClick={() => void deleteMeeting()}><Trash2 size={14} /></button></div>}{summary && <div className="result-block"><h3>Summary</h3><p>{summary}</p></div>}{keyPoints.length > 0 && <div className="result-block"><h3>Key points</h3><ul>{keyPoints.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}{decisions.length > 0 && <div className="result-block"><h3>Decisions</h3><ul>{decisions.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}{tasks.length > 0 && <div className="result-block"><h3>Suggested tasks</h3>{tasks.map(task => <div className="result-task" key={task.id}><Check size={13} /><span><b>{task.title}</b><small>{task.assignee || 'Unassigned'} · {task.due_date || 'No due date'} · {task.status.replace('_', ' ')}</small></span><button onClick={() => void patchTask(task, { status: 'pending' })}>Confirm</button></div>)}</div>}{transcript && <div className="transcript-block"><h3>Transcript</h3><p>{transcript}</p></div>}</section>{active.error && !error && <div className="ws-alert"><X size={15} />{active.error}</div>}</>}{error && <div className="ws-alert"><X size={15} />{error}</div>}<div className="workspace-footnote">Local prototype · recordings are stored on this machine</div></>}
  </main></div></div>;
}






