import { act, createElement, Suspense, useEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, extend, useLoader, type RootStore } from '@react-three/fiber';
import { Group, Loader } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SceneResourceBoundary, { ResourceUnavailable, SceneUnavailable } from '../components/SceneResourceBoundary';

extend({ Group });
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => { root.unmount(); }); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function scene() {
  const root = createRoot(new EventTarget()); roots.push(root);
  await root.configure({ gl: { render() {}, setSize() {}, setPixelRatio() {} }, frameloop: 'never', size: { width: 1, height: 1, top: 0, left: 0 }, dpr: 1 });
  let store: RootStore;
  return {
    render: async (children: React.ReactNode) => { await act(async () => { store = root.render(children); }); },
    find: (name: string) => store.getState().scene.getObjectByName(name),
  };
}

describe('scoped scene resource recovery', () => {
  it('catches a rejected asynchronous loader and retries its URL only after clearing the failed resource cache', async () => {
    const root = await scene(), requests = vi.fn();
    let unavailable = true, retry: () => void = () => {};
    class TestLoader extends Loader<{ url: string }> {
      load(url: string, resolve: (asset: { url: string }) => void, _progress?: (event: ProgressEvent) => void, reject?: (error: unknown) => void) {
        requests(url);
        queueMicrotask(() => unavailable ? reject?.(new Error('HTTP 404')) : resolve({ url }));
      }
    }
    const url = '/saved-model.glb';
    function Resource() { const loaded = useLoader(TestLoader, url); return createElement('group', { name: loaded.url }); }
    try {
      await root.render(createElement('group', null, createElement('group', { name: 'other-model' }),
        createElement(SceneResourceBoundary, {
          resetKey: url, onRetry: () => useLoader.clear(TestLoader, url),
          fallback: action => { retry = action; return createElement('group', { name: 'saved-shape' }); },
          children: createElement(Suspense, { fallback: createElement('group', { name: 'loading-shape' }) }, createElement(Resource)),
        }),
      ));
      const sibling = root.find('other-model');
      expect(root.find('saved-shape')).toBeDefined(); expect(root.find(url)).toBeUndefined(); expect(requests).toHaveBeenCalledOnce();
      unavailable = false;
      await act(async () => { retry(); });
      expect(root.find(url)).toBeDefined(); expect(root.find('saved-shape')).toBeUndefined();
      expect(root.find('other-model')).toBe(sibling); expect(requests).toHaveBeenCalledTimes(2);
    } finally { useLoader.clear(TestLoader, url); }
  });

  it.each([401, 404])('keeps healthy scene siblings and controls mounted when one resource fails with %s', async status => {
    const root = await scene();
    const mounts = vi.fn(), unmounts = vi.fn(), clearFailedResource = vi.fn();
    let failed = true, retry: () => void = () => {};
    function Healthy() { useEffect(() => { mounts(); return unmounts; }, []); return createElement('group', { name: 'healthy-building' }); }
    function Resource() { if (failed) throw new Error(`${status}: /private/project/artifact`); return createElement('group', { name: 'loaded-detail' }); }
    await root.render(createElement('group', null,
      createElement('group', { name: 'conversation' }), createElement('group', { name: 'stop-work' }), createElement('group', { name: 'files' }),
      createElement(Healthy),
      createElement(SceneResourceBoundary, { resetKey: 'asset-a', onRetry: clearFailedResource, fallback: action => { retry = action; return createElement('group', { name: 'saved-shape' }); }, children: createElement(Resource) }),
    ));
    const healthy = root.find('healthy-building');
    for (const name of ['conversation', 'stop-work', 'files', 'healthy-building', 'saved-shape']) expect(root.find(name)).toBeDefined();
    expect(root.find('loaded-detail')).toBeUndefined();
    failed = false;
    await act(async () => { retry(); });
    expect(clearFailedResource).toHaveBeenCalledOnce();
    expect(root.find('loaded-detail')).toBeDefined();
    expect(root.find('saved-shape')).toBeUndefined();
    expect(root.find('healthy-building')).toBe(healthy);
    expect(mounts).toHaveBeenCalledOnce(); expect(unmounts).not.toHaveBeenCalled();
  });

  it('recovers automatically when a new saved resource replaces a failed one', async () => {
    const root = await scene(), onError = vi.fn();
    function Resource({ available }: { available: boolean }) { if (!available) throw new Error('Preview missing.'); return createElement('group', { name: 'new-preview' }); }
    const render = (key: string, available: boolean) => root.render(createElement(SceneResourceBoundary, {
      resetKey: key, onError, fallback: () => createElement('group', { name: 'preview-unavailable' }), children: createElement(Resource, { available }),
    }));
    await render('earlier-artifact', false);
    expect(root.find('preview-unavailable')).toBeDefined(); expect(onError).toHaveBeenCalledOnce();
    await render('new-artifact', true);
    expect(root.find('preview-unavailable')).toBeUndefined(); expect(root.find('new-preview')).toBeDefined();
  });

  it('keeps the fallback available if clearing a failed loader itself fails', async () => {
    const root = await scene(); let retry: () => void = () => {};
    function Resource(): never { throw new Error('Unavailable.'); }
    await root.render(createElement(SceneResourceBoundary, {
      resetKey: 'asset', onRetry: () => { throw new Error('Cache unavailable.'); },
      fallback: action => { retry = action; return createElement('group', { name: 'retry-remains-available' }); }, children: createElement(Resource),
    }));
    await act(async () => { retry(); });
    expect(root.find('retry-remains-available')).toBeDefined();
  });

  it('explains recovery without exposing loader errors or making saved controls unavailable', () => {
    const model = renderToStaticMarkup(createElement(ResourceUnavailable, { kind: 'model', name: 'Living room chair', onRetry: () => {} }));
    expect(model).toContain('Living room chair: detail unavailable');
    expect(model).toContain('Showing its saved shape'); expect(model).toContain('Retry model detail');
    const preview = renderToStaticMarkup(createElement(ResourceUnavailable, { kind: 'preview', name: 'architect', onRetry: () => {} }));
    expect(preview).toContain('Activity and saved files remain available'); expect(preview).toContain('Retry preview');
    const world = renderToStaticMarkup(createElement(SceneUnavailable, { onRetry: () => {} }));
    expect(world).toContain('conversation, Stop work and Files remain available'); expect(world).toContain('Retry 3D view');
    expect(world).not.toContain('disabled');
  });
});
