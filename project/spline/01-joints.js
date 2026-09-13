const names=["PH26 | ph_0045 | Entry west return 0.0","PH26 | ph_0046 | Entry east return 0.0","PH26 | ph_0048 | West privacy wall 0.0","PH26 | ph_0059 | East service wall 0.0","PH26 | ph_0074 | Garden living facade 0.0"];
select(o => names.includes(o.name));
remove();
const data = [
{"n":"PH26 | ph_0045 | Entry west return 0.0","m":"yellow","p":[-160.0,84.50000000000001,375.0],"s":[10.000000000000009,151.0,50.0],"r":0.0,"t":"joinedwall","rev":1,"parts":[[[-165.0,-155.0],[9.000000000000007,160.0],[-389.40000000000003,-350.0]]]},
{"n":"PH26 | ph_0046 | Entry east return 0.0","m":"yellow","p":[75.0,84.50000000000001,375.0],"s":[10.000000000000009,151.0,50.0],"r":0.0,"t":"joinedwall","rev":1,"parts":[[[70.0,80.0],[9.000000000000007,160.0],[-389.40000000000003,-350.0]]]},
{"n":"PH26 | ph_0048 | West privacy wall 0.0","m":"plaster","p":[-370.0,84.50000000000001,267.5],"s":[9.999999999999964,151.0,265.0],"r":0.0,"t":"joinedwall","rev":1,"parts":[[[-375.0,-365.00000000000006],[9.000000000000007,160.0],[-389.40000000000003,-135.0]]]},
{"n":"PH26 | ph_0059 | East service wall 0.0","m":"plaster","p":[370.0,84.50000000000001,287.5],"s":[9.999999999999964,151.0,225.0],"r":0.0,"t":"joinedwall","rev":1,"parts":[[[365.00000000000006,375.0],[9.000000000000007,160.0],[-389.40000000000003,-175.0]]]},
{"n":"PH26 | ph_0074 | Garden living facade 0.0","m":"plaster","p":[-360.0,84.50000000000001,-195.0],"s":[29.999999999999982,151.0,10.000000000000009],"r":0.0,"t":"joinedwall","rev":1,"parts":[[[-364.40000000000003,-345.0],[9.000000000000007,160.0],[190.0,200.0]]]}
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
  moveInto('PH26 Ground floor');
}
