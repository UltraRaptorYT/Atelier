import { BoxGeometry, BufferGeometry, Float32BufferAttribute, MeshPhysicalMaterial } from 'three';
import type { DesignElement, Material } from '../shared/design';
import { geometryParts, materialAppearance, meshGeometry } from '../shared/geometry';

/** The same geometry feeds display, GLB export and Rapier's mesh colliders. */
export function createElementGeometry(element: DesignElement) {
  const mesh = meshGeometry(element);
  if (mesh) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(mesh.vertices, 3));
    geometry.setIndex(mesh.indices);
    geometry.computeVertexNormals();
    return [{ geometry, position: [0, 0, 0] as [number, number, number] }];
  }
  return geometryParts(element).map(part => ({ geometry: new BoxGeometry(...part.size), position: part.position }));
}

export function createElementMaterial(material: Material, element: Pick<DesignElement, 'kind'>) {
  const appearance = materialAppearance(material, element);
  return new MeshPhysicalMaterial({ color: material.color, roughness: material.roughness, metalness: material.metalness,
    ...appearance, transparent: appearance.opacity < 1, flatShading: true });
}
