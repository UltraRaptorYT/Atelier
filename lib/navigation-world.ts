import { Euler, Group, Mesh, Quaternion, Vector3 } from 'three';
import type { NavigationBox, NavigationPoint, NavigationWorld } from '../shared/navigation';

/** Read rendered geometry, including normalized canonical meshes and imported GLBs. */
export function readNavigationWorld(root: Group): NavigationWorld {
  const world: NavigationWorld = { surfaces: [], obstacles: [], triangles: [] };
  root.updateWorldMatrix(true, true);
  root.traverse(object => {
    if (!(object instanceof Mesh) || !object.userData.walkObstacle) return;
    const dimensions = object.geometry.parameters;
    const rotation = new Euler().setFromQuaternion(object.getWorldQuaternion(new Quaternion()), 'YXZ');
    if (dimensions && 'width' in dimensions && Math.abs(rotation.x) < .0001 && Math.abs(rotation.z) < .0001) {
      const position = object.getWorldPosition(new Vector3()), scale = object.getWorldScale(new Vector3());
      const box: NavigationBox = { position: position.toArray(), size: [dimensions.width*Math.abs(scale.x), dimensions.height*Math.abs(scale.y), dimensions.depth*Math.abs(scale.z)], rotation: rotation.y };
      world.obstacles.push(box);
      if (object.userData.walkSurface) world.surfaces.push(box);
      return;
    }
    const positions = object.geometry.getAttribute('position'), index = object.geometry.getIndex();
    if (!positions) return;
    const count = index?.count ?? positions.count;
    for (let i = 0; i+2 < count; i += 3) {
      // The navigation module rejects over-budget worlds without further work.
      if (world.triangles!.length > 100000) return;
      const vertices = [0,1,2].map(offset => new Vector3().fromBufferAttribute(positions, index ? index.getX(i+offset) : i+offset).applyMatrix4(object.matrixWorld).toArray()) as [NavigationPoint,NavigationPoint,NavigationPoint];
      const [a,b,c] = vertices.map(v => new Vector3(...v));
      const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
      // Floors and treads are horizontal; arbitrary sloped roofs remain actual
      // headroom obstacles instead of being expanded into solid bounding boxes.
      const surface = Boolean(object.userData.walkSurface) && normal.y > .9999;
      world.triangles!.push({ vertices, surface });
    }
  });
  return world;
}
