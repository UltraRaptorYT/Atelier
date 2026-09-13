const data = [
{"n":"PH26 | ph_0773 | Frangipani / tropical canopy","m":"leaf","p":[-427.50000000000006,114.99999999999999,535.0],"s":[150.0,229.99999999999997,150.0],"r":0.0,"t":"tree","seed":71,"base":0,"rev":1},
{"n":"PH26 | ph_0774 | Frangipani / tropical canopy","m":"leaf","p":[-265.0,95.0,605.0],"s":[150.0,190.0,150.0],"r":0.0,"t":"tree","seed":72,"base":0,"rev":1},
{"n":"PH26 | ph_0775 | Frangipani / tropical canopy","m":"leaf","p":[430.0,120.0,245.00000000000003],"s":[114.99999999999999,240.0,114.99999999999999],"r":0.0,"t":"tree","seed":73,"base":0,"rev":1},
{"n":"PH26 | ph_0776 | Frangipani / tropical canopy","m":"leaf","p":[-430.0,125.0,-80.0],"s":[145.0,250,145.0],"r":0.0,"t":"tree","seed":74,"base":0,"rev":1},
{"n":"PH26 | ph_0777 | Frangipani / tropical canopy","m":"leaf","p":[-390.0,140.0,-434.99999999999994],"s":[215.0,280.0,215.0],"r":0.0,"t":"tree","seed":75,"base":0,"rev":1},
{"n":"PH26 | ph_0778 | Frangipani / tropical canopy","m":"leaf","p":[340.0,125.0,-450],"s":[204.99999999999997,250.0,204.99999999999997],"r":0.0,"t":"tree","seed":76,"base":0,"rev":1},
{"n":"PH26 | ph_0779 | Frangipani / tropical canopy","m":"leaf","p":[-200,114.99999999999999,-660.0],"s":[180.0,229.99999999999997,180.0],"r":0.0,"t":"tree","seed":77,"base":0,"rev":1},
{"n":"PH26 | ph_0780 | Frangipani / tropical canopy","m":"leaf","p":[420.0,112.5,-655.0],"s":[145.0,225.0,145.0],"r":0.0,"t":"tree","seed":78,"base":0,"rev":1},
{"n":"PH26 | ph_0781 | Tropical broad leaf plant","m":"leaf","p":[-425.0,44.625,300],"s":[66.12499999999999,63.24999999999999,66.12499999999999],"r":0.0,"t":"plant","seed":781,"base":1.5,"rev":1},
{"n":"PH26 | ph_0782 | Tropical broad leaf plant","m":"leaf","p":[-420.0,44.625,150],"s":[66.12499999999999,63.24999999999999,66.12499999999999],"r":0.0,"t":"plant","seed":782,"base":1.5,"rev":1},
{"n":"PH26 | ph_0783 | Tropical broad leaf plant","m":"leaf","p":[445.0,44.625,-25.0],"s":[66.12499999999999,63.24999999999999,66.12499999999999],"r":0.0,"t":"plant","seed":783,"base":1.5,"rev":1},
{"n":"PH26 | ph_0784 | Tropical broad leaf plant","m":"leaf","p":[425.0,44.625,-245.00000000000003],"s":[66.12499999999999,63.24999999999999,66.12499999999999],"r":0.0,"t":"plant","seed":784,"base":1.5,"rev":1},
{"n":"PH26 | ph_0785 | Tropical broad leaf plant","m":"leaf","p":[-405.0,44.625,-320.0],"s":[66.12499999999999,63.24999999999999,66.12499999999999],"r":0.0,"t":"plant","seed":785,"base":1.5,"rev":1},
{"n":"PH26 | ph_0786 | Tropical broad leaf plant","m":"leaf","p":[390.0,44.625,-325.0],"s":[66.12499999999999,63.24999999999999,66.12499999999999],"r":0.0,"t":"plant","seed":786,"base":1.5,"rev":1},
{"n":"PH26 | ph_0787 | Tropical broad leaf plant","m":"leaf","p":[-325.0,44.625,-640.0],"s":[66.12499999999999,63.24999999999999,66.12499999999999],"r":0.0,"t":"plant","seed":787,"base":1.5,"rev":1},
{"n":"PH26 | ph_0788 | Tropical broad leaf plant","m":"leaf","p":[-100,44.625,-680.0],"s":[66.12499999999999,63.24999999999999,66.12499999999999],"r":0.0,"t":"plant","seed":788,"base":1.5,"rev":1},
{"n":"PH26 | ph_0789 | Tropical broad leaf plant","m":"leaf","p":[100,44.625,-680.0],"s":[66.12499999999999,63.24999999999999,66.12499999999999],"r":0.0,"t":"plant","seed":789,"base":1.5,"rev":1},
{"n":"PH26 | ph_0790 | Tropical broad leaf plant","m":"leaf","p":[240.0,44.625,-635.0],"s":[66.12499999999999,63.24999999999999,66.12499999999999],"r":0.0,"t":"plant","seed":790,"base":1.5,"rev":1},
{"n":"PH26 | ph_0791 | Tropical broad leaf plant","m":"leaf","p":[-340.0,44.625,520.0],"s":[66.12499999999999,63.24999999999999,66.12499999999999],"r":0.0,"t":"plant","seed":791,"base":1.5,"rev":1},
{"n":"PH26 | ph_0792 | Tropical broad leaf plant","m":"leaf","p":[135.0,44.625,620.0],"s":[66.12499999999999,63.24999999999999,66.12499999999999],"r":0.0,"t":"plant","seed":792,"base":1.5,"rev":1},
{"n":"PH26 | ph_0793 | Tropical broad leaf plant","m":"leaf","p":[150.0,44.625,450.0],"s":[66.12499999999999,63.24999999999999,66.12499999999999],"r":0.0,"t":"plant","seed":793,"base":1.5,"rev":1},
{"n":"PH26 | ph_0794 | North lush underplanting","m":"leaf_light","p":[-440.00000000000006,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":100,"base":0,"rev":1},
{"n":"PH26 | ph_0795 | North lush underplanting","m":"leaf_light","p":[-378.0,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":101,"base":0,"rev":1},
{"n":"PH26 | ph_0796 | North lush underplanting","m":"leaf_light","p":[-316.0,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":102,"base":0,"rev":1},
{"n":"PH26 | ph_0797 | North lush underplanting","m":"leaf_light","p":[-254.00000000000006,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":103,"base":0,"rev":1},
{"n":"PH26 | ph_0798 | North lush underplanting","m":"leaf_light","p":[-192.00000000000003,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":104,"base":0,"rev":1},
{"n":"PH26 | ph_0799 | North lush underplanting","m":"leaf_light","p":[-130.00000000000003,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":105,"base":0,"rev":1},
{"n":"PH26 | ph_0800 | North lush underplanting","m":"leaf_light","p":[-68.00000000000006,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":106,"base":0,"rev":1},
{"n":"PH26 | ph_0801 | North lush underplanting","m":"leaf_light","p":[-6.00000000000005,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":107,"base":0,"rev":1},
{"n":"PH26 | ph_0802 | North lush underplanting","m":"leaf_light","p":[55.99999999999996,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":108,"base":0,"rev":1},
{"n":"PH26 | ph_0803 | North lush underplanting","m":"leaf_light","p":[117.99999999999997,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":109,"base":0,"rev":1},
{"n":"PH26 | ph_0804 | North lush underplanting","m":"leaf_light","p":[179.99999999999997,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":110,"base":0,"rev":1},
{"n":"PH26 | ph_0805 | North lush underplanting","m":"leaf_light","p":[242.0,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":111,"base":0,"rev":1},
{"n":"PH26 | ph_0806 | North lush underplanting","m":"leaf_light","p":[303.9999999999999,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":112,"base":0,"rev":1},
{"n":"PH26 | ph_0807 | North lush underplanting","m":"leaf_light","p":[366.0,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":113,"base":0,"rev":1},
{"n":"PH26 | ph_0808 | North lush underplanting","m":"leaf_light","p":[427.99999999999994,26.0,-700.0],"s":[65.0,52.5,75.0],"r":0.0,"t":"shrub","seed":114,"base":0,"rev":1},
{"n":"PH26 | ph_0809 | West planted border","m":"leaf","p":[-455.99999999999994,22.5,350.0],"s":[57.49999999999999,42.5,95.0],"r":0.0,"t":"shrub","seed":140,"base":0,"rev":1},
{"n":"PH26 | ph_0810 | West planted border","m":"leaf","p":[-455.99999999999994,22.5,254.99999999999997],"s":[57.49999999999999,42.5,95.0],"r":0.0,"t":"shrub","seed":141,"base":0,"rev":1},
{"n":"PH26 | ph_0811 | West planted border","m":"leaf","p":[-455.99999999999994,22.5,160.0],"s":[57.49999999999999,42.5,95.0],"r":0.0,"t":"shrub","seed":142,"base":0,"rev":1},
{"n":"PH26 | ph_0812 | West planted border","m":"leaf","p":[-455.99999999999994,22.5,65.00000000000003],"s":[57.49999999999999,42.5,95.0],"r":0.0,"t":"shrub","seed":143,"base":0,"rev":1}
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
  moveInto('PH26 Tropical garden');
}
