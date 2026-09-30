/* 共有ワールド定義(クライアント/サーバー共通)。元ゲームの地形関数 H をそのまま使用。 */
(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory();else root.World=factory()})(typeof self!=="undefined"?self:this,function(){
const WATER=-6,EB={x:0,z:-5400};
const H=(x,z)=>{const dx=Math.max(0,Math.abs(x)-260),dz=z>300?z-300:z<-1700?-1700-z:0,d2=Math.hypot(Math.max(0,Math.abs(x-EB.x)-260),Math.max(0,Math.abs(z-EB.z)-1000)),b=Math.min(1,Math.min(Math.hypot(dx,dz),d2)/700),s=b*b*(3-2*b);
 return s*(110*Math.sin(x*.0021+1.3)*Math.cos(z*.0017+.4)+55*Math.sin(x*.0053+z*.0041)+25*Math.sin(x*.011-z*.009+2)+30)};
const Hg=(x,z)=>Math.max(H(x,z),WATER);
const BLUE_BASE={x:-90,y:8,z:50},RED_BASE={x:EB.x-90,y:8,z:EB.z+545},BASE_R=75,BASE_HP=600;
// 滑走路: 青=z[-1350..250] 赤=z[-6200..-4600]
const onRunway=(team,x,z)=>team==="blue"?Math.abs(x)<50&&z<270&&z>-1370:Math.abs(x-EB.x)<50&&z<EB.z+820&&z>EB.z-820;
return{WATER,EB,H,Hg,BLUE_BASE,RED_BASE,BASE_R,BASE_HP,onRunway};
});
