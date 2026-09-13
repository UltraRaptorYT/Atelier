updateMaterial('PH26 glass',{layers:[{type:'transmission',alpha:0},{type:'color',color:'#b4cec7',alpha:0.18},{type:'light',category:'phong',shininess:60,specular:'#dceae5'}]});
select('PH26 Context ground');
geometry({width:30000,height:30000});
fog({useBackgroundColor:true,near:5000,far:10000});
select(o => ['PH26 House','PH26 Tropical garden'].includes(o.name));
lookFrom({azimuth:30,elevation:20,target:'selection'});
unselect();
