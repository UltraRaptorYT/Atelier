"""Document the Spline model and draw the measured site plan from canonical data."""
import html
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'project/spline'
D=json.loads((ROOT/'project/design.json').read_text())
site=D['blender']['site']
def area(p):return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(p,p[1:]+p[:1])))/2
ground=area(site['ground_outline'])
upper=area(site['upper_outline'])-area(site['stair_void'])
garden=600-sum(site['conservative_nonplanted_exclusions'].values())
checks={'site_m2':600,'ground_enclosed_m2':ground,'upper_enclosed_m2':upper,'total_enclosed_m2':ground+upper,'covered_footprint_m2':area(site['covered_outline']),'coverage_percent':30,'conservative_planted_m2':garden,'bedrooms':3,'storeys':2,'setbacks_m':{'south':7,'north':11,'east':2.5,'west':2.5},'note':'Concept geometry, not a statutory GFA calculation or accessibility certification.'}
assert round(ground+upper,2)==320 and garden>=240 and area(site['covered_outline'])<=180
(OUT/'area-checks.json').write_text(json.dumps(checks,indent=2))

def X(x):return 170+(x+10)*28
def Y(y):return 170+(15-y)*28
parts=['<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1220" viewBox="0 0 900 1220">','<rect width="900" height="1220" fill="#f8f6f0"/>','<style>text{font-family:Arial,sans-serif;fill:#283d36}.small{font-size:13px}.body{font-size:17px}.label{font-size:19px;font-weight:600}.dim{stroke:#627469;stroke-width:1;fill:none}</style>']
def text(x,y,s,cl='body',extra=''):parts.append(f'<text x="{x}" y="{y}" class="{cl}" {extra}>{html.escape(s)}</text>')
def rect(a,b,c,d,fill,stroke=None):parts.append(f'<rect x="{X(a)}" y="{Y(d)}" width="{(c-a)*28}" height="{(d-b)*28}" fill="{fill}"'+(f' stroke="{stroke}" stroke-width="2"' if stroke else '')+'/>')
text(66,57,'PIKACHU HOUSE / SPLINE STUDY','small')
text(66,98,'Site & garden',extra='style="font-size:34px;font-weight:600"')
text(66,128,'Hypothetical Joo Chiat plot · 20 × 30 m · North ↑')
rect(-10,-15,10,15,'#dce4cc','#5e7563')
rect(-7.5,-8,7.5,4,'#42514b','#283d36')
parts.append(f'<line x1="{X(-2.8)}" y1="{Y(-8)}" x2="{X(-2.8)}" y2="{Y(4)}" stroke="#879281" stroke-width="3"/>')
rect(1.2,1,3.4,2.8,'#c8dfdc')
rect(-7.5,4,7.5,5.6,'#c3a786')
rect(-2,-15,1.4,-8,'#e8e3d4')
rect(4.2,-15,7,-8.6,'#c9cabe')
rect(7.5,-8,8.5,4,'#e3ddcc')
rect(-3.1,-8,1.4,-7.2,'#e8b42e')
for e in D['elements']:
    if e['blender']['shape']=='tree':
        x,_,y=e['position'];r=25 if e['id'] in ['ph_0775','ph_0776'] else 39
        parts.append(f'<circle cx="{X(x)}" cy="{Y(y)}" r="{r}" fill="#819774" fill-opacity=".68" stroke="#667f5c"/>')
