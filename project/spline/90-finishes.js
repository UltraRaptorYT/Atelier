const oak=generateTexture('PH26 oak grain',(ctx,{size,rng})=>{
  ctx.fillStyle='#b79773';ctx.fillRect(0,0,size,size);
  for(let i=0;i<140;i++){
    const x=rng()*size,w=0.3+rng()*1.2;
    ctx.fillStyle=rng()>0.5?'rgba(98,70,42,0.13)':'rgba(231,209,179,0.16)';
    ctx.fillRect(x,0,w,size);
  }
});
const plaster=generateTexture('PH26 mineral grain',(ctx,{size,rng})=>{
  ctx.fillStyle='#e8e5dc';ctx.fillRect(0,0,size,size);
  for(let i=0;i<6500;i++){
    ctx.fillStyle=rng()>0.5?'rgba(110,104,88,0.12)':'rgba(255,255,251,0.4)';
    ctx.fillRect(rng()*size,rng()*size,1+rng(),1+rng());
  }
});
const stone=generateTexture('PH26 limestone grain',(ctx,{size,rng})=>{
  ctx.fillStyle='#bdbcb2';ctx.fillRect(0,0,size,size);
  for(let i=0;i<2500;i++){
    ctx.fillStyle=rng()>0.5?'rgba(80,82,73,0.13)':'rgba(233,229,214,0.23)';
    ctx.fillRect(rng()*size,rng()*size,1+rng()*3,1+rng()*2);
  }
});
updateMaterial('PH26 timber',{layers:[{type:'color',color:'#b99b77'},{type:'texture',image:oak.id,projection:'triplanar',alpha:0.72,texture:{repeat:[4,4]}},{type:'light',category:'physical',roughness:0.62,bumpMap:'texture',bumpMapIntensity:0.7}]});
updateMaterial('PH26 timber_dark',{layers:[{type:'texture',image:oak.id,projection:'triplanar',alpha:0.36,texture:{repeat:[4,4]}}]});
updateMaterial('PH26 plaster',{layers:[{type:'texture',image:plaster.id,projection:'triplanar',alpha:0.7,texture:{repeat:[4,4]}},{type:'light',category:'physical',roughness:0.88,bumpMap:'texture',bumpMapIntensity:0.65}]});
updateMaterial('PH26 concrete',{layers:[{type:'texture',image:stone.id,projection:'triplanar',alpha:0.7,texture:{repeat:[5,5]}},{type:'light',category:'physical',roughness:0.8,bumpMap:'texture',bumpMapIntensity:0.8}]});
select(o => o.name.startsWith('PH26 |') && (o.name.includes('pillow') || o.name.includes('cushion') || o.name.includes('mattress')));
geometry({cornerRadius:2,cornerSides:5});
mesh('Plane',{width:8000,height:8000});
rotation({x:-90});
position({x:0,y:-16,z:0});
color('#acb4ab');
shading({category:'physical',roughness:0.95});
rename('PH26 Context ground');
fog({useBackgroundColor:true,near:2800,far:6500});
light('Point',{intensity:2.4,color:'#fff0da',distance:360,decay:1.5,shadows:false});
position({x:-90,y:133,z:-80});
rename('PH26 Living fill');
light('Point',{intensity:2.1,color:'#fff2db',distance:300,decay:1.5,shadows:false});
position({x:125,y:294,z:-45});
rename('PH26 Family fill');
