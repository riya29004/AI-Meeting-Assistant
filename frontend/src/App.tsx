import { useEffect, useState } from 'react';
import AuthPage from './pages/AuthPage';
import LandingPage from './pages/LandingPage';
import WorkspacePage from './pages/WorkspacePage';
import type { Route, WorkspaceRole } from './types';
import './index.css';

const routes = new Set<Route>([
  '/', '/login', '/login/admin', '/login/assignee', '/register',
  '/app', '/meetings', '/upload', '/capture', '/review', '/tasks', '/analytics',
]);

function readRoute(): Route | null {
  const path = window.location.pathname as Route;
  return routes.has(path) ? path : null;
}

export default function App() {
  const [route, setRoute] = useState<Route | null>(readRoute);
  const [workspaceRole, setWorkspaceRole] = useState<WorkspaceRole>('admin');

  function navigate(nextRoute: Route) {
    window.history.pushState({}, '', nextRoute);
    setRoute(nextRoute);
    window.scrollTo({ top: 0 });
  }

  useEffect(() => {
    const handlePopState = () => setRoute(readRoute());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  if (route === '/') return <LandingPage navigate={navigate} />;
  if (route === '/login') return <AuthPage mode="choose-role" navigate={navigate} />;
  if (route === '/login/admin') return <AuthPage mode="login" role="admin" navigate={navigate} />;
  if (route === '/login/assignee') return <AuthPage mode="login" role="assignee" navigate={navigate} />;
  if (route === '/register') return <AuthPage mode="register" navigate={navigate} />;
  if (route) return <WorkspacePage route={route} navigate={navigate} role={workspaceRole} setRole={setWorkspaceRole} />;

  return <main className="not-found"><h1>Page not found</h1><p>The address may be incorrect or the page may have moved.</p><button onClick={() => navigate('/')}>Return to MeetMind</button></main>;
}