for y in [6.35,7.3,8.25,9.2,10.15,11.1]:rect(-1.15,y-.3,-.35,y+.3,'#e4dfce')
parts.append(f'<rect x="105" y="1012" width="690" height="55" fill="#7e8581"/>')
text(450,1048,'SOUTH / NEIGHBORHOOD STREET','label','text-anchor="middle" fill="#ffffff"')
text(450,302,'Connected rear family garden','label','text-anchor="middle"')
text(450,330,'11 m from house to north boundary','small','text-anchor="middle"')
text(450,615,'FOLDED ROOF','label','text-anchor="middle" style="fill:#f1eddd"')
text(450,642,'180 m² covered projection','body','text-anchor="middle" style="fill:#e1e7d5"')
text(450,676,'320 m² enclosed across two storeys','small','text-anchor="middle" style="fill:#e1e7d5"')
text(X(5.6),Y(-12),'1 car','small','text-anchor="middle"')
text(X(-.3),Y(-11.1),'Entry','small','text-anchor="middle"')
text(170,1109,'30% coverage', 'label')
text(460,1109,f'{garden:.1f} m² planted', 'label')
text(170,1136,'180 m² maximum covered footprint','small')
text(460,1136,'Conservative residual after all exclusions','small')
text(66,1185,'Concept only. Dimensions are fictional design inputs, not local planning rules.','small')
text(133,590,'WEST NEIGHBOR · 2.5 m setback','small','transform="rotate(-90 133 590)" text-anchor="middle"')
text(770,590,'EAST NEIGHBOR · 2.5 m setback','small','transform="rotate(90 770 590)" text-anchor="middle"')
parts.append('</svg>')
(OUT/'site-plan.svg').write_text('\n'.join(parts))

