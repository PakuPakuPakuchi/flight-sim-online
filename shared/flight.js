/* 共有飛行モデル: 元ゲームの physics() / input() を一切簡略化せず抽出。
   サーバー(権威)とクライアント(予測)で同一コードを使用する。 */
(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory(require("three"),require("./world.js"));else root.Flight=factory(root.THREE,root.World)})(typeof self!=="undefined"?self:this,function(T,World){
const V3=T.Vector3,Q=T.Quaternion,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),ramp=(v,t,r,dt)=>v+clamp(t-v,-r*dt,r*dt),Hg=World.Hg;
const CLIMB_STALL_BONUS=.07; // 上昇中(垂直速度>0)のみ失速迎角を加算(rad)。12m/sで最大
const STALL_A0=.34; // 失速迎角(rad) 大きいほど失速しにくい
function CLf(a,fl,ab=0){const aS=STALL_A0+.02*fl+ab,cl0=.25+.5*fl,lin=cl0+5.2*clamp(a,-aS,aS),ex=Math.abs(a)-aS;if(ex<=0)return lin;const t=Math.min(1,ex/.35);return lin*(1-t)+.9*Math.sin(2*a)*t}
const P=(x,y,z,t,k,c,mu=.7)=>({p:new V3(x,y,z),t,k,c,mu});
const pts=[P(0,-1.2,-1.65,'n',60000,8000),P(-1.25,-1.2,.35,'m',65000,8000),P(1.25,-1.2,.35,'m',65000,8000),P(0,-.62,-.5,'b',120000,15000,.6),P(0,-.62,1.6,'b',120000,15000,.6),
 P(-5.5,-.1,-.2,'h',120000,15000),P(5.5,-.1,-.2,'h',120000,15000),P(0,.3,3.7,'h',120000,15000),P(0,0,-3.3,'h',120000,15000)];
const X=new V3(1,0,0),UP=new V3(0,1,0),M=1100,IX=1825,IY=2666,IZ=1285;
// physics: 墜落時は理由の文字列を返す(なければ undefined)
function physics(S,dt){
 if(S.crashed)return;S.t+=dt;
 const inv=S.q.clone().invert(),vb=S.vel.clone().applyQuaternion(inv),V=Math.max(vb.length(),.001),rho=1.225*Math.exp(-Math.max(0,S.pos.y)/8500),qd=.5*rho*V*V;
 const alpha=V>2?Math.atan2(-vb.y,-vb.z):0,beta=V>2?Math.asin(clamp(vb.x/V,-1,1)):0;S.alpha=alpha;S.V=V;
 const fl=S.flaps,clm=clamp(S.vel.y/12,0,1),aS=STALL_A0+.02*fl+CLIMB_STALL_BONUS*clm,CL=CLf(alpha,fl,CLIMB_STALL_BONUS*clm),CD=.03+.06*CL*CL+.04*fl+.02*S.gearT+1.1*Math.sin(alpha)**2,vh=vb.clone().divideScalar(V);
 const F=new V3().crossVectors(X,vh).multiplyScalar(qd*16*CL);F.addScaledVector(vh,-qd*16*CD);F.x-=beta*qd*16*.9;
 // engine
 let Tn=0;if(S.fuel>0){const dens=rho/1.225;Tn=Math.min(4200*S.thr*dens,.78*170000*S.thr*Math.pow(dens,.9)/Math.max(V,12));S.fuel=Math.max(0,S.fuel-(.05+.95*S.thr)*.00045*dt)}
 F.z-=Tn;
 // moments (rad/s^2, body axes)
 const eff=Math.min(2,qd/1531),el=S.el+S.trim,r=-S.w.z,yw=-S.w.y,st=clamp((alpha-aS)/.16,0,1);
 let ax=eff*3.0*el-4.2*alpha*eff-(.8+1.6*Math.min(eff,1.5))*S.w.x-st*1.6*Math.max(.3,eff)*(1-.4*clm);
 let ra=eff*3.2*S.ai-r*(2.4+1.0*Math.min(eff,1.5))-beta*1.2*eff+st*1.1*Math.sin(S.t*2.3);
 let yr=eff*1.5*S.ru+beta*2.6*eff-yw*(1.6+.8*Math.min(eff,1.5))-S.ai*.35*eff;
 // ground
 const Fg=new V3(),tau=new V3(),ww=S.w.clone().applyQuaternion(S.q);let on=false;
 for(const c of pts){if((c.t=='n'||c.t=='m')&&S.gearT<.6)continue;
  const rv=c.p.clone().applyQuaternion(S.q),pw=rv.clone().add(S.pos),pen=Hg(pw.x,pw.z)-pw.y;if(pen<=0)continue;
  on=true;const vp=S.vel.clone().add(new V3().crossVectors(ww,rv)),Nf=Math.max(0,c.k*pen-c.c*vp.y),sink=-vp.y,sp=Math.hypot(vp.x,vp.z);
  if(c.t=='h'&&(sink>4||sp>15)&&Nf>0)return ('機体が地面・障害物に衝突しました');
  if(c.t=='b'&&sink>4.5)return ('ギアを出さずに強く接地しました');
  if((c.t=='n'||c.t=='m')&&sink>8.5)return ('ハードランディング(沈下率 '+Math.round(sink*196.85)+' fpm)');
  const f=new V3(0,Nf,0);
  if(c.t=='n'||c.t=='m'){const st2=c.t=='n'?S.ru*.5/(1+S.V*.06):0,fw=new V3(Math.sin(st2),0,-Math.cos(st2)).applyQuaternion(S.q);fw.y=0;if(fw.lengthSq()<1e-4)fw.set(0,0,-1);fw.normalize();
   const rt=new V3(-fw.z,0,fw.x),vf=vp.dot(fw),vl=vp.dot(rt);
   f.addScaledVector(rt,-clamp(vl*.6,-1,1)*Nf).addScaledVector(fw,-clamp(vf*1.5,-1,1)*Nf*(.025+(c.t=='m'?S.brake*.75:0)))}
  else if(sp>.01)f.x-=vp.x/sp*Math.min(sp*3,1)*Nf*c.mu,f.z-=vp.z/sp*Math.min(sp*3,1)*Nf*c.mu;
  Fg.add(f);tau.add(new V3().crossVectors(rv,f))}
 S.onGround=on;
 const Ft=F.applyQuaternion(S.q).add(Fg);S.g+=((Ft.clone().applyQuaternion(inv).y/(M*9.81))-S.g)*Math.min(1,dt*8);
 const a=Ft.divideScalar(M);a.y-=9.81;S.vel.addScaledVector(a,dt);if(S.vel.length()>200)S.vel.setLength(200);S.pos.addScaledVector(S.vel,dt);
 const tb=tau.applyQuaternion(inv);
 S.w.x+=(ax+tb.x/IX)*dt;S.w.y+=(-yr+tb.y/IY)*dt;S.w.z+=(-ra+tb.z/IZ)*dt;
 S.w.set(clamp(S.w.x,-5,5),clamp(S.w.y,-5,5),clamp(S.w.z,-6,6));
 const wl=S.w.length();if(wl>1e-7)S.q.multiply(new Q().setFromAxisAngle(S.w.clone().divideScalar(wl),wl*dt)).normalize();
}
// 元 input(dt) を「操縦意図(inp)」ベースに変換。キー→軸の変換はクライアント側。
function applyInput(S,inp,dt){
 S.el=ramp(S.el,inp.el,inp.el!==0?2.2:3.5,dt);
 S.ai=ramp(S.ai,inp.ai,inp.ai!==0?2.6:3.5,dt);
 S.ru=ramp(S.ru,inp.ru,2.6,dt);
 S.thr=ramp(S.thr,inp.thr,4,dt);
 S.trim=ramp(S.trim,inp.trim,.3,dt);
 S.brake=ramp(S.brake,inp.brake?1:0,4,dt);
 if(!(inp.gear===0&&S.gearS&&S.onGround))S.gearS=inp.gear?1:0;
 S.flapT=inp.flaps;
 S.flaps=ramp(S.flaps,S.flapT/3,.2,dt);S.gearT=ramp(S.gearT,S.gearS,.2,dt);
}
// 元 reset()/respawnPlayer() の機体初期状態。team=red は北の敵滑走路から南向きに離陸。
function newState(team,slot,air){
 slot=slot||0;const red=team==="red",ox=((slot%3)-1)*10,oz=Math.floor(slot/3)*40;
 const pos=red?new V3(World.EB.x+ox,air?600:1.15,World.EB.z-750+oz-(air?2000:0)):new V3(ox,air?600:1.15,air?-2600:200-oz);
 const q=new Q();if(red)q.setFromAxisAngle(new V3(0,1,0),Math.PI);
 const vel=new V3(0,0,0);
 return{pos,vel,q,w:new V3(),thr:0,fuel:1,flapT:0,flaps:0,gearS:1,gearT:1,brake:0,el:0,ai:0,ru:0,trim:.03,crashed:false,onGround:true,g:1,alpha:0,V:0,t:0};
}
return{STALL_A0,CLf,physics,applyInput,newState,clamp,ramp};
});
