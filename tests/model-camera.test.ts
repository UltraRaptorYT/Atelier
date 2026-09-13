import { describe, expect, it } from 'vitest';
import type { DesignElement } from '../shared/design';
import { modelOrbitCamera } from '../shared/model-camera';

const shell: DesignElement = { id: 'shell', name: 'Building shell', kind: 'wall', position: [0, 3, 0], size: [14, 6, 10], rotation: 0, materialId: 'finish', floor: 0, assetId: null };
const entry: DesignElement = { ...shell, id: 'door-entry', name: 'Exterior entry door', kind: 'door', position: [1, 1.5, -4.9], size: [1.4, 2.7, .12] };

describe('model Orbit entrance framing', () => {
  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])('frames the entrance after the model is rotated by %s', angle => {
    const c = Math.cos(angle), s = Math.sin(angle);
    const elements = [shell, entry].map(element => ({ ...element, position: [element.position[0] * c + element.position[2] * s, element.position[1], -element.position[0] * s + element.position[2] * c] as [number, number, number], rotation: angle }));
    const camera = modelOrbitCamera({ elements });
    const expected = [-s, -c];
    expect(camera.front[0]).toBeCloseTo(expected[0]); expect(camera.front[1]).toBeCloseTo(expected[1]);
    const offset = [camera.position[0] - camera.target[0], camera.position[2] - camera.target[2]];
    expect(offset[0] * expected[0] + offset[1] * expected[1]).toBeCloseTo(camera.radius * 2.1);
    expect(offset[0] * -expected[1] + offset[1] * expected[0]).toBeCloseTo(camera.radius * 1.9);
  });

  it('preserves framing under translation, including an elevated building', () => {
    const original = modelOrbitCamera({ elements: [shell, entry] });
    const translation = [90, 8, -140];
    const shifted = modelOrbitCamera({ elements: [shell, entry].map(element => ({ ...element, position: element.position.map((value, axis) => value + translation[axis]) as [number, number, number] })) });
    for (let axis = 0; axis < 3; axis++) {
      expect(shifted.position[axis] - translation[axis]).toBeCloseTo(original.position[axis]);
      expect(shifted.target[axis] - translation[axis]).toBeCloseTo(original.target[axis]);
    }
    expect(shifted.front).toEqual(original.front); expect(shifted.radius).toBe(original.radius);
  });

  it('uses rotated extents for framing and normalized facade distances for a long building', () => {
    const rotated = modelOrbitCamera({ elements: [{ ...shell, rotation: Math.PI / 4 }] });
    expect(rotated.radius).toBeCloseTo(12 / Math.sqrt(2));
    const long = modelOrbitCamera({ elements: [{ ...shell, size: [100, 6, 10] }, { ...entry, position: [20, 1.5, -4.9] }] });
    expect(long.front).toEqual([0, -1]);
    expect(long.radius).toBe(50);
  });

  it('prefers an explicitly exterior entrance and then the candidate nearest the perimeter', () => {
    const internal = { ...entry, id: 'entry-bath', name: 'Entry bathroom door', position: [3, 1.5, 0] as [number, number, number] };
    const rear = { ...entry, id: 'door-back', name: 'Back door', position: [0, 1.5, 4.9] as [number, number, number] };
    const inset = { ...entry, id: 'exterior-inset', position: [6, 1.5, 0] as [number, number, number] };
    expect(modelOrbitCamera({ elements: [shell, internal, rear, inset, entry] }).front).toEqual([0, -1]);
    expect(modelOrbitCamera({ elements: [shell, { ...rear, name: 'Front-door' }] }).front).toEqual([0, 1]);
  });

  it('has a finite front-facing fallback when no entrance can identify a facade', () => {
    for (const elements of [[], [shell], [shell, { ...entry, position: [0, 1.5, 0] as [number, number, number] }]]) {
      const camera = modelOrbitCamera({ elements });
      expect(camera.front).toEqual([0, -1]);
      expect([...camera.position, ...camera.target].every(Number.isFinite)).toBe(true);
    }
  });
});