url='https://app.spline.design/file/ef8ae053-66b7-4c9a-bda7-0f41f999bc66'
readme=f'''# Pikachu House — Spline study

[Open the editable Spline file]({url}) · [View the local presentation](index.html)

Built with native Spline primitives, custom roof/floor meshes, shared materials, and procedural planting, using `project/design.json` as the canonical source. No Blender process or tool was used for this Spline build.

The folded roof translates the character's angular energy into a continuous architectural silhouette. The warm-yellow entry recess creates a bright arrival followed by a quieter neutral interior. A direct living/dining → covered garden room → rear garden sequence expresses movement and surprise. Bedrooms use restrained timber, ivory, and sage; V2 adds angled timber screens for side privacy and a yellow gallery screen. The roof, entry, room areas, and garden connection remain the same between V1 and V2.

| Check | Concept result |
|---|---:|
| Bedrooms / storeys | 3 / 2 |
| Ground / upper enclosed | {ground:.1f} / {upper:.1f} m² |
| Total enclosed / cap | 320 / 340 m² |
| Covered footprint / cap | 180 / 180 m² |
| Coverage | 30% |
| Conservative planted garden / minimum | {garden:.2f} / 240 m² |
| Setbacks south / north / east / west | 7 / 11 / 2.5 / 2.5 m |

Guest bedroom (18 m²) and a nearby shower are at entry level. Primary (28 m²) and child (20 m²) bedrooms are upstairs. Ground living/dining opens to a 12 m² covered garden room. Side walls, high service windows, and angled fins establish privacy intent; no measured privacy, environmental, structural, accessibility, or regulatory performance is claimed.

## Views and editing

- `v1-street.jpg` and `v2-street.jpg`: matching street perspectives comparing the privacy refinement.
- `ground-floor.jpg` and `upper-floor.jpg`: actual Spline floor views with the roof/ceilings temporarily hidden. The full enclosure is restored in the saved file.
- `site-plan.svg`: labeled site drawing generated from the canonical dimensions; `area-checks.json` records the arithmetic.
- Saved camera **02 Family room to garden**: an eye-level view from inside the living space toward the rear garden. Select it from Spline's camera menu. The saved street camera is **01 Street overview**.
- Spline's working screenshot limit prevented a separate capture of the family-to-garden camera. It is available in the editable file; no uncaptured image is represented as a render.

The `PH26 House` group contains separate ground/upper shells, interiors, roof, privacy screens, and lighting. Site and planting remain separately editable. Use the `PH26 yellow` material asset for a coordinated recolor. Individual elements retain canonical `ph_…` IDs in their names.

`scripts/compile_pikachu_spline.py` emits bounded DSL batches and a manifest. The `90`–`94` files record finishing, camera, and placement steps; foliage placement repairs contain this file's object IDs because the Spline generator initially left its child meshes unparented. Do not replay creation batches into the completed file. Two side trees were narrowed to keep foliage out of bedroom windows. The rendered views are concept illustrations, not construction drawings.
'''
(OUT/'README.md').write_text(readme)
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pikachu House · Spline</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f3eb;color:#273c35;font:16px/1.6 Arial,sans-serif}main{max-width:1180px;margin:auto;padding:56px 32px}small{letter-spacing:.13em;font-size:11px}h1{font:56px/1.06 Georgia,serif;max-width:750px;margin:20px 0}h2{font:30px Georgia,serif;margin:0 0 18px}p{max-width:740px}.link{display:inline-block;padding:12px 22px;background:#273c35;color:#fff;border-radius:4px;text-decoration:none;margin:14px 0 28px}.compare{position:relative;aspect-ratio:1280/1153;overflow:hidden;border-radius:12px;background:#bfcbd0}.compare img{position:absolute;width:100%;height:100%;object-fit:cover}.compare .new{clip-path:inset(0 0 0 50%)}.tag{position:absolute;top:22px;background:#f9f6ec;padding:5px 13px;border-radius:4px;font-size:12px}.left{left:22px}.right{right:22px}input{width:100%;accent-color:#be9225;margin:18px 0 6px}.caption{font-size:13px;color:#526259;margin:0 0 42px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:40px 0}.card img{width:100%;border-radius:8px}.site{display:grid;grid-template-columns:1.2fr 1fr;gap:40px;align-items:center}.site img{width:100%}table{border-collapse:collapse;width:100%}td{padding:10px 0;border-bottom:1px solid #d6dbce}td:last-child{text-align:right;font-weight:600}footer{margin-top:55px;border-top:1px solid #d6dbce;padding-top:24px;font-size:13px;color:#59665d}a{color:inherit}@media(max-width:700px){h1{font-size:40px}.grid,.site{grid-template-columns:1fr}main{padding:32px 18px}}
</style><main><small>ATELIER / SPLINE STUDY / JOO CHIAT</small><h1>Playfulness,<br>without a costume.</h1><p>A folded roof, a flash of warm yellow at the entrance, and family life that opens directly into a tropical garden.</p><a class="link" href="SPLINE_URL">Open the editable Spline model ↗</a><div class="compare"><img src="v1-street.jpg" alt="Initial house study"><img class="new" id="v2" src="v2-street.jpg" alt="House with refined timber privacy screens"><span class="tag left">V1 · initial study</span><span class="tag right">V2 · privacy refinement</span></div><input id="slider" type="range" min="0" max="100" value="50" aria-label="Compare V1 and V2"><p class="caption">Drag to compare. Roof, entry, floor areas, and garden connection are preserved; V2 adds angled screens.</p><div class="grid"><div class="card"><h2>Ground floor</h2><img src="ground-floor.jpg" alt="Ground floor Spline view"><p class="caption">Entry-level guest bedroom and shower, study, kitchen, living/dining, and covered garden room. 164.4 m² enclosed.</p></div><div class="card"><h2>Upper floor</h2><img src="upper-floor.jpg" alt="Upper floor Spline view"><p class="caption">Primary and child bedrooms, bathrooms, family lounge, and hobby gallery. 155.6 m² enclosed.</p></div></div><div class="site"><img src="site-plan.svg" alt="Labeled 20 by 30 metre site plan"><div><h2>Room to grow.</h2><p>The garden remains connected at the rear. A generous planted foreground balances the entry route and one car bay.</p><table><tr><td>Bedrooms / storeys</td><td>3 / 2</td></tr><tr><td>Enclosed floor area</td><td>320 m²</td></tr><tr><td>Covered footprint</td><td>180 m²</td></tr><tr><td>Site coverage</td><td>30%</td></tr><tr><td>Conservative planted area</td><td>319.56 m²</td></tr></table><p>For the view from inside, choose the saved camera <strong>02 Family room to garden</strong> in Spline.</p><p><a href="README.md">Design notes and editing guide ↗</a></p></div></div><footer>Concept design on a hypothetical site. Area checks use the canonical design geometry. No statutory, structural, environmental, or accessibility certification is implied.</footer></main><script>document.getElementById('slider').addEventListener('input',e=>document.getElementById('v2').style.clipPath=`inset(0 0 0 ${e.target.value}%)`)</script></html>'''.replace('SPLINE_URL',url)
(OUT/'index.html').write_text(page)
print(json.dumps(checks,indent=2))
