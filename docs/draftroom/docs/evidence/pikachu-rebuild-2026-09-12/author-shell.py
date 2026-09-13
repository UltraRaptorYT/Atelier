import json,math,pathlib
D=pathlib.Path('docs/evidence/pikachu-rebuild-2026-09-12'); T=pathlib.Path('/tmp/rebuild-work');T.mkdir(exist_ok=True)
C={'wall':'#e4dfd2','floor':'#cbbb9e','yellow':'#cda834','wood':'#a98d69','dark':'#34413e','glass':'#76908d','green':'#738568','pave':'#b8b5a9'}
B=[];M=[];requests=[]
def world(x,y,z):return [(x-10)*50,y*50,(15-z)*50]
def box(n,a,b,c,d,e,f,col='wall'):
 p=world((a+b)/2,(c+d)/2,(e+f)/2);s=[(b-a)*50,(d-c)*50,(f-e)*50]
 B.extend([f"mesh('Cube',{{width:{s[0]},height:{s[1]},depth:{s[2]},cornerRadius:0}});",'position('+json.dumps(dict(zip(['x','y','z'],p)))+');',f"color('{C.get(col,col)}');",f"rename('{n}');"])
 M.append(dict(name=n,boundsM=[a,b,c,d,e,f],position=p,size=s))
def save(title):
 requests.append({'method':'tools/call','params':{'name':'3d_run_code','arguments':{'title':title,'code':'\n'.join(B),'screenshot':False}}});B.clear()
def wx(n,x,z0,z1,y0,y1,doors=[],t=.16,col='wall'):
 cursor=z0
 for i,(a,b,h) in enumerate(sorted(doors)):
  if a>cursor:box(n+' segment '+str(i),x-t/2,x+t/2,y0,y1,cursor,a,col)
  if h<y1-y0:box(n+' lintel '+str(i),x-t/2,x+t/2,y0+h,y1,a,b,col)
  cursor=b
 if cursor<z1:box(n+' end',x-t/2,x+t/2,y0,y1,cursor,z1,col)
def wz(n,z,x0,x1,y0,y1,doors=[],t=.16,col='wall'):
 cursor=x0
 for i,(a,b,h) in enumerate(sorted(doors)):
  if a>cursor:box(n+' segment '+str(i),cursor,a,y0,y1,z-t/2,z+t/2,col)
  if h<y1-y0:box(n+' lintel '+str(i),a,b,y0+h,y1,z-t/2,z+t/2,col)
  cursor=b
 if cursor<x1:box(n+' end',cursor,x1,y0,y1,z-t/2,z+t/2,col)
def window(n,z,a,b,y0,y1,base,top):
 box(n+' sill',a,b,base,y0,z-.08,z+.08)
 box(n+' head',a,b,y1,top,z-.08,z+.08)
 box(n+' glass',a+.035,b-.035,y0+.035,y1-.035,z-.025,z+.025,'glass')
 for x in [a+.0175,b-.0175]:box(n+' jamb '+str(x),x-.0175,x+.0175,y0,y1,z-.06,z+.06,'dark')
def prism(n,poly,z0,z1,col):
 # polygon specified counterclockwise x/y, reverse needed world z mapping handled indices
 verts=[world(x,y,z) for z in [z0,z1] for x,y in poly]; k=len(poly);inds=[]
 for i in range(1,k-1):inds += [0,i+1,i,k,k+i,k+i+1]
 for i in range(k):j=(i+1)%k;inds += [i,j,k+j,i,k+j,k+i]
 inds=[v for i in range(0,len(inds),3) for v in [inds[i],inds[i+2],inds[i+1]]]
 B.extend(['customMesh('+json.dumps({'vertices':[a for v in verts for a in v],'indices':inds})+');',"position({x:0,y:0,z:0});",f"color('{C[col]}');",f"rename('{n}');"])
 M.append(dict(name=n,polygonM=poly,zM=[z0,z1],kind='prism'))
