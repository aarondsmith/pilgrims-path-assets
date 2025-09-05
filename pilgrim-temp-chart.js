/*! Pilgrim's Path — Temperature/Precipitation Chart
 *  Public API: window.pilgrim.tempChart.render(container, data, options)
 *  - container: DOM element (should have data-pilgrim="chart")
 *  - data: { highF:number[12], meanF:number[12], lowF:number[12], precipIn:number[12] }
 *  - options?: {
 *      locationLabel?: string,
 *      unitsDefault?: "imperial"|"metric",
 *      wetMonths?: number[],  // e.g., [10,11,0,1,2]  (Nov–Mar)
 *      dryMonths?: number[],  // e.g., [5,6,7,8]     (Jun–Sep)
 *      mobile?: { perMonthPx?: number },
 *      logo?: {
 *        url?: string,
 *        opacity?: number,
 *        size?: { desktop?:number, tablet?:number, mobile?:number },
 *        smartPlacement?: boolean,
 *        homeHref?: string
 *      }
 *    }
 */
(function(){
  const NS   = "http://www.w3.org/2000/svg";
  const XLINK= "http://www.w3.org/1999/xlink";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const f2c  = f => (f-32)*5/9;
  const in2mm= i => i*25.4;

  /* ---------- tiny helpers ---------- */
  function uid(){ return 'ptc-' + Math.random().toString(36).slice(2,9); }
  function svg(w=960,h=440){ const s=document.createElementNS(NS,'svg'); s.setAttribute('viewBox',`0 0 ${w} ${h}`); return s; }
  function path(d, stroke, sw=2){ const p=document.createElementNS(NS,'path'); p.setAttribute('d',d); p.setAttribute('fill','none'); p.setAttribute('stroke',stroke); p.setAttribute('stroke-width',sw); p.setAttribute('stroke-linejoin','round'); p.setAttribute('stroke-linecap','round'); return p; }
  function line(x1,y1,x2,y2, stroke){ const l=document.createElementNS(NS,'line'); l.setAttribute('x1',x1); l.setAttribute('y1',y1); l.setAttribute('x2',x2); l.setAttribute('y2',y2); l.setAttribute('stroke',stroke); return l; }
  function rect(x,y,w,h, fill){ const r=document.createElementNS(NS,'rect'); r.setAttribute('x',x); r.setAttribute('y',y); r.setAttribute('width',w); r.setAttribute('height',h); r.setAttribute('fill',fill); return r; }
  function circle(cx,cy,r, fill){ const c=document.createElementNS(NS,'circle'); c.setAttribute('cx',cx); c.setAttribute('cy',cy); c.setAttribute('r',r); c.setAttribute('fill',fill); return c; }
  function text(x,y,t,opts={}){ const el=document.createElementNS(NS,'text'); el.setAttribute('x',x); el.setAttribute('y',y); el.textContent=t; el.setAttribute('font-size',opts.size||12); el.setAttribute('fill',opts.fill||'currentColor'); el.setAttribute('text-anchor',opts.anchor||'middle'); if(opts.weight) el.setAttribute('font-weight',opts.weight); if(opts.family) el.setAttribute('style',`font-family:${opts.family}`); return el; }

  function cssVar(el, name){ return getComputedStyle(el).getPropertyValue(name).trim(); }
  function getVarUrl(el, name, fallback){
    const v = cssVar(el, name);
    if(!v) return fallback;
    const m = v.match(/url\((['"]?)(.*?)\1\)/i);
    return m ? m[2] : v;
  }

  function groupConsecutiveMonths(nums){
    if(!nums || !nums.length) return [];
    const arr = Array.from(new Set(nums)).sort((a,b)=>a-b);
    const groups = [];
    let cur=[arr[0]];
    for(let i=1;i<arr.length;i++){
      if(arr[i] === arr[i-1]+1){ cur.push(arr[i]); }
      else { groups.push(cur); cur=[arr[i]]; }
    }
    groups.push(cur);
    // wrap join (Dec→Jan)
    if(arr[0]===0 && arr[arr.length-1]===11){
      const first = groups.shift();
      const last  = groups.pop();
      groups.unshift(last.concat(first));
    }
    return groups;
  }

  /* ---------- main render ---------- */
  function render(container, data, opts){
    if(!container) throw new Error("pilgrim.tempChart.render: container is required");
    container.setAttribute('data-pilgrim','chart'); // enforce scope

    // Defaults (deep-merge logo to avoid wiping nested size keys)
    const defaultLogo = {
      url: getVarUrl(container, '--pilgrim-logo-url', 'https://aarondsmith.github.io/pilgrims-path-assets/logo.png'),
      opacity: parseFloat(cssVar(container,'--pilgrim-logo-opacity')) || 0.5,
      size: { desktop:55, tablet:50, mobile:45 },
      smartPlacement: true,
      homeHref: "https://thepilgrimspath.net"
    };
    const base = {
      locationLabel: "Location",
      unitsDefault: "imperial",
      wetMonths: [10,11,0,1,2], // Nov–Mar
      dryMonths: [5,6,7,8],     // Jun–Sep
      mobile: { perMonthPx: 116 }
    };
    const options = { ...base, ...(opts||{}) };
    const userLogo = (opts && opts.logo) || {};
    options.logo = {
      ...defaultLogo,
      ...userLogo,
      size: { ...defaultLogo.size, ...(userLogo.size || {}) }
    };

    // DOM skeleton
    const id = uid();
    container.innerHTML = `
      <div class="pilgrim-card" role="region" aria-label="${options.locationLabel} climate charts">
        <div class="pilgrim-head">
          <h2>${options.locationLabel} Climate</h2>
          <div class="pilgrim-sub">Monthly low/mean/high temperatures and average precipitation. Long-term regional averages.</div>
        </div>

        <div class="pilgrim-controls">
          <div class="pilgrim-unit" role="group" aria-label="Units">
            <label><input type="radio" name="units-${id}" value="imperial" ${options.unitsDefault==='imperial'?'checked':''}> °F / in</label>
            <label><input type="radio" name="units-${id}" value="metric"   ${options.unitsDefault==='metric'  ?'checked':''}> °C / mm</label>
          </div>
        </div>

        <div class="pilgrim-tabs" role="tablist" aria-label="${options.locationLabel} climate tabs">
          <button class="pilgrim-tab" role="tab" aria-selected="true"  aria-controls="panel-temps-${id}"  id="tab-temps-${id}">Temperatures</button>
          <button class="pilgrim-tab" role="tab" aria-selected="false" aria-controls="panel-precip-${id}" id="tab-precip-${id}">Precipitation</button>
        </div>

        <div id="panel-temps-${id}" class="pilgrim-panel active" role="tabpanel" aria-labelledby="tab-temps-${id}">
          <figure class="pilgrim-chart-wrap">
            <div class="pilgrim-chart-scroll" id="temps-scroll-${id}">
              <div class="pilgrim-svg-wide" id="temps-wide-${id}"></div>
              <div class="pilgrim-snap-track" id="temps-snap-${id}"></div>
            </div>
            <div class="pilgrim-legend" aria-hidden="true">
              <span><i class="sw" style="background:var(--pilgrim-color-4)"></i> High</span>
              <span><i class="sw" style="background:var(--pilgrim-color-3)"></i> Mean</span>
              <span><i class="sw" style="background:var(--pilgrim-color-2)"></i> Low</span>
            </div>
            <figcaption>Shaded bands show Wet (Nov–Mar) and Dry (Jun–Sep) seasons.</figcaption>
          </figure>
        </div>

        <div id="panel-precip-${id}" class="pilgrim-panel" role="tabpanel" aria-labelledby="tab-precip-${id}">
          <figure class="pilgrim-chart-wrap">
            <div class="pilgrim-chart-scroll" id="precip-scroll-${id}">
              <div class="pilgrim-svg-wide" id="precip-wide-${id}"></div>
              <div class="pilgrim-snap-track" id="precip-snap-${id}"></div>
            </div>
            <figcaption>Average monthly precipitation.</figcaption>
          </figure>
        </div>
      </div>
      <div class="pilgrim-tt" id="tt-${id}" role="tooltip" aria-hidden="true"></div>
    `;

    // Scoped queries
    const q = sel => container.querySelector(sel);
    const tooltip = q('#tt-'+id);

    // State & media
    let units = options.unitsDefault;
    const mediaMobile = window.matchMedia("(max-width: 480px)");
    const mediaTablet = window.matchMedia("(max-width: 768px)");
    const isMobile = ()=> mediaMobile.matches;
    const isTablet = ()=> mediaTablet.matches && !isMobile();

    // Wire units
    container.querySelectorAll(`input[name="units-${id}"]`).forEach(r=>{
      r.addEventListener('change', e=>{ units=e.target.value; drawActive(true); });
    });

    // Tabs
    const tabs = [ q('#tab-temps-'+id), q('#tab-precip-'+id) ];
    const panels = { temps: q('#panel-temps-'+id), precip: q('#panel-precip-'+id) };
    let active='temps';
    tabs.forEach(btn=>{
      btn.addEventListener('click', ()=>activate(btn.id.indexOf('temps')>-1?'temps':'precip'));
      btn.addEventListener('keydown', (e)=>{
        const i = tabs.indexOf(document.activeElement);
        if(e.key==='ArrowRight'){ tabs[(i+1)%tabs.length].focus(); e.preventDefault(); }
        if(e.key==='ArrowLeft'){ tabs[(i-1+tabs.length)%tabs.length].focus(); e.preventDefault(); }
        if(e.key==='Enter' || e.key===' '){ document.activeElement.click(); e.preventDefault(); }
      });
    });
    function activate(which){
      active=which;
      tabs.forEach(b=>b.setAttribute('aria-selected', b.id.indexOf(which)>-1?'true':'false'));
      Object.values(panels).forEach(p=>p.classList.remove('active'));
      panels[which].classList.add('active');
      equalizeHeights();
      snapHint(which);
    }

    // Tooltip
    function showTip(txt, x, y){ tooltip.textContent = txt; tooltip.classList.add('show'); moveTip(x,y); }
    function hideTip(){ tooltip.classList.remove('show'); }
    function moveTip(x,y){ tooltip.style.left = (x+12)+'px'; tooltip.style.top = (y+14)+'px'; }

    // Layout
    function computeLayout(){
      const mobile = isMobile(), tablet = isTablet();
      const baseH = mobile ? 420 : (tablet ? 440 : 460);
      const m = { t: mobile ? 28 : 32, r: mobile ? 18 : 28, b: 54, l: mobile ? 42 : 48 };
      const perMonth = mobile ? (options.mobile.perMonthPx||116) : (tablet ? 76 : 72);
      const innerW = perMonth * months.length;
      const svgW = m.l + innerW + m.r;
      const svgH = baseH;
      const dx = innerW / months.length;
      return { svgW, svgH, innerW, innerH: svgH - m.t - m.b, dx, m, mobile, tablet };
    }

    // Bands
    function drawSeasonBands(svgEl, dx, m, innerH, xBand, arr, fill){
      groupConsecutiveMonths(arr).forEach(g=>{
        const start = g[0], w = dx * g.length;
        svgEl.appendChild(rect(xBand(start), m.t, w, innerH, fill));
      });
    }

    // Logo (hardened)
    function addLogo(svgEl, m, innerW, innerH, smartInfo){
      const size = (options.logo && options.logo.size) || { desktop:55, tablet:50, mobile:45 };
      const w = isMobile() ? (size.mobile||45) : (isTablet() ? (size.tablet||50) : (size.desktop||55));
      const h = w;

      // placement
      let place = "bottom-right";
      if(isMobile()){ place = "top-right"; }
      else if(options.logo.smartPlacement && smartInfo){
        const dec = smartInfo.decRatio || 0, nov = smartInfo.novRatio || 0;
        if(dec >= 0.60 || nov >= 0.70) place = "top-right";
      }
      const x = m.l + innerW - w - 8;
      const y = (place === "top-right") ? (m.t + 8) : (m.t + innerH - h - 8);

      const a = document.createElementNS(NS,'a');
      a.setAttribute('href', options.logo.homeHref || 'https://thepilgrimspath.net');
      a.setAttribute('target','_blank');
      a.setAttribute('rel','noopener');
      a.setAttribute('aria-label',"Go to The Pilgrim’s Path home");

      const img = document.createElementNS(NS,'image');
      const url = options.logo.url || getVarUrl(container, '--pilgrim-logo-url');
      img.setAttributeNS(XLINK,'href', url);
      img.setAttribute('x', x);
      img.setAttribute('y', y);
      img.setAttribute('width', w);
      img.setAttribute('height', h);
      img.setAttribute('opacity', String(options.logo.opacity!=null? options.logo.opacity : 0.5));
      img.style.pointerEvents = 'auto';

      a.appendChild(img);
      svgEl.appendChild(a);
    }

    // Scroll shell
    function makeScrollShell(ids, svgEl, layout){
      const scroll = q('#'+ids.scroll);
      const wide   = q('#'+ids.wide);
      const snapT  = q('#'+ids.snap);

      wide.style.width = layout.svgW + "px";
      while (wide.firstChild) wide.removeChild(wide.firstChild);
      wide.appendChild(svgEl);

      snapT.innerHTML = "";
      for(let i=0;i<months.length;i++){
        const d = document.createElement('div');
        d.className = 'pilgrim-snap';
        d.style.width = layout.dx + "px";
        snapT.appendChild(d);
      }

      requestAnimationFrame(()=>{
        if (scroll.scrollWidth > scroll.clientWidth) scroll.classList.add('scrollable');
        else scroll.classList.remove('scrollable');
      });
    }

    /* ---------- draw: Temps ---------- */
    function drawTemps(){
      const layout = computeLayout();
      const { svgW, svgH, innerW, innerH, dx, m } = layout;
      const unitLabel = units==='metric' ? '°C' : '°F';

      const high = (units==='metric') ? data.highF.map(f=>+f2c(f).toFixed(1)) : data.highF;
      const mean = (units==='metric') ? data.meanF.map(f=>+f2c(f).toFixed(1)) : data.meanF;
      const low  = (units==='metric') ? data.lowF.map(f=>+f2c(f).toFixed(1))  : data.lowF;

      const all = low.concat(mean, high);
      const minY = Math.floor(Math.min(...all)/5)*5;
      const maxY = Math.ceil(Math.max(...all)/5)*5;

      const xBand = i => m.l + i*dx;
      const x     = i => xBand(i) + dx/2;   // <- keep this one (center of month)
      const y     = v => m.t + innerH - ((v - minY)/(maxY - minY)) * innerH;

      const svgEl = svg(svgW, svgH);

      drawSeasonBands(svgEl, dx, m, innerH, xBand, options.wetMonths, cssVar(container,'--pilgrim-band-wet'));
      drawSeasonBands(svgEl, dx, m, innerH, xBand, options.dryMonths, cssVar(container,'--pilgrim-band-dry'));

      // grid + labels
      const yTicks = 5;
      for(let i=0;i<=yTicks;i++){
        const val=minY+i*(maxY-minY)/yTicks, yy=y(val);
        svgEl.appendChild(line(m.l,yy,m.l+innerW+m.r,yy,cssVar(container,'--pilgrim-neutral-300')));
        svgEl.appendChild(text(m.l-12,yy+4,String(val),{anchor:'end',size:12,fill:cssVar(container,'--pilgrim-neutral-500'),family:'Poppins'}));
      }
      months.forEach((mo,i)=> svgEl.appendChild(text(xBand(i)+dx/2,svgH-18,mo,{size:12,fill:cssVar(container,'--pilgrim-neutral-500'),family:'Poppins'})));
      svgEl.appendChild(text(16,m.t+innerH/2,unitLabel,{anchor:'start',size:12,fill:cssVar(container,'--pilgrim-neutral-500'),family:'Poppins'}));

      // series
      const series = [
        {arr: high, color: cssVar(container,'--pilgrim-color-4'), label:'High'},
        {arr: mean, color: cssVar(container,'--pilgrim-color-3'), label:'Mean'},
        {arr: low,  color: cssVar(container,'--pilgrim-color-2'), label:'Low'}
      ];
      series.forEach(s=>{
        const pts = s.arr.map((v,i)=>[x(i),y(v)]);
        const d   = pts.map((p,i)=>(i?'L':'M')+p[0]+' '+p[1]).join(' ');
        const p   = path(d,s.color,2);
        const len = 1 + pts.reduce((a,c,i,arr)=> i? a + Math.hypot(c[0]-arr[i-1][0], c[1]-arr[i-1][1]) : 0, 0);
        p.style.strokeDasharray=len; p.style.strokeDashoffset=len; p.style.transition='stroke-dashoffset .8s ease';
        requestAnimationFrame(()=>{ p.style.strokeDashoffset='0'; });
        svgEl.appendChild(p);

        pts.forEach((pt,i)=>{
          const dot = circle(pt[0],pt[1],3,s.color);
          dot.style.cursor='crosshair';
          dot.addEventListener('mouseenter',e=>{ showTip(`${months[i]} — ${s.label}: ${s.arr[i]} ${unitLabel}`, e.clientX, e.clientY); });
          dot.addEventListener('mouseleave',hideTip);
          dot.addEventListener('mousemove',e=>moveTip(e.clientX,e.clientY));
          svgEl.appendChild(dot);
        });
      });

      svgEl.appendChild(text(svgW/2,20,`Monthly Temperatures (${unitLabel}) — ${options.locationLabel}`,{weight:700,family:'Manrope'}));

      addLogo(svgEl, m, innerW, innerH);

      makeScrollShell({scroll:`temps-scroll-${id}`, wide:`temps-wide-${id}`, snap:`temps-snap-${id}`}, svgEl, layout);
      return svgH;
    }

    /* ---------- draw: Precip ---------- */
    function drawPrecip(){
      const layout = computeLayout();
      const { svgW, svgH, innerW, innerH, dx, m } = layout;

      const vals = (units==='metric') ? data.precipIn.map(i=>Math.round(in2mm(i))) : data.precipIn;
      const unitLabel = units==='metric' ? 'mm' : 'in';
      const maxV = Math.max(...vals) * 1.15;

      const xBand = i => m.l + i*dx;
      const bw = dx * .66;
      const y = v => m.t + innerH - (v/maxV)*innerH;

      const svgEl = svg(svgW, svgH);

      drawSeasonBands(svgEl, dx, m, innerH, xBand, options.wetMonths, cssVar(container,'--pilgrim-band-wet'));
      drawSeasonBands(svgEl, dx, m, innerH, xBand, options.dryMonths, cssVar(container,'--pilgrim-band-dry'));

      // grid + labels
      const yTicks = 5;
      for(let i=0;i<=yTicks;i++){
        const val=(maxV/yTicks)*i, yy=y(val);
        svgEl.appendChild(line(m.l,yy,m.l+innerW+m.r,yy,cssVar(container,'--pilgrim-neutral-300')));
        svgEl.appendChild(text(m.l-12,yy+4,(units==='metric'?Math.round(val):val.toFixed(1)),{anchor:'end',size:12,fill:cssVar(container,'--pilgrim-neutral-500'),family:'Poppins'}));
      }
      months.forEach((mo,i)=> svgEl.appendChild(text(xBand(i)+dx/2,svgH-18,mo,{size:12,fill:cssVar(container,'--pilgrim-neutral-500'),family:'Poppins'})));
      svgEl.appendChild(text(16,m.t+innerH/2,unitLabel,{anchor:'start',size:12,fill:cssVar(container,'--pilgrim-neutral-500'),family:'Poppins'}));

      // bars
      vals.forEach((v,i)=>{
        const xx = xBand(i) + (dx-bw)/2;
        const yy = y(v);
        const bar = rect(xx,y(0),bw,0,cssVar(container,'--pilgrim-color-4'));
        requestAnimationFrame(()=>{ bar.setAttribute('y',yy); bar.setAttribute('height',(m.t+innerH-yy)); });
        bar.style.transition='y .65s ease, height .65s ease';
        bar.style.cursor='crosshair';
        bar.addEventListener('mouseenter',e=>{ showTip(`${months[i]} — ${units==='metric'?v.toFixed(0):v.toFixed(2)} ${unitLabel}`,e.clientX,e.clientY); });
        bar.addEventListener('mouseleave',hideTip);
        bar.addEventListener('mousemove',e=>moveTip(e.clientX,e.clientY));
        svgEl.appendChild(bar);
      });

      svgEl.appendChild(text(svgW/2,20,`Average Monthly Precipitation (${unitLabel}) — ${options.locationLabel}`,{weight:700,family:'Manrope'}));

      // smart placement: if Nov/Dec are very tall, move logo to top-right
      const decRatio = vals[11] / (maxV||1);
      const novRatio = vals[10] / (maxV||1);
      addLogo(svgEl, m, innerW, innerH, { decRatio, novRatio });

      makeScrollShell({scroll:`precip-scroll-${id}`, wide:`precip-wide-${id}`, snap:`precip-snap-${id}`}, svgEl, layout);
      return svgH;
    }

    // equalize panel heights
    function equalizeHeights(){
      const tempsPanel = panels.temps.querySelector('.pilgrim-chart-wrap');
      const precipPanel= panels.precip.querySelector('.pilgrim-chart-wrap');
      const base = tempsPanel.getBoundingClientRect().height;
      precipPanel.style.minHeight = base + "px";
    }

    // swipe hint
    function snapHint(which){
      const el = q('#'+(which==='temps' ? `temps-scroll-${id}` : `precip-scroll-${id}`));
      if(!el) return;
      if(el.scrollWidth > el.clientWidth && el.scrollLeft === 0){
        el.scrollBy({left: 40, behavior:'smooth'});
        setTimeout(()=> el.scrollBy({left: -40, behavior:'smooth'}), 350);
      }
    }

    // draw orchestrator
    function drawActive(fromUnitsChange=false){
      if(active==='temps'){ drawTemps(); } else { drawPrecip(); }
      equalizeHeights();
      [q('#temps-scroll-'+id), q('#precip-scroll-'+id)].forEach(sc=>{
        if(sc){
          if(sc.scrollWidth > sc.clientWidth) sc.classList.add('scrollable');
          else sc.classList.remove('scrollable');
        }
      });
      if(!fromUnitsChange) snapHint(active);
    }

    // initial render + resize
    drawTemps();
    drawPrecip();
    equalizeHeights();
    snapHint('temps');
    window.addEventListener('resize', ()=> drawActive() );
  }

  // expose
  window.pilgrim = window.pilgrim || {};
  window.pilgrim.tempChart = window.pilgrim.tempChart || { render };
})();
