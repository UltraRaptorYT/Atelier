const shots=[{"n":"01 Street overview","p":[974.833,783.485,1688.455],"t":[0,150,0]},{"n":"02 Family room to garden","p":[-188.4,84.95,-24.8],"t":[-75,75,-320]}];
for(const q of shots){
  const dx=q.t[0]-q.p[0],dy=q.t[1]-q.p[1],dz=q.t[2]-q.p[2];
  const len=Math.sqrt(dx*dx+dy*dy+dz*dz);
  const nx=dx/len,ny=dy/len,nz=dz/len;
  add('PerspectiveCamera');
  rename(q.n);
  position({x:q.p[0],y:q.p[1],z:q.p[2]});
  rotation({x:Math.atan2(ny,-nz)*180/Math.PI,y:Math.asin(-nx)*180/Math.PI,z:Math.atan2(nx*ny,-nz)*180/Math.PI});
}
setPlayCamera('01 Street overview');
playControls('orbit');
