import { ArrowRight, ShieldCheck, Target } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { authenticate } from '../services/api';
import Logo from '../components/Logo';
import type { Navigate, WorkspaceRole } from '../types';

type AuthMode = 'choose-role' | 'login' | 'register';

export default function AuthPage({ mode, role, navigate }: { mode: AuthMode; role?: WorkspaceRole; navigate: Navigate }) {
  const isRoleChooser = mode === 'choose-role';
  const isRegister = mode === 'register';
  const roleName = role === 'admin' ? 'Admin' : 'Assignee';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (isRegister && password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await authenticate(isRegister ? '/api/auth/register' : '/api/auth/login', email, password);
      navigate('/app');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not connect to the MeetMind backend.');
    } finally { setBusy(false); }
  }

  return (
    <div className="auth-page">
      <header className="auth-top">
        <button className="logo-button" onClick={() => navigate('/')} aria-label="MeetMind home"><Logo /></button>
        <button className="quiet-button" onClick={() => navigate('/')}>Back to homepage <ArrowRight size={14} /></button>
      </header>

      <main className={`auth-panel ${isRoleChooser ? 'role-auth-panel' : ''}`}>
        <div className="auth-mark"><Logo /></div>
        <div className="section-kicker">MEETMIND WORKSPACE</div>

        {isRoleChooser ? (
          <>
            <h1>Choose your sign-in.</h1>
            <p>Select the workspace that matches your role.</p>
            <div className="login-role-options">
              <button onClick={() => navigate('/login/admin')}>
                <span className="login-role-icon"><ShieldCheck size={17} /></span>
                <span><strong>Admin</strong><small>Manage meetings, approvals, and team tasks.</small></span>
                <ArrowRight size={15} />
              </button>
              <button onClick={() => navigate('/login/assignee')}>
                <span className="login-role-icon"><Target size={17} /></span>
                <span><strong>Assignee</strong><small>View meetings and tasks assigned to you.</small></span>
                <ArrowRight size={15} />
              </button>
            </div>
            <div className="auth-switch">New to MeetMind? <button onClick={() => navigate('/register')}>Create an account</button></div>
          </>
        ) : (
          <>
            <h1>{isRegister ? 'Request an account.' : `${roleName} sign in.`}</h1>
            <p>{isRegister ? 'New accounts require Admin approval.' : role === 'admin' ? 'Sign in to manage your MeetMind workspace.' : 'Sign in to view your meetings and assigned tasks.'}</p>
            <div className="api-notice"><ShieldCheck size={17} /><span>Your credentials are sent securely to the local MeetMind backend.</span></div>
            <form onSubmit={submit}>
              <label>Email<input type="email" placeholder="you@example.com" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>Password<input type="password" placeholder="••••••••" autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              {isRegister && <label>Confirm password<input type="password" placeholder="••••••••" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>}
              {error && <p className="api-status-message" role="alert">{error}</p>}
              <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}</button>
            </form>
            <div className="auth-switch">
              {isRegister ? 'Already have an account?' : 'Wrong account type?'}{' '}
              <button onClick={() => navigate(isRegister ? '/login' : '/login')}>{isRegister ? 'Sign in' : 'Choose role'}</button>
            </div>
          </>
        )}

        <div className="auth-explore"><button type="button" onClick={() => navigate('/app')}>Explore the workspace <ArrowRight size={13} /></button></div>
        <small className="auth-legal">Only record meetings when you have permission from participants.</small>
      </main>
    </div>
  );
}
