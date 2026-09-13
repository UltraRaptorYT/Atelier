const data = [
{"n":"PH26 | ph_0642 | Family bathroom vanity","m":"timber","p":[180.0,200.0,204.99999999999997],"s":[50.0,32.5,22.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0643 | Sofa lower plinth","m":"timber_dark","p":[140.0,180.0,-37.5],"s":[152.5,11.5,50.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0644 | Sofa seat cushion","m":"sage","p":[89.16666666666666,192.0,-35.0],"s":[48.83333333333333,12.5,41.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0645 | Sofa seat cushion","m":"sage","p":[140.0,192.0,-35.0],"s":[48.83333333333333,12.5,41.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0646 | Sofa seat cushion","m":"sage","p":[190.83333333333331,192.0,-35.0],"s":[48.83333333333333,12.5,41.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0647 | Sofa back","m":"sage","p":[140.0,204.99999999999997,-59.0],"s":[152.5,32.5,11.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0648 | Sofa arm","m":"sage","p":[63.74999999999999,197.0,-37.5],"s":[9.5,25.0,50.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0649 | Sofa arm","m":"sage","p":[216.24999999999997,197.0,-37.5],"s":[9.5,25.0,50.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0650 | Ochre cushion","m":"yellow","p":[98.82499999999999,206.99999999999997,-45.0],"s":[22.0,21.5,9.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0651 | Sage cushion","m":"sage","p":[179.65,206.99999999999997,-45.0],"s":[23.0,22.0,9.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0652 | Family lounge rug","m":"linen","p":[140.0,172.25,-90.0],"s":[235.0,1.25,150.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0653 | Family lounge table","m":"timber","p":[140.0,191.0,-107.5],"s":[55.00000000000001,8.0,37.5],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0654 | Garden window reading bench","m":"timber","p":[152.5,186.0,-174.0],"s":[235.0,30.0,27.500000000000004],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0655 | Shared toy and book storage","m":"timber","p":[276.0,200.0,-85.0],"s":[22.5,57.99999999999999,130.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0656 | Terracotta planter","m":"clay","p":[35.0,179.4,-159.0],"s":[23.2,16.8,23.2],"r":0.0,"t":"cylinder","rev":1},
{"n":"PH26 | ph_0657 | Tropical broad leaf plant","m":"leaf","p":[35.0,200.99999999999997,-159.0],"s":[46.0,44.00000000000001,46.0],"r":0.0,"t":"plant","seed":657,"base":187.0,"rev":1},
{"n":"PH26 | ph_0658 | Hobby gallery worktop","m":"timber","p":[150.0,210.0,355.0],"s":[185.0,4.0,35.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0659 | Dining chair cushion","m":"linen","p":[112.5,194.0,319.0],"s":[25.0,6.0,26.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0660 | Curved chair back","m":"timber","p":[112.5,207.50000000000003,308.0],"s":[26.5,22.0,4.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0661 | Chair leg","m":"timber_dark","p":[103.0,181.75,328.0],"s":[2.300000000000013,23.800000000000022,2.2999999999999687],"r":0.0,"t":"rod","a":[103.0,171.0,328.0],"b":[103.0,192.5,328.0],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0662 | Chair leg","m":"timber_dark","p":[103.0,181.75,310.0],"s":[2.300000000000013,23.800000000000022,2.2999999999999687],"r":0.0,"t":"rod","a":[103.0,171.0,310.0],"b":[103.0,192.5,310.0],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0663 | Chair leg","m":"timber_dark","p":[122.0,181.75,328.0],"s":[2.300000000000013,23.800000000000022,2.2999999999999687],"r":0.0,"t":"rod","a":[122.0,171.0,328.0],"b":[122.0,192.5,328.0],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0664 | Chair leg","m":"timber_dark","p":[122.0,181.75,310.0],"s":[2.300000000000013,23.800000000000022,2.2999999999999687],"r":0.0,"t":"rod","a":[122.0,171.0,310.0],"b":[122.0,192.5,310.0],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0665 | Dining chair cushion","m":"linen","p":[182.5,194.0,319.0],"s":[25.0,6.0,26.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0666 | Curved chair back","m":"timber","p":[182.5,207.50000000000003,308.0],"s":[26.5,22.0,4.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0667 | Chair leg","m":"timber_dark","p":[173.0,181.75,328.0],"s":[2.300000000000013,23.800000000000022,2.2999999999999687],"r":0.0,"t":"rod","a":[173.0,171.0,328.0],"b":[173.0,192.5,328.0],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0668 | Chair leg","m":"timber_dark","p":[173.0,181.75,310.0],"s":[2.300000000000013,23.800000000000022,2.2999999999999687],"r":0.0,"t":"rod","a":[173.0,171.0,310.0],"b":[173.0,192.5,310.0],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0669 | Chair leg","m":"timber_dark","p":[192.0,181.75,328.0],"s":[2.300000000000013,23.800000000000022,2.2999999999999687],"r":0.0,"t":"rod","a":[192.0,171.0,328.0],"b":[192.0,192.5,328.0],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0670 | Chair leg","m":"timber_dark","p":[192.0,181.75,310.0],"s":[2.300000000000013,23.800000000000022,2.2999999999999687],"r":0.0,"t":"rod","a":[192.0,171.0,310.0],"b":[192.0,192.5,310.0],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0671 | Gallery display shelving","m":"timber","p":[276.0,233.5,317.5],"s":[22.5,125.0,110.00000000000001],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0672 | Books / collection object","m":"linen","p":[-352.0,53.0,-9.999999999999998],"s":[12.5,11.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0673 | Books / collection object","m":"clay","p":[-352.0,53.0,-16.75],"s":[12.5,14.500000000000002,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0674 | Books / collection object","m":"sage","p":[-352.0,53.0,-23.5],"s":[12.5,18.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0675 | Books / collection object","m":"yellow","p":[-352.0,53.0,-30.25],"s":[12.5,11.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0676 | Books / collection object","m":"linen","p":[-352.0,53.0,-37.0],"s":[12.5,14.500000000000002,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0677 | Books / collection object","m":"clay","p":[-352.0,53.0,-43.75],"s":[12.5,18.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0678 | Books / collection object","m":"sage","p":[-352.0,53.0,-50.5],"s":[12.5,11.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0679 | Books / collection object","m":"yellow","p":[-352.0,53.0,-57.25],"s":[12.5,14.500000000000002,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0680 | Books / collection object","m":"linen","p":[-352.0,53.0,-64.0],"s":[12.5,18.0,4.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0681 | Books / collection object","m":"clay","p":[-352.0,53.0,-70.75],"s":[12.5,11.0,4.0],"r":0.0,"t":"box","rev":1}
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
