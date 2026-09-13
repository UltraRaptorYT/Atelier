"""Canonical metre/Y-up construction helpers; no Blender-only metadata.

Workstation: `from design_authoring import *`. Build a complete DesignSchema for
an initial design, or start `proposal = empty_edits()` for a revision. Save with
`write_proposal(proposal)` to /home/user/project/proposal.json, then call the
inspect_proposal and submit_proposal tools. Python writes never commit a design.
IDs are supplied by the author; keep assembly prefixes and opening order stable.
All boxes use their centre; wall opening offsets are measured from wall start.
"""
from copy import deepcopy
import json
import math
from pathlib import Path
import re

_EPS = 1e-8
_MIN = .01


def _number(value, label, minimum=None, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be finite")
    if minimum is not None and value < minimum - _EPS:
        raise ValueError(f"{label} must be at least {minimum}")
    if maximum is not None and value > maximum + _EPS:
        raise ValueError(f"{label} must be at most {maximum}")
    return float(value)


def _id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", value):
        raise ValueError("IDs must contain 1–80 letters, digits, underscores or hyphens")
    return value


def _vector(value, count, label):
    if len(value) != count:
        raise ValueError(f"{label} needs {count} coordinates")
    return [_number(v, label) for v in value]


def material(id, color, name=None, roughness=.65, metalness=0, opacity=1, transmission=0):
    """Explicit opacity keeps frames and solid doors opaque in both renderers."""
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        raise ValueError("Material color must be #RRGGBB")
    return dict(id=_id(id), name=name or id, color=color,
                roughness=_number(roughness, "roughness", 0, 1),
                metalness=_number(metalness, "metalness", 0, 1),
                opacity=_number(opacity, "opacity", 0, 1),
                transmission=_number(transmission, "transmission", 0, 1))


def box(id, kind, center, size, material, floor=0, name=None, rotation=0, asset_id=None):
    center, size = _vector(center, 3, "center"), _vector(size, 3, "size")
    for value, low, high in zip(center, [-500, -5, -500], [500, 50, 500]):
        _number(value, "position", low, high)
    for value, high in zip(size, [150, 20, 150]):
        _number(value, "size", _MIN, high)
    if kind not in ("slab", "wall", "roof", "door", "window", "stair", "furniture", "light", "asset"):
        raise ValueError("Unknown canonical element kind")
    if not isinstance(floor, int) or isinstance(floor, bool) or not 0 <= floor <= 3:
        raise ValueError("floor must be an integer from 0 to 3")
    return dict(id=_id(id), kind=kind, name=name or id, position=center, size=size,
                rotation=_number(rotation, "rotation", -2 * math.pi, 2 * math.pi),
                materialId=_id(material), floor=floor, assetId=asset_id)


def mesh(id, kind, vertices, triangles, material, floor=0, name=None):
    """Convert world-space vertices to the bounded canonical normalized mesh."""
    if not 4 <= len(vertices) <= 2048 or not 4 <= len(triangles) <= 4096:
        raise ValueError("Mesh needs 4–2048 vertices and 4–4096 triangles")
    vertices = [_vector(v, 3, "vertex") for v in vertices]
    triangles = [list(t) for t in triangles]
    for triangle in triangles:
        if len(triangle) != 3 or any(not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < len(vertices) for i in triangle):
            raise ValueError("Triangle indices must address three existing vertices")
        a, b, c = [vertices[i] for i in triangle]
        u, v = [b[j] - a[j] for j in range(3)], [c[j] - a[j] for j in range(3)]
        cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
        if sum(n*n for n in cross) < 1e-16:
            raise ValueError("Mesh has a degenerate triangle")
    low = [min(v[i] for v in vertices) for i in range(3)]
    high = [max(v[i] for v in vertices) for i in range(3)]
    center = [(a+b)/2 for a, b in zip(low, high)]
    size = [max(_MIN, b-a) for a, b in zip(low, high)]
    result = box(id, kind, center, size, material, floor, name)
    result["geometry"] = dict(type="mesh", vertices=[[max(-.5, min(.5, (v[i]-center[i])/size[i])) for i in range(3)] for v in vertices], triangles=triangles)
    return result


def rod(id, start, end, radius, material, floor=0, kind="furniture", sides=10):
    """A capped polygon cylinder between two world points, useful for furniture."""
    start, end = _vector(start, 3, "start"), _vector(end, 3, "end")
    radius = _number(radius, "radius", .005, 10)
    if not isinstance(sides, int) or not 3 <= sides <= 32:
        raise ValueError("sides must be an integer from 3 to 32")
    axis = [b-a for a, b in zip(start, end)]
    length = math.sqrt(sum(v*v for v in axis))
    _number(length, "rod length", _MIN)
    axis = [v/length for v in axis]
    ref = [0, 1, 0] if abs(axis[1]) < .9 else [1, 0, 0]
    u = [axis[1]*ref[2]-axis[2]*ref[1], axis[2]*ref[0]-axis[0]*ref[2], axis[0]*ref[1]-axis[1]*ref[0]]
    norm = math.sqrt(sum(v*v for v in u)); u = [v/norm for v in u]
    v = [axis[1]*u[2]-axis[2]*u[1], axis[2]*u[0]-axis[0]*u[2], axis[0]*u[1]-axis[1]*u[0]]
    vertices = [[p[k]+radius*(u[k]*math.cos(2*math.pi*i/sides)+v[k]*math.sin(2*math.pi*i/sides)) for k in range(3)] for p in [start, end] for i in range(sides)]
    vertices += [start, end]
    faces = []
    for i in range(sides):
        j = (i+1) % sides
        faces += [[i, j, sides+j], [i, sides+j, sides+i], [2*sides, j, i], [2*sides+1, sides+i, sides+j]]
    return mesh(id, kind, vertices, faces, material, floor)


def _wall_frame(start, end):
    start, end = _vector(start, 2, "wall start"), _vector(end, 2, "wall end")
    dx, dz = end[0]-start[0], end[1]-start[1]
    length = math.hypot(dx, dz)
    _number(length, "wall length", _MIN, 150)
    return start, length, dx/length, dz/length, -math.atan2(dz, dx)


def _opening_rect(opening, length, height):
    _id(opening["id"])
    left = _number(opening["offset"], "opening offset", 0)
    width = _number(opening["width"], "opening width", .1)
    bottom = _number(opening.get("bottom", 0), "opening bottom", 0)
    tall = _number(opening["height"], "opening height", .1)
    if left+width > length+_EPS or bottom+tall > height-_MIN+_EPS:
        raise ValueError("Opening is outside its wall or leaves no header")
    return (left, bottom, left+width, bottom+tall)


def _subtract_rectangles(width, height, holes):
    """Partition a rectangle into disjoint x-strips around disjoint apertures."""
    for i, a in enumerate(holes):
        if a[0] < -_EPS or a[1] < -_EPS or a[2] > width+_EPS or a[3] > height+_EPS:
            raise ValueError("Opening/void is outside its host")
        for b in holes[:i]:
            if min(a[2], b[2])-max(a[0], b[0]) > _EPS and min(a[3], b[3])-max(a[1], b[1]) > _EPS:
                raise ValueError("Openings/voids overlap")
    cuts = sorted(set([0, width] + [v for hole in holes for v in [hole[0], hole[2]]]))
    result = []
    for ix, (left, right) in enumerate(zip(cuts, cuts[1:])):
        if right-left < _EPS:
            continue
        spans = sorted((h[1], h[3]) for h in holes if h[0] < right-_EPS and h[2] > left+_EPS)
        bottom = 0; iy = 0
        for lo, hi in spans + [(height, height)]:
            if lo-bottom > _EPS:
                if min(right-left, lo-bottom) < _MIN-_EPS:
                    raise ValueError("Assembly leaves a strip thinner than canonical 0.01 m minimum")
                result.append((ix, iy, left, bottom, right, lo)); iy += 1
            bottom = max(bottom, hi)
    if not result:
        raise ValueError("Voids remove the entire host")
    return result


def wall_with_openings(id, start, end, base_y, height, thickness, material, openings=(), floor=0):
    """Opening: {id, offset, width, bottom, height}; offset starts at wall start.

    Splits the wall around true holes, retaining headers, sills and solid piers.
    Apertures may touch the wall end, but never its top. Window/door assemblies
    fit into the same aperture records; adding a pane alone never cuts a hole.
    """
    start, length, ux, uz, yaw = _wall_frame(start, end)
    height = _number(height, "wall height", .1, 20)
    thickness = _number(thickness, "wall thickness", .05, 2)
    _number(base_y, "wall base", -5, 50)
    if len(openings) > 40 or len({o["id"] for o in openings}) != len(openings):
        raise ValueError("Use at most 40 openings with unique IDs")
    holes = [_opening_rect(o, length, height) for o in openings]
    return [box(f"{id}_bay{ix}_part{iy}", "wall", [start[0]+ux*(a+c)/2, base_y+(b+d)/2, start[1]+uz*(a+c)/2], [c-a, d-b, thickness], material, floor, rotation=yaw)
            for ix, iy, a, b, c, d in _subtract_rectangles(length, height, holes)]


def _aperture_parts(id, start, end, base_y, wall_height, opening, frame_material, frame, depth, floor, sill):
    start, length, ux, uz, yaw = _wall_frame(start, end)
    left, bottom, right, top = _opening_rect(opening, length, wall_height)
    frame = _number(frame, "frame thickness", .01)
    depth = _number(depth, "frame depth", .02)
    if right-left <= 2*frame+.05 or top-bottom <= (2 if sill else 1)*frame+.05:
        raise ValueError("Frame consumes the clear aperture")
    def part(suffix, kind, x, y, w, h, material, zdepth=depth):
        return box(f"{id}_{suffix}", kind, [start[0]+ux*x, base_y+y, start[1]+uz*x], [w, h, zdepth], material, floor, rotation=yaw)
    # Kind wall is intentional: frames must be opaque solids, never legacy glass.
    result = [part("jamb_l", "wall", left+frame/2, (bottom+top)/2, frame, top-bottom, frame_material),
              part("jamb_r", "wall", right-frame/2, (bottom+top)/2, frame, top-bottom, frame_material),
              part("head", "wall", (left+right)/2, top-frame/2, right-left-2*frame, frame, frame_material)]
    if sill:
        result.append(part("sill", "wall", (left+right)/2, bottom+frame/2, right-left-2*frame, frame, frame_material))
    return result, part, (left, bottom, right, top), yaw


def window_assembly(id, start, end, base_y, wall_height, opening, frame_material, glass_material, floor=0, frame=.05, depth=.12, mullions=0):
    """Opaque frame + glazing inside a matching wall_with_openings aperture."""
    parts, part, (left, bottom, right, top), _ = _aperture_parts(id, start, end, base_y, wall_height, opening, frame_material, frame, depth, floor, True)
    if not isinstance(mullions, int) or not 0 <= mullions <= 12:
        raise ValueError("mullions must be an integer from 0 to 12")
    clear = right-left-2*frame
    pane_width = (clear-mullions*frame)/(mullions+1)
    if pane_width < .05:
        raise ValueError("Too many mullions for window width")
    for i in range(mullions+1):
        x = left+frame+(pane_width+frame)*i+pane_width/2
        parts.append(part(f"glass{i}", "window", x, (bottom+top)/2, pane_width, top-bottom-2*frame, glass_material, .02))
        if i < mullions:
            parts.append(part(f"mullion{i}", "wall", x+pane_width/2+frame/2, (bottom+top)/2, frame, top-bottom-2*frame, frame_material))
    return parts


def door_assembly(id, start, end, base_y, wall_height, opening, frame_material, door_material, floor=0, frame=.05, depth=.12, open_angle=math.pi/2):
    """Door frame and an opaque hinged leaf; default 90 degrees leaves a route.

    Angles are radians relative to the wall, positive yaw swings toward its
    local -Z side. The caller must reserve the swing/approach outside the host.
    """
    if opening.get("bottom", 0) != 0:
        raise ValueError("A walkable door opening must start at floor level")
    parts, part, (left, bottom, right, top), yaw = _aperture_parts(id, start, end, base_y, wall_height, opening, frame_material, frame, depth, floor, False)
    open_angle = _number(open_angle, "door angle", -math.pi, math.pi)
    leaf = part("leaf", "door", left+frame, (bottom+top-frame)/2, right-left-2*frame, top-bottom-frame, door_material, .04)
    leaf["rotation"] = yaw+open_angle
    leaf["position"][0] += math.cos(leaf["rotation"])*leaf["size"][0]/2
    leaf["position"][2] -= math.sin(leaf["rotation"])*leaf["size"][0]/2
    parts.append(leaf)
    return parts


def slab_with_voids(id, center, size, top_y, thickness, material, voids=(), floor=0):
    """Axis-aligned XZ slab. Voids: {id, position:[x,z], size:[width,depth]}."""
    center, size = _vector(center, 2, "slab center"), _vector(size, 2, "slab size")
    width, depth = [_number(v, "slab dimension", .1, 150) for v in size]
    thickness = _number(thickness, "slab thickness", .05, 2)
    x0, z0 = center[0]-width/2, center[1]-depth/2
    if len(voids) > 40 or len({v["id"] for v in voids}) != len(voids):
        raise ValueError("Use at most 40 voids with unique IDs")
    holes = []
    for void in voids:
        _id(void["id"])
        x, z = _vector(void["position"], 2, "void position")
        w, d = [_number(v, "void dimension", .1, 150) for v in _vector(void["size"], 2, "void size")]
        holes.append((x-w/2-x0, z-d/2-z0, x+w/2-x0, z+d/2-z0))
    return [box(f"{id}_bay{ix}_part{iy}", "slab", [x0+(a+c)/2, top_y-thickness/2, z0+(b+d)/2], [c-a, thickness, d-b], material, floor)
            for ix, iy, a, b, c, d in _subtract_rectangles(width, depth, holes)]


def staircase_with_landing(id, start, base_y, rise, width, material, floor=0, run=None, landing_depth=None, slab_thickness=.2):
    """Straight +Z flight with a top landing and matching upper-floor void.

    start=[centre_x, low_end_z]; pass result['upper_void'] to slab_with_voids.
    The landing is the adjacent upper slab surface (not an overlapping plate),
    so subtract result['upper_void'] AND result['landing_void'] from that slab.
    Separate low-floor approach, handrails, roof/headroom and room connectivity
    still need inspection. This helper supplies dimensions, not compliance.
    """
    x, z = _vector(start, 2, "stair start")
    rise = _number(rise, "stair rise", .4, 6)
    width = _number(width, "stair width", .9, 3)
    if not isinstance(floor, int) or not 0 <= floor <= 2:
        raise ValueError("Stair base floor must be 0, 1 or 2")
    count = math.ceil(rise/.18)  # Must match geometryParts in both renderers.
    run = count*.28 if run is None else _number(run, "stair run", .1)
    _number(run/count, "stair tread depth", .25, .4)
    landing_depth = width if landing_depth is None else _number(landing_depth, "landing depth", width, 5)
    slab_thickness = _number(slab_thickness, "landing thickness", .05, .5)
    flight = box(f"{id}_flight", "stair", [x, base_y+rise/2, z+run/2], [width, rise, run], material, floor)
    landing = box(f"{id}_landing", "slab", [x, base_y+rise-slab_thickness/2, z+run+landing_depth/2], [width, slab_thickness, landing_depth], material, floor+1)
    return dict(elements=[flight, landing], upper_void=dict(id=f"{id}_opening", position=[x, z+run/2], size=[width, run]),
                landing_void=dict(id=f"{id}_landing_cut", position=[x, z+run+landing_depth/2], size=[width, landing_depth]),
                risers=count, riser_height=rise/count, tread_depth=run/count, upper_y=base_y+rise)


def folded_roof(id, profile, z_min, z_max, thickness, material, floor=0):
    """Extrude an ordered [(world_x, top_y), ...] roof profile along Z.

    Adjacent thin mesh panels meet exactly at folds. Thickness is vertical;
    wall tops/gables below this expressive roof remain the Architect's task.
    """
    if not 2 <= len(profile) <= 30:
        raise ValueError("Roof profile needs 2–30 points")
    profile = [_vector(point, 2, "roof profile") for point in profile]
    _number(z_max-z_min, "roof depth", .1, 150)
    thickness = _number(thickness, "roof thickness", .02, 1)
    triangles = [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,5,1],[0,4,5],[1,6,2],[1,5,6],[2,7,3],[2,6,7],[3,4,0],[3,7,4]]
    result = []
    for i, ((x1,y1),(x2,y2)) in enumerate(zip(profile, profile[1:])):
        _number(x2-x1, "roof profile X spacing", .01, 150)
        low = [[x1,y1-thickness,z_min],[x2,y2-thickness,z_min],[x2,y2-thickness,z_max],[x1,y1-thickness,z_max]]
        high = [[x1,y1,z_min],[x2,y2,z_min],[x2,y2,z_max],[x1,y1,z_max]]
        result.append(mesh(f"{id}_panel{i}", "roof", low+high, triangles, material, floor))
    return result