# Ground L-shaped enclosure and distinct recessed garden threshold
box('G_floor_south',4,16,-.2,0,7,19,'floor');box('G_floor_rear',8,16,-.2,0,19,22,'floor');box('T_garden_threshold',4,8,-.2,0,19,22,'wood')
# continuous level 2 slab with exact stair void x10.5..12,z11..15.76
for n,a,b,e,f in [('west',4,10.5,7,22),('east',12,14.6,7,22),('south',10.5,12,7,11.5),('north',10.5,12,16.26,22)]:box('U_floor_'+n,a,b,3,3.2,e,f,'floor')
box('T_east_roof_deck',14.6,16,3,3.2,7,22,'wood')
wx('G_west',4.1,7.2,19,0,3);wx('G_east',15.9,7.2,21.8,0,3)
wx('G_threshold_return',8,19.1,21.8,0,3,[(19.7,21.1,2.5)])
wz('G_threshold_slider',19,4.2,8.08,0,3,[(4.5,7.5,2.65)])
for x in [4.1,7.9]:box('T_threshold_column_'+str(x),x-.06,x+.06,0,3,21.82,21.94,'dark')
save('Assembling continuous floor junctions')
# south facade real entry + windows
wz('G_south',7.1,4,16,0,3,[(4.7,7.3,3),(8.8,10.1,2.4),(12.6,15.1,3)],t=.2)
window('G_guest_window',7.1,4.7,7.3,.8,2.4,0,3);window('G_study_window',7.1,12.6,15.1,.8,2.4,0,3)
# door leaf shown open at right jamb leaving clear opening
box('G_entry_open_leaf',10.03,10.09,0,2.35,7.15,8.35,'wood')
wz('G_north',21.9,8.08,16,0,3,[(8.7,11.7,2.65),(12.5,15.2,3)],t=.2)
window('G_kitchen_north',21.9,12.5,15.2,.8,2.4,0,3)
# wall/slab jambs intentionally meet, no openings faked on opaque walls
wx('G_guest_east',8,7.2,11.5,0,3,[(8.3,9.3,2.2)])
wz('G_guest_north',11.5,4.2,7.92,0,3)
wx('G_service_west',12,7.2,20,0,3,[(8,9,2.2),(10.3,11.3,2.2),(16.4,18.7,2.65)])
wz('G_study_north',10,12.08,15.8,0,3);wz('G_shower_north',12.5,12.08,15.8,0,3);wz('G_utility_north',15,12.08,15.8,0,3,[(13.3,14.3,2.2)])
save('Opening entry and ground rooms')
# upper enclosure, both sides privacy, roof stays entirely within180sqm footprint
wx('U_west_privacy',4.1,7.2,21.8,3.2,6.26,t=.2)
wx('U_east_privacy',14.5,7.2,21.8,3.2,6.53,[(16.1,17.1,2.2)],t=.2)
wz('U_south',7.1,4,14.6,3.2,6.2,[(4.8,8.2,3),(9.4,13.8,3)],t=.2)
window('U_child_window',7.1,4.8,8.2,4.1,5.65,3.2,6.2);window('U_landing_window',7.1,9.4,13.8,4.1,5.65,3.2,6.2)
wz('U_north',21.9,4,14.6,3.2,6.2,[(4.8,10.2,3),(11.7,13.8,3)],t=.2)
window('U_primary_window',21.9,4.8,10.2,4.1,5.7,3.2,6.2);window('U_dressing_window',21.9,11.7,13.8,4.1,5.7,3.2,6.2)
wx('U_child_east',9,7.2,11,3.2,6.2,[(8.8,9.8,2.2)])
wz('U_child_north',11,4.2,8.92,3.2,6.2)
wz('U_primary_south',18,4.2,14.4,3.2,6.2,[(10.2,11.2,2.2)])
wx('U_primary_dressing',11,18.08,21.8,3.2,6.2,[(19,20,2.2)])
wx('U_bath_west',12.08,11,15.9,3.2,6.2)
wz('U_bath_south',11,12.16,14.4,3.2,6.2)
# bath north door actual break to landing, not on stair side
wz('U_bath_north',15.9,12.16,14.4,3.2,6.2,[(12.7,13.65,2.2)])
save('Enclosing calm upper rooms')
# stair18risers and17treads, topfloor is18th riser atz15.76
for i in range(1,18):
 box('G_stair_tread_'+str(i),10.65,11.85,0,i*3.2/18,11.5+(i-1)*.28,11.5+i*.28,'wood')
