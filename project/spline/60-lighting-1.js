const data = [
{"n":"PH26 | ph_0818 | Dining linear pendant","m":"light","p":[50.0,127.49999999999999,-90.0],"s":[114.99999999999999,3.25,2.75],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0819 | Pendant suspension","m":"frame","p":[25.0,143.25,-90.0],"s":[0.6000000000000005,32.099999999999994,0.6000000000000005],"r":0.0,"t":"rod","a":[25.0,127.49999999999999,-90.0],"b":[25.0,159.0,-90.0],"rad":0.3,"rev":1},
{"n":"PH26 | ph_0820 | Pendant suspension","m":"frame","p":[75.0,143.25,-90.0],"s":[0.6000000000000005,32.099999999999994,0.6000000000000005],"r":0.0,"t":"rod","a":[75.0,127.49999999999999,-90.0],"b":[75.0,159.0,-90.0],"rad":0.3,"rev":1},
{"n":"PH26 | ph_0821 | Kitchen linear pendant","m":"light","p":[225.0,131.0,65.0],"s":[3.5000000000000004,3.5000000000000004,90.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0822 | Pendant suspension","m":"frame","p":[200.0,145.00000000000003,65.0],"s":[0.6000000000000005,28.59999999999998,0.6000000000000005],"r":0.0,"t":"rod","a":[200.0,131.0,65.0],"b":[200.0,159.0,65.0],"rad":0.3,"rev":1},
{"n":"PH26 | ph_0823 | Pendant suspension","m":"frame","p":[250.0,145.00000000000003,65.0],"s":[0.6000000000000227,28.59999999999998,0.6000000000000005],"r":0.0,"t":"rod","a":[250.0,131.0,65.0],"b":[250.0,159.0,65.0],"rad":0.3,"rev":1},
{"n":"PH26 | ph_0824 | Entry reveal light","m":"light","p":[-42.5,147.0,370.0],"s":[195.0,1.7500000000000002,2.75],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0825 | Pendant suspension","m":"frame","p":[-67.5,153.0,370.0],"s":[0.6000000000000005,12.599999999999989,0.6000000000000227],"r":0.0,"t":"rod","a":[-67.5,147.0,370.0],"b":[-67.5,159.0,370.0],"rad":0.3,"rev":1},
{"n":"PH26 | ph_0826 | Pendant suspension","m":"frame","p":[-17.5,153.0,370.0],"s":[0.6000000000000005,12.599999999999989,0.6000000000000227],"r":0.0,"t":"rod","a":[-17.5,147.0,370.0],"b":[-17.5,159.0,370.0],"rad":0.3,"rev":1}
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
    rotation({x:Math.atan2(dz,dy)*180/Math.PI,y:0,z:-Math.asin(dx/len)*180/Math.PI});
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
  moveInto('PH26 Lighting');
}
