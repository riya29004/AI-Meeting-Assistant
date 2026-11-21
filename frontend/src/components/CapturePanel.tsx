import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Headphones, Mic, Pause, Play, Radio, RefreshCw, ShieldCheck, Square } from 'lucide-react';
import { uploadAudio } from '../services/api';

type AudioSource = 'meeting' | 'microphone';
type CaptureStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'ready' | 'error';
type CaptureFile = { blob: Blob; name: string; seconds: number };
type CaptureFiles = Partial<Record<AudioSource, CaptureFile>>;
type CaptureStates = Record<AudioSource, CaptureStatus>;
type CaptureTimes = Record<AudioSource, number>;

export default function CapturePanel({ backendOnline }: { backendOnline: boolean }) {
  const [meetingTitle, setMeetingTitle] = useState('');
  const [status, setStatus] = useState<CaptureStates>({ meeting: 'idle', microphone: 'idle' });
  const [files, setFiles] = useState<CaptureFiles>({});
  const [elapsed, setElapsed] = useState<CaptureTimes>({ meeting: 0, microphone: 0 });
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const streams = useRef<Partial<Record<AudioSource, MediaStream>>>({});
  const recorders = useRef<Partial<Record<AudioSource, MediaRecorder>>>({});
  const startedAt = useRef<Partial<Record<AudioSource, number>>>({});
  const accumulatedSeconds = useRef<CaptureTimes>({ meeting: 0, microphone: 0 });
  const latestFiles = useRef(files);

  useEffect(() => { latestFiles.current = files; }, [files]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setElapsed({
        meeting: duration('meeting', status.meeting),
        microphone: duration('microphone', status.microphone),
      });
    }, 500);
    return () => window.clearInterval(interval);
  }, [status]);

  useEffect(() => () => {
    (Object.keys(streams.current) as AudioSource[]).forEach((source) => {
      const recorder = recorders.current[source];
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      streams.current[source]?.getTracks().forEach((track) => track.stop());
    });
  }, []);

  function duration(source: AudioSource, sourceStatus: CaptureStatus) {
    const activeSeconds = sourceStatus === 'recording' && startedAt.current[source]
      ? (Date.now() - startedAt.current[source]!) / 1000
      : 0;
    return Math.floor(accumulatedSeconds.current[source] + activeSeconds);
  }

  async function startCapture(source: AudioSource) {
    if (!meetingTitle.trim()) {
      setError('Enter a meeting title first.');
      return;
    }
    if (!consent) {
      setError('Confirm you have permission to record before starting.');
      return;
    }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) {
      setError('Audio capture is not supported in this browser. Try a current version of Chrome or Edge.');
      return;
    }

    setError('');
    setUploadMessage('');
    setStatus((current) => ({ ...current, [source]: 'requesting' }));
    let stream: MediaStream | undefined;

    try {
      if (source === 'microphone') {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        });
      } else {
        if (!navigator.mediaDevices.getDisplayMedia) {
          throw new Error('Tab audio capture is unavailable. Use Chrome or Edge and share a browser tab with audio.');
        }
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        if (!stream.getAudioTracks().length) {
          throw new Error('No tab audio was shared. Try again and enable “Share tab audio”.');
        }
      }

      const recorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()));
      const chunks: Blob[] = [];
      streams.current[source] = stream;
      recorders.current[source] = recorder;
      accumulatedSeconds.current[source] = 0;
      startedAt.current[source] = Date.now();

      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const name = `${safeTitle(meetingTitle)}-${source}.webm`;
        setFiles((current) => ({ ...current, [source]: { blob, name, seconds: accumulatedSeconds.current[source] } }));
        setStatus((current) => ({ ...current, [source]: 'ready' }));
        stream?.getTracks().forEach((track) => track.stop());
        delete recorders.current[source];
        delete streams.current[source];
      };

      recorder.start(1000);
      setFiles((current) => ({ ...current, [source]: undefined }));
      setStatus((current) => ({ ...current, [source]: 'recording' }));
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      setStatus((current) => ({ ...current, [source]: 'error' }));
      setError(reason instanceof Error ? reason.message : 'Could not start audio capture. Check browser permissions.');
    }
  }

  function togglePause(source: AudioSource) {
    const recorder = recorders.current[source];
    if (!recorder) return;
    if (recorder.state === 'recording') {
      accumulatedSeconds.current[source] += (Date.now() - (startedAt.current[source] ?? Date.now())) / 1000;
      recorder.pause();
      setStatus((current) => ({ ...current, [source]: 'paused' }));
    } else if (recorder.state === 'paused') {
      startedAt.current[source] = Date.now();
      recorder.resume();
      setStatus((current) => ({ ...current, [source]: 'recording' }));
    }
  }

  function stopCapture(source: AudioSource) {
    const recorder = recorders.current[source];
    if (!recorder || recorder.state === 'inactive') return;
    if (recorder.state === 'recording') {
      accumulatedSeconds.current[source] += (Date.now() - (startedAt.current[source] ?? Date.now())) / 1000;
    }
    recorder.stop();
    streams.current[source]?.getTracks().forEach((track) => track.stop());
  }

  async function uploadCaptures() {
    const pending = Object.entries(latestFiles.current) as [AudioSource, CaptureFile][];
    if (!pending.length || uploading) return;
    setUploading(true);
    setError('');
    setUploadMessage('');
    const uploaded: AudioSource[] = [];
    try {
      for (const [source, capture] of pending) {
        await uploadAudio(capture.blob, capture.name);
        uploaded.push(source);
        setFiles((current) => {
          const updated = { ...current };
          delete updated[source];
          return updated;
        });
      }
      setUploadMessage(`${uploaded.map(sourceLabel).join(' and ')} saved.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Audio upload failed.');
      if (uploaded.length) setUploadMessage(`${uploaded.map(sourceLabel).join(', ')} uploaded before the error.`);
    } finally {
      setUploading(false);
    }
  }

  const hasCaptures = Boolean(files.meeting || files.microphone);

  return (
    <section className="capture-simple">
      <div className="capture-main-card">
        <label className="meeting-title-input">Meeting title<input value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} placeholder="Weekly planning" /></label>
        <label className="capture-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>Participants have agreed to recording.</span></label>
        <p className="capture-tip"><Headphones size={14} />Headphones recommended</p>

        <div className="capture-source-cards">
          <CaptureSourceCard source="meeting" label="Meeting tab" status={status.meeting} seconds={elapsed.meeting} file={files.meeting} onStart={startCapture} onPause={togglePause} onStop={stopCapture} />
          <CaptureSourceCard source="microphone" label="Microphone" status={status.microphone} seconds={elapsed.microphone} file={files.microphone} onStart={startCapture} onPause={togglePause} onStop={stopCapture} />
        </div>

        {error && <p className="capture-feedback error" role="alert">{error}</p>}
        <div className="capture-actions"><span className="capture-save-status">{hasCaptures ? `${Object.values(files).filter(Boolean).length} audio file${Object.values(files).filter(Boolean).length === 1 ? '' : 's'} ready` : ''}</span><button className="primary-button" disabled={!backendOnline || uploading || !hasCaptures || !meetingTitle.trim()} onClick={uploadCaptures}>{uploading ? <><RefreshCw size={14} className="spin" /> Saving…</> : <>Save recording <ArrowRight size={14} /></>}</button></div>
        {uploadMessage && <p className="capture-feedback success" role="status">{uploadMessage}</p>}
        {backendOnline && <p className="capture-api-note"><ShieldCheck size={14} />Transcription is not connected yet.</p>}
      </div>
    </section>
  );
}

function sourceLabel(source: AudioSource) { return source === 'meeting' ? 'Tab audio' : 'Microphone audio'; }

function safeTitle(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'meeting';
}

function CaptureSourceCard({ source, label, status, seconds, file, onStart, onPause, onStop }: {
  source: AudioSource;
  label: string;
  status: CaptureStatus;
  seconds: number;
  file?: CaptureFile;
  onStart: (source: AudioSource) => void;
  onPause: (source: AudioSource) => void;
  onStop: (source: AudioSource) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState('');
  useEffect(() => {
    if (!file) { setPreviewUrl(''); return; }
    const url = URL.createObjectURL(file.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const busy = status === 'recording' || status === 'paused' || status === 'requesting';
  const time = (duration: number) => `${Math.floor(duration / 60).toString().padStart(2, '0')}:${Math.floor(duration % 60).toString().padStart(2, '0')}`;

  return (
    <article className={`capture-source-card ${status}`}>
      <div className="capture-source-title"><span className="capture-source-icon">{source === 'meeting' ? <Headphones size={16} /> : <Mic size={16} />}</span><span><b>{label}</b><small>{status === 'recording' ? `Recording · ${time(seconds)}` : status === 'paused' ? `Paused · ${time(seconds)}` : file ? `Ready · ${time(file.seconds)}` : status === 'requesting' ? 'Allow access' : status === 'error' ? 'Unavailable' : 'Ready'}</small></span><span className={`source-status-dot ${status}`} /></div>
      {file && previewUrl && <audio className="capture-audio-preview" controls src={previewUrl} aria-label={`${label} preview`} />}
      <div className="capture-source-controls">
        {!busy && <button onClick={() => onStart(source)}><Radio size={13} />{file ? 'Record again' : 'Start capture'}</button>}
        {busy && <><button onClick={() => onPause(source)}>{status === 'paused' ? <Play size={12} /> : <Pause size={12} />}{status === 'paused' ? 'Resume' : 'Pause'}</button><button className="stop-capture" onClick={() => onStop(source)}><Square size={10} fill="currentColor" /> Stop</button></>}
        {status === 'requesting' && <small>Approve the browser permission prompt.</small>}
      </div>
    </article>
  );
}
