export type Route =
  | '/'
  | '/login'
  | '/login/admin'
  | '/login/assignee'
  | '/register'
  | '/app'
  | '/meetings'
  | '/upload'
  | '/capture'
  | '/review'
  | '/tasks'
  | '/analytics';

export type WorkspaceRole = 'admin' | 'assignee';
export type Navigate = (route: Route) => void;
