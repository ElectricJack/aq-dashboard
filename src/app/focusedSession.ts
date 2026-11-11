/** `/agents/<id>` is a focused session page (shell chrome hides on phones); `/agents/sessions` is the roster. */
export const isFocusedSessionPath = (pathname: string): boolean => /^\/agents\/(?!(?:sessions|swarm|history)\/?$)[^/]+\/?$/.test(pathname);
