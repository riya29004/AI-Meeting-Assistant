import { ArrowRight, ShieldCheck, Target } from 'lucide-react';
import Logo from '../components/Logo';
import type { Navigate, WorkspaceRole } from '../types';

type AuthMode = 'choose-role' | 'login' | 'register';

export default function AuthPage({ mode, role, navigate }: { mode: AuthMode; role?: WorkspaceRole; navigate: Navigate }) {
  const isRoleChooser = mode === 'choose-role';
  const isRegister = mode === 'register';
  const roleName = role === 'admin' ? 'Admin' : 'Assignee';

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
            <div className="api-notice"><ShieldCheck size={17} /><span>Authentication is not connected to the backend yet. Credentials are not sent or stored.</span></div>
            <form onSubmit={(event) => event.preventDefault()}>
              {isRegister && <label>Name<input type="text" placeholder="Your name" disabled /></label>}
              <label>Email<input type="email" placeholder="you@example.com" disabled /></label>
              <label>Password<input type="password" placeholder="••••••••" disabled /></label>
              {isRegister && <label>Confirm password<input type="password" placeholder="••••••••" disabled /></label>}
              <button className="primary-button" type="button" disabled>{isRegister ? 'Registration unavailable' : 'Sign in unavailable'}</button>
            </form>
            <div className="auth-switch">
              {isRegister ? 'Already have an account?' : 'Wrong account type?'}{' '}
              <button onClick={() => navigate(isRegister ? '/login' : '/login')}>{isRegister ? 'Sign in' : 'Choose role'}</button>
            </div>
          </>
        )}

        <div className="auth-explore"><button type="button" onClick={() => navigate('/app')}>Explore the workspace preview <ArrowRight size={13} /></button></div>
        <small className="auth-legal">Only record meetings when you have permission from participants.</small>
      </main>
    </div>
  );
}
