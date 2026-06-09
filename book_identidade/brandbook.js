/* LU SYSTEM · Brand Book — background + interactions */
(function(){
  /* ---------- Starfield (fixed, full-viewport canvas) ---------- */
  const cv = document.getElementById('stars');
  const ctx = cv.getContext('2d');
  let stars = [], W=0, H=0, dpr=Math.min(window.devicePixelRatio||1,2);

  function build(){
    W = window.innerWidth; H = window.innerHeight;
    cv.width = W*dpr; cv.height = H*dpr;
    cv.style.width = W+'px'; cv.style.height = H+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const count = Math.round((W*H)/5200);
    stars = [];
    for(let i=0;i<count;i++){
      const big = Math.random()<0.16;
      stars.push({
        x:Math.random()*W, y:Math.random()*H,
        r: big ? 1.3+Math.random()*1.5 : 0.4+Math.random()*0.9,
        a: 0.25+Math.random()*0.6,
        tw: Math.random()<0.4,
        ph: Math.random()*Math.PI*2,
        sp: 0.6+Math.random()*1.2,
        c: Math.random()<0.30 ? '191,224,255' : (Math.random()<0.5 ? '231,243,255':'159,208,255')
      });
    }
  }
  function draw(t){
    ctx.clearRect(0,0,W,H);
    for(const s of stars){
      let a = s.a;
      if(s.tw){ a *= 0.55 + 0.45*Math.sin(t*0.001*s.sp + s.ph); }
      ctx.beginPath();
      ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
      ctx.fillStyle='rgba('+s.c+','+a.toFixed(3)+')';
      if(s.r>1.2){ ctx.shadowColor='rgba(150,210,255,.6)'; ctx.shadowBlur=s.r*4; } else { ctx.shadowBlur=0; }
      ctx.fill();
    }
    ctx.shadowBlur=0;
    rafId = requestAnimationFrame(draw);
  }
  let rafId=null;
  function kick(){ if(rafId) cancelAnimationFrame(rafId); draw(performance.now()); }
  build(); kick();
  window.addEventListener('load', ()=>{ build(); kick(); });
  let rt; window.addEventListener('resize',()=>{clearTimeout(rt); rt=setTimeout(()=>{build(); kick();},150);});

  /* ---------- Energy curves (echo of the logo) ---------- */
  const energy = document.getElementById('energy');
  if(energy){
    energy.innerHTML = `
      <svg viewBox="0 0 600 480" preserveAspectRatio="none" style="width:100%;height:100%">
        <defs>
          <linearGradient id="ecHi" gradientUnits="userSpaceOnUse" x1="40" y1="430" x2="560" y2="60">
            <stop offset="0" stop-color="#19b8b0"/><stop offset="0.5" stop-color="#7BFF6A"/>
            <stop offset="0.8" stop-color="#C8FF00"/><stop offset="1" stop-color="#fff94a"/>
          </linearGradient>
        </defs>
        <g fill="none" stroke-linecap="round">
          <path d="M -30 300 Q 300 200 640 40"  stroke="#1f5c66" stroke-width="2" opacity=".55"/>
          <path d="M -30 345 Q 305 245 640 80"  stroke="#1d525e" stroke-width="2" opacity=".5"/>
          <path d="M -30 390 Q 310 288 642 122" stroke="#1a4854" stroke-width="2" opacity=".45"/>
          <path d="M -30 435 Q 316 330 644 168" stroke="#184350" stroke-width="2" opacity=".4"/>
          <path d="M -30 365 Q 308 262 640 100" stroke="url(#ecHi)" stroke-width="2.4" opacity=".85"/>
        </g>
      </svg>`;
  }

  /* ---------- Sticky nav state ---------- */
  const nav = document.querySelector('nav.topbar');
  function onScroll(){ if(window.scrollY>40) nav.classList.add('scrolled'); else nav.classList.remove('scrolled'); }
  onScroll(); window.addEventListener('scroll',onScroll,{passive:true});

  /* ---------- Scroll reveal (geometry-based; IO-independent) ---------- */
  const reveals = document.querySelectorAll('.reveal');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduceMotion){
    reveals.forEach(el=>el.classList.add('in'));
  } else {
    function revealNow(){
      const vh = window.innerHeight;
      reveals.forEach(el=>{
        if(el.classList.contains('in')) return;
        if(el.getBoundingClientRect().top < vh*0.92) el.classList.add('in');
      });
    }
    window.addEventListener('scroll', revealNow, {passive:true});
    window.addEventListener('resize', revealNow, {passive:true});
    window.addEventListener('load', revealNow);
    revealNow();
  }

  /* ---------- Click-to-copy on swatches/tokens ---------- */
  document.querySelectorAll('[data-copy]').forEach(el=>{
    el.style.cursor='copy';
    el.addEventListener('click',()=>{
      const v = el.getAttribute('data-copy');
      navigator.clipboard && navigator.clipboard.writeText(v);
      const old = el.getAttribute('data-label');
      const tip = el.querySelector('.copy');
      if(tip){ const prev=tip.textContent; tip.textContent='copiado ✓'; setTimeout(()=>tip.textContent=prev,1100); }
    });
  });
})();
