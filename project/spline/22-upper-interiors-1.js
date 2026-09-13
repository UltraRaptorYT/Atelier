const data = [
{"n":"PH26 | ph_0602 | Oak bed platform","m":"timber","p":[-237.5,181.0,-62.5],"s":[102.49999999999999,15.0,112.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0603 | Soft mattress","m":"linen","p":[-237.5,192.0,-62.5],"s":[95.0,12.5,105.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0604 | Bed cover","m":"linen","p":[-237.5,199.5,-48.5],"s":[96.24999999999999,3.5000000000000004,72.44999999999999],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0605 | Timber headboard","m":"timber","p":[-237.5,203.5,-121.0],"s":[112.5,60.0,6.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0606 | Linen pillow","m":"ceramic","p":[-261.25,202.99999999999997,-92.95],"s":[40.849999999999994,7.000000000000001,22.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0607 | Linen pillow","m":"ceramic","p":[-213.75000000000003,202.99999999999997,-92.95],"s":[40.849999999999994,7.000000000000001,22.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0608 | Bedside cabinet","m":"timber","p":[-306.0,185.0,-97.5],"s":[24.0,28.000000000000004,25.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0609 | Bedside ceramic lamp","m":"ceramic","p":[-306.0,209.0,-97.5],"s":[11.5,16.0,11.5],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0610 | Bedside cabinet","m":"timber","p":[-169.0,185.0,-97.5],"s":[24.0,28.000000000000004,25.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0611 | Bedside ceramic lamp","m":"ceramic","p":[-169.0,209.0,-97.5],"s":[11.5,16.0,11.5],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0612 | Primary woven rug","m":"linen","p":[-240.0,172.0,-65.0],"s":[180.0,1.25,170.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0613 | Primary wardrobe","m":"timber","p":[-350.0,233.0,-37.5],"s":[27.500000000000004,124.0,190.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0614 | Primary garden bench","m":"timber","p":[-235.0,186.0,-170.0],"s":[120.0,30.0,25.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0615 | Oak bed platform","m":"timber","p":[-260.0,181.0,285.0],"s":[67.5,15.0,112.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0616 | Soft mattress","m":"linen","p":[-260.0,192.0,285.0],"s":[60.0,12.5,105.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0617 | Bed cover","m":"sage","p":[-260.0,199.5,299.0],"s":[61.24999999999999,3.5000000000000004,72.44999999999999],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0618 | Timber headboard","m":"timber","p":[-260.0,203.5,226.5],"s":[77.49999999999999,60.0,6.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0619 | Linen pillow","m":"ceramic","p":[-275.0,202.99999999999997,254.55],"s":[25.8,7.000000000000001,22.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0620 | Linen pillow","m":"ceramic","p":[-245.00000000000003,202.99999999999997,254.55],"s":[25.8,7.000000000000001,22.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0621 | Bedside cabinet","m":"timber","p":[-311.00000000000006,185.0,250.0],"s":[24.0,28.000000000000004,25.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0622 | Bedside ceramic lamp","m":"ceramic","p":[-311.00000000000006,209.0,250.0],"s":[11.5,16.0,11.5],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0623 | Bedside cabinet","m":"timber","p":[-209.0,185.0,250.0],"s":[24.0,28.000000000000004,25.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0624 | Bedside ceramic lamp","m":"ceramic","p":[-209.0,209.0,250.0],"s":[11.5,16.0,11.5],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0625 | Child study desk","m":"timber","p":[-305.0,206.5,368.5],"s":[95.0,4.5,32.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0626 | Dining chair cushion","m":"sage","p":[-305.0,194.0,332.5],"s":[25.0,6.0,26.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0627 | Curved chair back","m":"timber","p":[-305.0,207.50000000000003,321.50000000000006],"s":[26.5,22.0,4.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0628 | Chair leg","m":"timber_dark","p":[-314.5,181.75,341.5],"s":[2.2999999999999687,23.800000000000022,2.2999999999999687],"r":0.0,"t":"rod","a":[-314.5,171.0,341.5],"b":[-314.5,192.5,341.5],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0629 | Chair leg","m":"timber_dark","p":[-314.5,181.75,323.50000000000006],"s":[2.2999999999999687,23.800000000000022,2.2999999999999687],"r":0.0,"t":"rod","a":[-314.5,171.0,323.50000000000006],"b":[-314.5,192.5,323.50000000000006],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0630 | Chair leg","m":"timber_dark","p":[-295.49999999999994,181.75,341.5],"s":[2.2999999999999687,23.800000000000022,2.2999999999999687],"r":0.0,"t":"rod","a":[-295.49999999999994,171.0,341.5],"b":[-295.49999999999994,192.5,341.5],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0631 | Chair leg","m":"timber_dark","p":[-295.49999999999994,181.75,323.50000000000006],"s":[2.2999999999999687,23.800000000000022,2.2999999999999687],"r":0.0,"t":"rod","a":[-295.49999999999994,171.0,323.50000000000006],"b":[-295.49999999999994,192.5,323.50000000000006],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0632 | Child quiet storage","m":"plaster","p":[-150.0,222.5,332.5],"s":[32.5,103.0,80.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0633 | Child circular reading rug","m":"sage","p":[-190.0,172.15,250.0],"s":[85.0,1.25,85.0],"r":0.0,"t":"cylinder","rev":1},
{"n":"PH26 | ph_0634 | Child reading pouf","m":"linen","p":[-190.0,183.5,222.5],"s":[30.0,25.0,30.0],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0635 | Wall hung ceramic WC","m":"ceramic","p":[-229.99999999999997,190.0,159.0],"s":[20.0,22.0,32.5],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0636 | Concealed WC tank","m":"plaster","p":[-229.99999999999997,206.0,143.00000000000003],"s":[24.0,40.0,8.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0637 | Ensuite vanity","m":"timber","p":[-337.5,200.0,165.0],"s":[50.0,32.5,22.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0638 | Ensuite basin","m":"ceramic","p":[-337.5,217.49999999999997,165.0],"s":[31.0,6.5,19.0],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0639 | Wall hung ceramic WC","m":"ceramic","p":[260.0,190.0,199.0],"s":[20.0,22.0,32.5],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0640 | Concealed WC tank","m":"plaster","p":[260.0,206.0,183.0],"s":[24.0,40.0,8.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0641 | Shared bath tub","m":"ceramic","p":[235.0,185.0,110.00000000000001],"s":[90.0,28.000000000000004,39.0],"r":0.0,"t":"ellipsoid","rev":1}
];
for (const q of data) {
  if (q.t === 'joinedwall') {
    const v=[];
    const tris=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
    for (const b of q.parts) {
      const p=[[b[0][0],b[1][0],-b[2][1]],[b[0][1],b[1][0],-b[2][1]],[b[0][1],b[1][0],-b[2][0]],[b[0][0],b[1][0],-b[2][0]],[b[0][0],b[1][1],-b[2][1]],[b[0][1],b[1][1],-b[2][1]],[b[0][1],b[1][1],-b[2][0]],[b[0][0],b[1][1],-b[2][0]]];
      for (const t of tris) { for (const i of t) { v.push(p[i][0],p[i][1],p[i][2]); } }
    }
    customMesh({vertices:v});
    position({x:0,y:0,z:0});
    visibility({side:'double'});
  } else if (q.t === 'mesh') {
    const v = [];
    for (const f of q.f) { for (const i of f) { v.push(q.v[i][0],q.v[i][1],q.v[i][2]); } }
    customMesh({vertices:v});
    position({x:0,y:0,z:0});
  } else if (q.t === 'rod') {
    const dx=q.b[0]-q.a[0],dy=q.b[1]-q.a[1],dz=q.b[2]-q.a[2];
    const len=Math.sqrt(dx*dx+dy*dy+dz*dz);
    mesh('Cylinder',{radius:q.rad,height:len,cornerRadius:0});
    position({x:(q.a[0]+q.b[0])/2,y:(q.a[1]+q.b[1])/2,z:(q.a[2]+q.b[2])/2});
    rotation({x:Math.acos(dy/len)*180/Math.PI,y:Math.atan2(dx,dz)*180/Math.PI,z:0});
  } else if (q.t === 'tree' || q.t === 'plant' || q.t === 'shrub') {
    tree({kind:q.t==='tree' ? (q.seed%3===0 ? 'palm' : 'oak') : 'bush',height:q.s[1],seed:q.seed,leafiness:0.85,style:'realistic',trunkColor:'#78654c',leafColor:q.t==='tree'?'#526b43':'#6e8253',name:q.n,position:[q.p[0],q.base,q.p[2]]});
  } else {
    if (q.t === 'ellipsoid') { mesh('Sphere',{width:q.s[0],height:q.s[1],depth:q.s[2]}); }
    else if (q.t === 'cylinder') { mesh('Cylinder',{radius:q.s[0]/2,height:q.s[1],cornerRadius:0.4}); }
    else { mesh('Cube',{width:q.s[0],height:q.s[1],depth:q.s[2],cornerRadius:0}); }
    position({x:q.p[0],y:q.p[1],z:q.p[2]});
    rotation({x:0,y:q.r,z:0});
  }
  rename(q.n);
  if (q.t !== 'tree' && q.t !== 'plant' && q.t !== 'shrub') { applyMaterial('PH26 '+q.m); }
  moveInto('PH26 Upper interiors');
}
