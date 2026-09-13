const data = [
{"n":"PH26 | ph_0484 | Oak bed platform","m":"timber","p":[-265.0,19.0,282.5],"s":[87.5,15.0,112.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0485 | Soft mattress","m":"linen","p":[-265.0,30.0,282.5],"s":[80.0,12.5,105.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0486 | Bed cover","m":"linen","p":[-265.0,37.5,296.50000000000006],"s":[81.25,3.5000000000000004,72.44999999999999],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0487 | Timber headboard","m":"timber","p":[-265.0,41.5,224.00000000000003],"s":[97.50000000000001,60.0,6.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0488 | Linen pillow","m":"ceramic","p":[-285.0,41.0,252.05],"s":[34.400000000000006,7.000000000000001,22.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0489 | Linen pillow","m":"ceramic","p":[-244.99999999999997,41.0,252.05],"s":[34.400000000000006,7.000000000000001,22.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0490 | Bedside cabinet","m":"timber","p":[-326.0,23.0,247.5],"s":[24.0,28.000000000000004,25.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0491 | Bedside ceramic lamp","m":"ceramic","p":[-326.0,47.0,247.5],"s":[11.5,16.0,11.5],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0492 | Bedside cabinet","m":"timber","p":[-204.0,23.0,247.5],"s":[24.0,28.000000000000004,25.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0493 | Bedside ceramic lamp","m":"ceramic","p":[-204.0,47.0,247.5],"s":[11.5,16.0,11.5],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0494 | Guest wardrobe","m":"timber","p":[-350.0,71.5,215.0],"s":[28.000000000000004,125.0,80.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0495 | Guest woven rug","m":"linen","p":[-265.0,9.75,275.0],"s":[145.0,1.25,157.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0496 | Guest reading chair","m":"sage","p":[-192.5,30.0,197.5],"s":[34.0,40.0,34.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0497 | Wall hung ceramic WC","m":"ceramic","p":[-267.5,28.000000000000004,55.00000000000001],"s":[20.0,22.0,32.5],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0498 | Concealed WC tank","m":"plaster","p":[-267.5,43.99999999999999,39.0],"s":[24.0,40.0,8.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0499 | Accessible shower tray","m":"concrete","p":[-327.5,10.0,112.5],"s":[67.5,1.25,67.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0500 | Shower screen","m":"glass","p":[-291.5,62.5,118.5],"s":[0.75,105.0,62.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0501 | Shower vanity","m":"timber","p":[-327.5,34.0,48.5],"s":[60.0,34.0,24.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0502 | Shower basin","m":"ceramic","p":[-327.5,51.0,48.5],"s":[31.0,6.5,18.5],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0503 | Rain shower riser","m":"frame","p":[-359.0,89.99999999999999,125.0],"s":[1.7999999999999794,71.79999999999998,1.7999999999999794],"r":0.0,"t":"rod","a":[-359.0,55.00000000000001,125.0],"b":[-359.0,125.0,125.0],"rad":0.8999999999999999,"rev":1},
{"n":"PH26 | ph_0504 | Rain shower head","m":"frame","p":[-347.5,126.0,125.0],"s":[17.5,1.7500000000000002,17.5],"r":0.0,"t":"cylinder","rev":1},
{"n":"PH26 | ph_0505 | Study built in desk","m":"timber","p":[285.0,47.5,365.0],"s":[125.0,4.0,30.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0506 | Dining chair cushion","m":"sage","p":[285.0,32.0,332.5],"s":[25.0,6.0,26.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0507 | Curved chair back","m":"timber","p":[285.0,45.49999999999999,321.50000000000006],"s":[26.5,22.0,4.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0508 | Chair leg","m":"timber_dark","p":[275.5,19.75,341.5],"s":[2.2999999999999687,23.799999999999997,2.2999999999999687],"r":0.0,"t":"rod","a":[275.5,9.0,341.5],"b":[275.5,30.5,341.5],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0509 | Chair leg","m":"timber_dark","p":[275.5,19.75,323.50000000000006],"s":[2.2999999999999687,23.799999999999997,2.2999999999999687],"r":0.0,"t":"rod","a":[275.5,9.0,323.50000000000006],"b":[275.5,30.5,323.50000000000006],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0510 | Chair leg","m":"timber_dark","p":[294.5,19.75,341.5],"s":[2.2999999999999687,23.799999999999997,2.2999999999999687],"r":0.0,"t":"rod","a":[294.5,9.0,341.5],"b":[294.5,30.5,341.5],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0511 | Chair leg","m":"timber_dark","p":[294.5,19.75,323.50000000000006],"s":[2.2999999999999687,23.799999999999997,2.2999999999999687],"r":0.0,"t":"rod","a":[294.5,9.0,323.50000000000006],"b":[294.5,30.5,323.50000000000006],"rad":1.15,"rev":1},
{"n":"PH26 | ph_0512 | Study laptop","m":"frame","p":[285.0,53.0,360.0],"s":[22.5,1.25,15.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0513 | Study bookshelf","m":"timber","p":[350.0,74.0,270.0],"s":[27.500000000000004,130.0,85.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0514 | Laundry cabinet","m":"plaster","p":[130.0,70.0,325.0],"s":[82.5,120.0,30.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0515 | Laundry machine","m":"ceramic","p":[130.0,32.5,232.50000000000003],"s":[32.5,45.0,32.5],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0516 | Wall hung ceramic WC","m":"ceramic","p":[125.0,28.000000000000004,182.5],"s":[20.0,22.0,32.5],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0517 | Concealed WC tank","m":"plaster","p":[125.0,43.99999999999999,166.5],"s":[24.0,40.0,8.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0518 | Powder hand basin","m":"ceramic","p":[95.5,49.0,126.0],"s":[24.0,7.000000000000001,19.0],"r":0.0,"t":"ellipsoid","rev":1},
{"n":"PH26 | ph_0519 | Living woven rug","m":"linen","p":[-235.0,10.25,-70.0],"s":[212.5,1.25,150.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0520 | Sofa lower plinth","m":"timber_dark","p":[-240.0,18.0,-12.5],"s":[162.5,11.5,50.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0521 | Sofa seat cushion","m":"linen","p":[-294.16666666666663,30.0,-10.0],"s":[52.166666666666664,12.5,41.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0522 | Sofa seat cushion","m":"linen","p":[-240.0,30.0,-10.0],"s":[52.166666666666664,12.5,41.0],"r":0.0,"t":"box","rev":1},
{"n":"PH26 | ph_0523 | Sofa seat cushion","m":"linen","p":[-185.83333333333331,30.0,-10.0],"s":[52.166666666666664,12.5,41.0],"r":0.0,"t":"box","rev":1}
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
  moveInto('PH26 Ground interiors');
}