def pitched_roof(id, center, size, eave_y, ridge_y, material, floor=0, thickness=.12, ridge_offset=0):
    """Two true sloped roof panels; ridge_offset shifts ridge along world X."""
    x, z = _vector(center, 2, "roof center")
    width, depth = [_number(v, "roof size", .1, 150) for v in _vector(size, 2, "roof size")]
    _number(ridge_y-eave_y, "roof pitch rise", .01, 10)
    _number(ridge_offset, "ridge offset", -width/2+.01, width/2-.01)
    return folded_roof(id, [(x-width/2,eave_y),(x+ridge_offset,ridge_y),(x+width/2,eave_y)], z-depth/2, z+depth/2, thickness, material, floor)


def gable_wall(id, left_x, right_x, ridge_x, eave_y, ridge_y, z, thickness, material, floor=0):
    """Triangular end-wall infill below a pitched roof (use roof underside Ys)."""
    _number(right_x-left_x, "gable width", .1, 150)
    _number(ridge_x, "gable ridge X", left_x+.01, right_x-.01)
    _number(ridge_y-eave_y, "gable height", .01, 20)
    thickness = _number(thickness, "gable thickness", .05, 2)
    vertices = [[left_x,eave_y,z-thickness/2],[right_x,eave_y,z-thickness/2],[ridge_x,ridge_y,z-thickness/2],
                [left_x,eave_y,z+thickness/2],[right_x,eave_y,z+thickness/2],[ridge_x,ridge_y,z+thickness/2]]
    triangles = [[0,2,1],[3,4,5],[0,1,4],[0,4,3],[1,2,5],[1,5,4],[2,0,3],[2,3,5]]
    return mesh(id, "wall", vertices, triangles, material, floor)


def empty_edits():
    """All unmentioned records/metadata remain unchanged; no scene replacement."""
    return dict(elements=dict(upsert=[], remove=[]), materials=dict(upsert=[], remove=[]),
                spaces=dict(upsert=[], remove=[]), metadata=dict(title=None, buildingType=None, floors=None, spawn=None, notes=None))


def write_proposal(proposal, path="/home/user/project/proposal.json"):
    """Write only the candidate file. Server tools validate, inspect and submit."""
    data = json.dumps(deepcopy(proposal), allow_nan=False, separators=(",", ":"))
    Path(path).write_text(data, encoding="utf-8")
    return dict(path=str(path), bytes=len(data.encode("utf-8")))
