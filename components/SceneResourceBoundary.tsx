'use client';

import { Component, type ReactNode } from 'react';
import styles from './SceneResourceBoundary.module.css';

type Props = {
  children: ReactNode;
  resetKey: string;
  fallback: (retry: () => void) => ReactNode;
  onRetry?: () => void;
  onError?: () => void;
};

/** Isolate a failed scene resource without unmounting the surrounding project. */
export default class SceneResourceBoundary extends Component<Props, { failed: boolean; resetKey: string }> {
  state = { failed: false, resetKey: this.props.resetKey };
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props: Props, state: { resetKey: string }) {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }
  componentDidCatch() { this.props.onError?.(); }
  retry = () => {
    // Clear only this loader's failed cache entry before attempting the resource again.
    try { this.props.onRetry?.(); } catch { return; }
    this.setState({ failed: false });
  };
  render() { return this.state.failed ? this.props.fallback(this.retry) : this.props.children; }
}

export function ResourceUnavailable({ kind, name, onRetry }: { kind: 'model' | 'preview'; name: string; onRetry: () => void }) {
  return <div className={styles.resource} role="status">
    <strong>{kind === 'model' ? `${name}: detail unavailable` : 'Preview unavailable'}</strong>
    <p>{kind === 'model' ? 'Showing its saved shape. The rest of your design is available.' : 'Activity and saved files remain available.'}</p>
    <button type="button" onClick={event => { event.stopPropagation(); onRetry(); }}>{kind === 'model' ? 'Retry model detail' : 'Retry preview'}</button>
  </div>;
}

export function SceneUnavailable({ onRetry }: { onRetry: () => void }) {
  return <div className="loading-world" role="status">
    <p>The 3D view could not load.</p>
    <p className={styles.explanation}>Your conversation, Stop work and Files remain available. Your saved design is preserved.</p>
    <button type="button" className="button" onClick={onRetry}>Retry 3D view</button>
  </div>;
}
