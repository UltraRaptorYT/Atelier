const data = [
{"n":"PH26 | ph_0682 | Books / collection object","m":"sage","p":[-352.0,53.0,-77.5],"s":[12.5,14.500000000000002,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0683 | Books / collection object","m":"yellow","p":[-352.0,53.0,-84.25],"s":[12.5,18.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0684 | Books / collection object","m":"linen","p":[276.0,215.0,-44.99999999999999],"s":[12.5,11.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0685 | Books / collection object","m":"clay","p":[276.0,215.0,-51.74999999999999],"s":[12.5,14.500000000000002,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0686 | Books / collection object","m":"sage","p":[276.0,215.0,-58.5],"s":[12.5,18.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0687 | Books / collection object","m":"yellow","p":[276.0,215.0,-65.25],"s":[12.5,11.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0688 | Books / collection object","m":"linen","p":[276.0,215.0,-72.0],"s":[12.5,14.500000000000002,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0689 | Books / collection object","m":"clay","p":[276.0,215.0,-78.75],"s":[12.5,18.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0690 | Books / collection object","m":"sage","p":[276.0,215.0,-85.5],"s":[12.5,11.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0691 | Books / collection object","m":"yellow","p":[276.0,215.0,-92.25],"s":[12.5,14.500000000000002,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0692 | Books / collection object","m":"linen","p":[276.0,215.0,-99.0],"s":[12.5,18.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0693 | Books / collection object","m":"clay","p":[276.0,215.0,-105.75000000000001],"s":[12.5,11.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0694 | Books / collection object","m":"sage","p":[276.0,215.0,-112.5],"s":[12.5,14.500000000000002,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0695 | Books / collection object","m":"yellow","p":[276.0,215.0,-119.24999999999999],"s":[12.5,18.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0696 | Books / collection object","m":"linen","p":[276.0,215.0,357.5],"s":[12.5,11.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0697 | Books / collection object","m":"clay","p":[276.0,215.0,350.75],"s":[12.5,14.500000000000002,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0698 | Books / collection object","m":"sage","p":[276.0,215.0,343.99999999999994],"s":[12.5,18.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0699 | Books / collection object","m":"yellow","p":[276.0,215.0,337.24999999999994],"s":[12.5,11.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0700 | Books / collection object","m":"linen","p":[276.0,215.0,330.5],"s":[12.5,14.500000000000002,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0701 | Books / collection object","m":"clay","p":[276.0,215.0,323.75],"s":[12.5,18.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0702 | Books / collection object","m":"sage","p":[276.0,215.0,317.0],"s":[12.5,11.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0703 | Books / collection object","m":"yellow","p":[276.0,215.0,310.24999999999994],"s":[12.5,14.500000000000002,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0704 | Books / collection object","m":"linen","p":[276.0,215.0,303.49999999999994],"s":[12.5,18.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0705 | Books / collection object","m":"clay","p":[276.0,215.0,296.75],"s":[12.5,11.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0706 | Books / collection object","m":"sage","p":[276.0,215.0,289.99999999999994],"s":[12.5,14.500000000000002,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0707 | Books / collection object","m":"yellow","p":[276.0,215.0,283.24999999999994],"s":[12.5,18.0,4.0],"r":0.0,"t":"box","rev":1}
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
  moveInto('PH26 Upper interiors');
}
