/* A SCREEN THAT THROWS WHILE RENDERING USED TO TAKE THE WHOLE SITE WITH IT —
 * React unmounts the tree and the reader is left with a blank page and no way
 * out but the address bar. This catches it and shows the error page instead.
 *
 * An old tab asking for files a newer deploy removed is told THAT ('stale'),
 * because "something broke" would be untrue and a reload is the entire fix.
 * `staleBuild.ts` reloads a lazy screen on its own once; this covers the case
 * where that one reload is already spent.
 *
 * `resetKey` (the route) clears the error when the reader navigates away, so
 * one broken screen does not lock every other one behind it.
 */
import { Component, Suspense, lazy, type ReactNode } from 'react';
import { isStaleChunkError } from '../../state/staleBuild';

const ErrorScene = lazy(() => import('./ErrorScene'));

interface Props {
  resetKey: string;
  children: ReactNode;
}

interface State {
  error: unknown;
  /** The route the boundary last saw; a different one clears the error. */
  key: string;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  componentDidCatch(error: unknown) {
    console.error('[Deckkies] a screen failed to render', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isStaleChunkError(error);
    return (
      <Suspense fallback={<PlainFallback />}>
        <ErrorScene kind={stale ? 'stale' : 'crash'} error={error} />
      </Suspense>
    );
  }
}

/* The error page is itself a lazy chunk; if the crash IS a chunk that will not
   load, this is what the reader sees — still a way out. */
function PlainFallback() {
  return (
    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text)' }}>
      <p>Something went wrong on this screen.</p>
      <button type="button" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}
