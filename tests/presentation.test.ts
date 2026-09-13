import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PresentationCard from '../components/PresentationCard';
import { presentationInRange, savedDesignEntry } from '../lib/presentation';
import { exampleDesign } from '../shared/example';
import type { Snapshot } from '../shared/design';

const snapshot = (): Snapshot => ({ project: { id: 'saved-house', name: 'Saved house', revision: 4, status: 'review', createdAt: '2026-09-13', updatedAt: '2026-09-13', brief: { request: 'A courtyard home.', summary: 'Courtyard home', goals: [], constraints: [], questions: [] } }, design: exampleDesign(), tasks: [], events: [], artifacts: [] });

describe('saved design presentation handoff', () => {
  it('enters the current canonical revision at its authored spawn and follows a newer saved model', () => {
    const saved = snapshot();
    saved.design!.spawn = [2, 4.7, 3];
    const entry = savedDesignEntry(saved)!;
    expect(entry).toMatchObject({ revision: 4, mode: 'model', navigation: 'walk', design: { spawn: [2, 4.7, 3] } });
    expect(entry.design).toBe(saved.design);
    const latest = { ...saved, project: { ...saved.project, revision: 5 }, design: { ...saved.design!, title: 'Revised house' } };
    expect(savedDesignEntry(latest)).toMatchObject({ revision: 5, design: { title: 'Revised house' } });
    expect(savedDesignEntry({ ...saved, design: null })).toBeNull();
    expect(savedDesignEntry(null)).toBeNull();
  });

  it('offers the saved building without claiming unresolved review has passed', () => {
    const markup = renderToStaticMarkup(createElement(PresentationCard, { snapshot: snapshot(), onEnter: () => {} }));
    expect(markup).toContain('Saved revision 4');
    expect(markup).toContain('Review remains open');
    expect(markup).toContain('Walk inside saved design');
    expect(renderToStaticMarkup(createElement(PresentationCard, { snapshot: null, onEnter: () => {} }))).not.toContain('<button');
  });

  it('enables the exhibit interaction only near the table and after a model is saved', () => {
    expect(presentationInRange({ x: 7.5, z: 6.5 }, [7.5, 0, 4], true)).toBe(true);
    expect(presentationInRange({ x: 7.5, z: 6.5 }, [7.5, 0, 4], false)).toBe(false);
    expect(presentationInRange({ x: 0, z: 4 }, [7.5, 0, 4], true)).toBe(false);
  });
});
