import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { exampleDesign } from '../shared/example';
import { modelOrbitCamera } from '../shared/model-camera';

function framing(design: ReturnType<typeof exampleDesign>, view = 'front') {
  const program = `import json,sys\nfrom scripts.blender_compile import presentation_camera\nprint(json.dumps(presentation_camera(json.load(sys.stdin),sys.argv[1])))`;
  return JSON.parse(execFileSync('python3', ['-c', program, view], { input: JSON.stringify(design), encoding: 'utf8' })) as { position: number[]; target: number[]; front: number[] };
}
function house() {
  const design = exampleDesign();
  const base = design.elements[0];
  design.elements = [
    { ...base, id: 'shell', name: 'Shell', kind: 'wall', position: [30, 3, -20], size: [14, 6, 10], rotation: 0 },
    { ...base, id: 'door-entry', name: 'Exterior entrance', kind: 'door', position: [31, 1.5, -25], size: [1.2, 2.5, .1], rotation: 0 },
    { ...base, id: 'door-entry-bath', name: 'Entry bathroom', kind: 'door', position: [36.8, 1.5, -20], size: [.1, 2.5, 1], rotation: 0 },
  ];
  return design;
}
describe('Blender presentation framing', () => {
  it('matches the browser framing for translated, rotated and ambiguous entrances', () => {
    for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
      const design = house();
      design.elements = design.elements.map(element => ({ ...element, rotation: element.rotation + angle, position: [element.position[0] * Math.cos(angle) + element.position[2] * Math.sin(angle), element.position[1], -element.position[0] * Math.sin(angle) + element.position[2] * Math.cos(angle)] }));
      const browser = modelOrbitCamera(design), render = framing(design);
      expect(render.front).toEqual(browser.front);
      for (let i = 0; i < 3; i++) {
        expect(render.position[i]).toBeCloseTo(browser.position[i]);
        expect(render.target[i]).toBeCloseTo(browser.target[i]);
      }
    }
  });
  it('shows the named exterior entrance instead of a peripheral entry bathroom', () => {
    const camera = framing(house());
    expect(camera.front).toEqual([0, -1]);
    expect(camera.position[0]).toBeGreaterThan(30);
    expect(camera.position[2]).toBeLessThan(-25);
    expect(camera.target[0]).toBeCloseTo(30);
    expect(camera.target[2]).toBeCloseTo(-20.025);
  });
  it('provides an opposing review view of the same model', () => {
    const design = house(), front = framing(design), rear = framing(design, 'rear');
    expect(rear.front).toEqual([0, 1]);
    expect(rear.target).toEqual(front.target);
    expect(rear.position[0] + front.position[0]).toBeCloseTo(2 * front.target[0]);
    expect(rear.position[2] + front.position[2]).toBeCloseTo(2 * front.target[2]);
  });
  it('follows an east entrance and accounts for a rotated shell', () => {
    const design = house();
    design.elements = design.elements.slice(0, 2);
    design.elements[0].rotation = Math.PI / 2;
    design.elements[1].position = [35, 1.5, -20];
    design.elements[1].size = [.1, 2.5, 1.2];
    expect(framing(design).front).toEqual([1, 0]);
  });
  it('has a useful front view even with no named entrance', () => {
    const design = house(); design.elements = design.elements.slice(0, 1);
    const camera = framing(design);
    expect(camera.front).toEqual([0, -1]);
    expect(camera.target).toEqual([30, 2.2800000000000002, -20]);
    expect(camera.position.every(Number.isFinite)).toBe(true);
  });
});