# solid balustrade to west, rail segments follow stairs; north landing open into upperhall
for i in range(18):
 y=i*3.2/18;z=11.5+i*.28
 box('G_stair_guard_'+str(i),10.54,10.59,y,y+1,z-.025,z+.025,'dark')
# upper edgeguards cannot span route at landing
box('U_stair_west_guard',10.44,10.5,3.2,4.2,11.5,16.26,'dark')
box('U_stair_east_guard',12,12.06,3.2,4.2,11.5,16.26,'dark')
# terrace privacyguard
box('T_east_parapet',15.85,16,3.2,4.25,7,22)
box('T_south_parapet',14.6,15.85,3.2,4.25,7,7.15)
box('T_north_parapet',14.6,15.85,3.2,4.25,21.85,22)
save('Connecting stairs and landing')
# folded roof twoclosed solids with front/rear infill triangles to avoid facadegaps
prism('R_west_fold',[(4,6.2),(8,7.3),(8,7.46),(4,6.36)],7,22,'yellow')
prism('R_east_fold',[(8,7.3),(14.6,6.5),(14.6,6.66),(8,7.46)],7,22,'wall')
for z0,z1,side in [(7,7.2,'south'),(21.8,22,'north')]:
 prism('R_'+side+'_west_infill',[(4,6.2),(8,6.2),(8,7.3)],z0,z1,'wall')
 prism('R_'+side+'_east_infill',[(8,6.2),(14.6,6.2),(14.6,6.5),(8,7.3)],z0,z1,'wall')
# entry folded threshold ceiling under upperfloor, not extrafootprint
box('G_entry_reveal',8.4,8.58,0,2.8,7.2,9,'yellow')
box('G_entry_ceiling',8.4,10.45,2.8,2.95,7.2,9,'yellow')
# restrained frame screens tochild bedroom facade, functionprivacy
for i in range(13):box('U_child_screen_'+str(i),4.8+i*.28,4.85+i*.28,4,5.95,7,7.06,'wood')
B+= ["background('#e8e5dc');","environment({ao:true,ambient:{color:'#e6e9f0',intensity:0.8}});","select(o=>o.isLight);","updateLight({intensity:0.85,size:2400,shadowRadius:3});","position({x:-600,y:1000,z:800});"]
save('Closing the folded lantern roof')
# site restrainedno detailedlandscape atshellcheckpoint
box('S_site',0,20,-.35,-.21,0,30,'green')
box('S_parking',13.5,16.3,-.21,0,1,6,'pave')
box('S_entry_path',8.7,10.3,-.21,0,0,7,'pave')
box('S_rear_threshold_step',4,8,-.21,-.05,22,22.6,'wood')
# program proxies only
for n,a,b,e,f in [('G_guest_bed',4.8,6.4,8.4,10.4),('U_child_bed',5,6.2,8.2,10.2),('U_primary_bed',5.2,7,19.2,21.2)]:
 base=3.2 if n.startswith('U') else 0
 box(n,a,b,base,base+.45,e,f,'wood')
box('G_shower_proxy',14.5,15.5,0,.05,11,12,'glass');box('U_shower_proxy',13.2,14.2,3.2,3.25,11.5,12.5,'glass')
box('G_kitchen_proxy',15.1,15.7,0,.9,15.5,19.5,'wood')
box('G_living_proxy',4.7,5.5,0,.7,14,16.6,'wood');box('G_dining_proxy',8.8,10.6,0,.75,19.6,20.5,'wood');box('U_family_proxy',5,7.5,3.2,3.9,14,14.8,'wood')
save('Locating garden and program proxies')
# organizeafterreadbackto keepunparentedworld coordsavailable
json.dump(M,open(D/'intended-geometry.json','w'),indent=2)
for i,r in enumerate(requests):json.dump(r,open(T/f'build-{i}.json','w'))
print(len(M),'objects',len(requests),'batches')
