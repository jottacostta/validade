/* Leitor EAN-13 / EAN-8 / UPC-A em JavaScript puro (sem biblioteca).
   lerEAN(imageData) → "7891234567895" ou null
   Lê várias linhas horizontais da imagem, binariza cada linha com limiar local,
   transforma em larguras de barras/espaços e compara com as tabelas do padrão EAN. */
var LeitorEAN=(function(){
  var L=['3211','2221','2122','1411','1132','1231','1114','1312','1213','3112'];
  var PARIDADE=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
  function digito(r,ini){ /* 4 larguras → {d, tipo('L'|'G'), erro} */
    var soma=r[ini]+r[ini+1]+r[ini+2]+r[ini+3]; if(!soma) return null;
    var m=[r[ini]*7/soma,r[ini+1]*7/soma,r[ini+2]*7/soma,r[ini+3]*7/soma], melhor=null;
    for(var d=0;d<10;d++){ for(var g=0;g<2;g++){ var p=L[d]; if(g) p=p.split('').reverse().join('');
      var e=0; for(var k=0;k<4;k++){ var x=m[k]-(+p[k]); e+=x*x; }
      if(!melhor||e<melhor.erro) melhor={d:d,tipo:g?'G':'L',erro:e}; } }
    return melhor&&melhor.erro<1.6?melhor:null;
  }
  function digitoR(r,ini){ /* lado direito: só tabela R (larguras iguais à L) */
    var soma=r[ini]+r[ini+1]+r[ini+2]+r[ini+3]; if(!soma) return null;
    var m=[r[ini]*7/soma,r[ini+1]*7/soma,r[ini+2]*7/soma,r[ini+3]*7/soma], melhor=null;
    for(var d=0;d<10;d++){ var p=L[d],e=0; for(var k=0;k<4;k++){ var x=m[k]-(+p[k]); e+=x*x; } if(!melhor||e<melhor.erro) melhor={d:d,erro:e}; }
    return melhor&&melhor.erro<1.6?melhor:null;
  }
  function guarda(r,ini,n,mod){ for(var k=0;k<n;k++){ var v=r[ini+k]/mod; if(v<0.4||v>1.9) return false; } return true; }
  function checa13(s){ var t=0; for(var i=0;i<12;i++) t+=(+s[i])*(i%2?3:1); return (10-t%10)%10===+s[12]; }
  function checa8(s){ var t=0; for(var i=0;i<7;i++) t+=(+s[i])*(i%2?1:3); return (10-t%10)%10===+s[7]; }
  function tenta13(r,i){ /* r[i] = 1ª barra da guarda inicial; 59 larguras */
    if(i+59>r.length) return null;
    var tot=0; for(var k=0;k<59;k++) tot+=r[i+k]; var mod=tot/95;
    if(!guarda(r,i,3,mod)||!guarda(r,i+27,5,mod)||!guarda(r,i+56,3,mod)) return null;
    if(i>0&&r[i-1]<mod*3) return null;                   /* zona quieta antes */
    var s='',par='';
    for(var k=0;k<6;k++){ var x=digito(r,i+3+k*4); if(!x) return null; s+=x.d; par+=x.tipo; }
    for(k=0;k<6;k++){ var y=digitoR(r,i+32+k*4); if(!y) return null; s+=y.d; }
    var p=PARIDADE.indexOf(par); if(p<0) return null;
    var c=p+s; return checa13(c)?c:null;
  }
  function tenta8(r,i){
    if(i+43>r.length) return null;
    var tot=0; for(var k=0;k<43;k++) tot+=r[i+k]; var mod=tot/67;
    if(!guarda(r,i,3,mod)||!guarda(r,i+19,5,mod)||!guarda(r,i+40,3,mod)) return null;
    if(i>0&&r[i-1]<mod*3) return null;
    var s='';
    for(var k=0;k<4;k++){ var x=digito(r,i+3+k*4); if(!x||x.tipo!=='L') return null; s+=x.d; }
    for(k=0;k<4;k++){ var y=digitoR(r,i+24+k*4); if(!y) return null; s+=y.d; }
    return checa8(s)?s:null;
  }
  /* larguras com precisão de sub-pixel: posição exata onde a luminância cruza o limiar */
  function largurasSub(lum,lim){
    var W=lum.length,bordas=[],escuro=lum[0]<lim[0];
    for(var x=1;x<W;x++){ var e=lum[x]<lim[x]; if(e!==escuro){ var a=lum[x-1]-lim[x-1],b=lum[x]-lim[x],f=a===b?0.5:a/(a-b); bordas.push({x:x-1+f,escuro:e}); escuro=e; } }
    /* começa numa borda que entra no escuro */
    var k=0; while(k<bordas.length&&!bordas[k].escuro) k++;
    if(k>=bordas.length) return [];
    var r=[bordas[k].x]; /* branco antes (zona quieta) */
    for(var i=k+1;i<bordas.length;i++) r.push(bordas[i].x-bordas[i-1].x);
    r.push(W-bordas[bordas.length-1].x);
    return r;
  }
  function decodeW(w){ for(var i=1;i<w.length;i+=2){ var c=tenta13(w,i)||tenta8(w,i); if(c) return c; } return null; }
  function linhas(img){
    var W=img.width,H=img.height,d=img.data,res=[];
    var passos=[.5,.45,.55,.4,.6,.35,.65,.3,.7,.25,.75,.2,.8];
    for(var p=0;p<passos.length;p++){
      var y0=Math.floor(H*passos[p]), lum=new Float32Array(W);
      for(var dy=-1;dy<=1;dy++){ var y=Math.min(H-1,Math.max(0,y0+dy));
        for(var x=0;x<W;x++){ var o=(y*W+x)*4; lum[x]+=(d[o]*299+d[o+1]*587+d[o+2]*114)/3000; } }
      res.push(lum);
    }
    return res;
  }
  function limiares(lum,modo){
    var W=lum.length,out=new Float32Array(W);
    if(modo===0){ var mn=255,mx=0; for(var i=0;i<W;i++){ if(lum[i]<mn)mn=lum[i]; if(lum[i]>mx)mx=lum[i]; } out.fill((mn+mx)/2); return out; }
    var r=Math.max(6,Math.floor(W/(modo===1?20:10))), pref=new Float32Array(W+1);
    for(i=0;i<W;i++) pref[i+1]=pref[i]+lum[i];
    for(i=0;i<W;i++){ var a=Math.max(0,i-r),b=Math.min(W,i+r); out[i]=(pref[b]-pref[a])/(b-a); }
    return out;
  }
  /* realce de nitidez (imagem borrada): lum + k·(lum − média local) */
  function realcar(lum,k){ var W=lum.length,o=new Float32Array(W); for(var i=0;i<W;i++){ var a=lum[Math.max(0,i-2)],b=lum[Math.max(0,i-1)],c=lum[Math.min(W-1,i+1)],d=lum[Math.min(W-1,i+2)]; o[i]=lum[i]+k*(lum[i]-(a+b+lum[i]+c+d)/5); } return o; }
  function ler(img){
    var base=linhas(img), ls=base.concat(base.map(function(l){return realcar(l,2);}));
    for(var m=0;m<3;m++){ for(var k=0;k<ls.length;k++){
      var lum=ls[k], lim=limiares(lum,m), c=decodeW(largurasSub(lum,lim)); if(c) return c;
      var li=Float32Array.from(lum).reverse(), mi=Float32Array.from(lim).reverse(); c=decodeW(largurasSub(li,mi)); if(c) return c; } }
    return null;
  }
  return {ler:ler,checa13:checa13,checa8:checa8};
})();

