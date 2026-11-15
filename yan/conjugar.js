(() => {
  'use strict';
  const LS = 'yan_conjugar_v1';
  const TENSES = [
    {key:'presente', label:'Presente', type:'six'},
    {key:'preterito', label:'Pretérito indefinido', type:'six'},
    {key:'imperfecto', label:'Imperfecto', type:'six'},
    {key:'futuro', label:'Futuro', type:'six'},
    {key:'condicional', label:'Condicional', type:'six'},
    {key:'subj_presente', label:'Presente de subjuntivo', type:'six'},
    {key:'subj_imperfecto_ra', label:'Imperfecto de subjuntivo', type:'six'},
    {key:'imperativo_afirm', label:'Imperativo afirmativo', type:'imper'},
    {key:'imperativo_neg', label:'Imperativo negativo', type:'imper'},
    {key:'perfecto', label:'Pretérito perfecto', type:'six'},
    {key:'pluscuamperfecto', label:'Pluscuamperfecto', type:'six'},
    {key:'cond_compuesto', label:'Condicional compuesto', type:'six'},
    {key:'subj_pluscuam', label:'Pluscuamperfecto de subjuntivo', type:'six'},
  ];
  const SIX = [
    {i:0,label:'yo'},{i:1,label:'tú'},{i:2,label:'él / ella / usted'},
    {i:3,label:'nosotros'},{i:4,label:'vosotros'},{i:5,label:'ellos / ellas / ustedes'}
  ];
  const IMPER = [
    {k:'tu',label:'tú'},{k:'usted',label:'usted'},{k:'nosotros',label:'nosotros'},
    {k:'vosotros',label:'vosotros'},{k:'ustedes',label:'ustedes'}
  ];
  const DEFAULT_TENSES = ['presente','preterito','imperfecto','futuro','condicional',
    'subj_presente','subj_imperfecto_ra','imperativo_afirm'];
  
  let VERBS = [];
  let cfg = loadCfg();
  let recent = [];           // cooldown: recent infinitives
  let cur = null;            // current question
  let answered = false;
  
  function loadCfg(){
    let c = {};
    try { c = JSON.parse(localStorage.getItem(LS)) || {}; } catch(e){}
    return {
      commonOnly: c.commonOnly !== undefined ? c.commonOnly : true,
      tenses: Array.isArray(c.tenses) && c.tenses.length ? c.tenses : DEFAULT_TENSES.slice(),
      weights: c.weights || {},
      seen: c.seen || 0
    };
  }
  function saveCfg(){ try{ localStorage.setItem(LS, JSON.stringify(cfg)); }catch(e){} }
  
  const $ = s => document.querySelector(s);
  const el = {
    meta:$('#meta'), verb:$('#verb'), gloss:$('#gloss'), person:$('#person'),
    answer:$('#answer'), accents:$('#accents'), fb:$('#fb'), row:$('#row'),
    panel:$('#panel'), gear:$('#gear'), closex:$('#closex'),
    commonOnly:$('#commonOnly'), tenseOpts:$('#tenseOpts'), reset:$('#resetWeights')
  };
  
  // ---- data load ----
  fetch('conjugations.json').then(r=>r.json()).then(d=>{
    VERBS = d.verbs || d;
    buildSettings();
    next();
  }).catch(e=>{
    el.verb.textContent = 'No se pudo cargar conjugations.json';
    el.gloss.textContent = e.message;
  });
  
  // ---- weighting / selection ----
  function weightOf(v){
    const w = cfg.weights[v.inf];
    if (w !== undefined) return w;
    return v.common ? 3 : 1;
  }
  function pool(){
    return VERBS.filter(v => cfg.commonOnly ? v.common : true);
  }
  function activeTenses(){
    return TENSES.filter(t => cfg.tenses.includes(t.key));
  }
  function pickVerb(){
    const p = pool();
    if (!p.length) return null;
    const cool = Math.min(recent.length, Math.max(0, p.length - 3), 12);
    const banned = new Set(recent.slice(-cool));
    let cand = p.filter(v => !banned.has(v.inf));
    if (!cand.length) cand = p;
    let total = 0; for (const v of cand) total += weightOf(v);
    let r = Math.random()*total;
    for (const v of cand){ r -= weightOf(v); if (r<=0) return v; }
    return cand[cand.length-1];
  }
  function pickQuestion(){
    const ats = activeTenses();
    if (!ats.length) return null;
    for (let tries=0; tries<40; tries++){
      const v = pickVerb();
      if (!v) return null;
      const t = ats[Math.floor(Math.random()*ats.length)];
      if (t.type==='six'){
        const forms = v.tenses[t.key];
        const idxs = [0,1,2,3,4,5].filter(i => forms[i] && forms[i].trim());
        if (!idxs.length) continue;
        const pi = idxs[Math.floor(Math.random()*idxs.length)];
        return {v, tense:t, kind:'six', pIndex:pi,
          personLabel:SIX[pi].label, answer:forms[pi]};
      } else {
        const m = v.tenses[t.key] || {};
        const keys = IMPER.map(x=>x.k).filter(k => m[k] && m[k].trim());
        if (!keys.length) continue;
        const pk = keys[Math.floor(Math.random()*keys.length)];
        const pl = IMPER.find(x=>x.k===pk).label;
        return {v, tense:t, kind:'imper', pKey:pk, personLabel:pl, answer:m[pk]};
      }
    }
    return null;
  }
  
  // ---- normalization / checking ----
  function norm(s){ return (s||'').trim().toLowerCase().replace(/\s+/g,' '); }
  function stripAccents(s){ return s.replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i').replace(/ó/g,'o').replace(/ú/g,'u').replace(/ü/g,'u'); }
  function check(input){
    const a = norm(input), b = norm(cur.answer);
    if (a===b) return {ok:true};
    if (stripAccents(a)===stripAccents(b)) return {ok:false, accent:true};
    return {ok:false, accent:false};
  }
  
  // ---- render ----
  function next(){
    answered = false;
    cur = pickQuestion();
    if (!cur){
      el.verb.textContent = 'Sin tiempos activos';
      el.gloss.textContent = 'Abre ajustes y elige al menos un tiempo.';
      el.meta.innerHTML=''; el.person.textContent='';
      el.answer.style.display='none'; el.accents.innerHTML=''; el.fb.innerHTML=''; el.row.innerHTML='';
      return;
    }
    recent.push(cur.v.inf); if (recent.length>30) recent.shift();
    el.meta.innerHTML = `<span>${cur.tense.label}</span><span class="dot">/</span>`+
      `<span>${cur.v.irregular?'irregular':'regular'}</span>`;
    el.verb.textContent = cur.v.inf;
    el.gloss.textContent = cur.v.gloss;
    el.person.innerHTML = cur.kind==='six'
      ? `<b>${cur.personLabel}</b>`
      : `<b>${cur.personLabel}</b>`;
    el.answer.style.display='';
    el.answer.className='answer';
    el.answer.value='';
    el.answer.disabled=false;
    el.fb.innerHTML='';
    renderAccents();
    renderRow();
    el.answer.focus();
  }
  function renderAccents(){
    const chars = ['á','é','í','ó','ú','ñ','ü'];
    el.accents.innerHTML='';
    chars.forEach(c=>{
      const b=document.createElement('button');
      b.type='button'; b.textContent=c;
      b.onclick=()=>{ insertAtCursor(el.answer, c); el.answer.focus(); };
      el.accents.appendChild(b);
    });
  }
  function insertAtCursor(inp, text){
    const s=inp.selectionStart||inp.value.length, e=inp.selectionEnd||inp.value.length;
    inp.value = inp.value.slice(0,s)+text+inp.value.slice(e);
    inp.selectionStart=inp.selectionEnd=s+text.length;
  }
  function renderRow(){
    el.row.innerHTML='';
    const btn=document.createElement('button');
    btn.className='btn'; btn.id='mainbtn';
    btn.textContent = answered ? 'Siguiente' : 'Comprobar';
    btn.onclick = ()=> answered ? next() : submit();
    el.row.appendChild(btn);
    if (answered){
      const less=document.createElement('button');
      less.className='ghost'; less.textContent='ver menos';
      less.onclick=()=>adjust(0.4);
      const more=document.createElement('button');
      more.className='ghost'; more.textContent='ver más';
      more.onclick=()=>adjust(1.8);
      el.row.appendChild(less); el.row.appendChild(more);
    }
    const cnt=document.createElement('span');
    cnt.className='count'; cnt.textContent = (cfg.seen||0)+' hechas';
    el.row.appendChild(cnt);
  }
  function submit(){
    if (answered) return;
    const res = check(el.answer.value);
    answered = true;
    cfg.seen = (cfg.seen||0)+1; saveCfg();
    el.answer.disabled=true;
    el.answer.classList.add(res.ok?'good':'bad');
    let html='';
    if (res.ok){
      html += `<div class="res good">correcto</div>`;
      html += `<div class="correct">${cur.answer}</div>`;
    } else {
      html += `<div class="res bad">${res.accent?'casi — revisa la tilde':'no es correcto'}</div>`;
      if ((el.answer.value||'').trim())
        html += `<div class="typed">${escapeHtml(el.answer.value.trim())}</div>`;
      html += `<div class="correct" style="color:var(--terra)">${cur.answer}</div>`;
    }
    el.fb.innerHTML=html;
    renderRow();
  }
  function escapeHtml(s){ return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function adjust(factor){
    const inf = cur.v.inf;
    let w = cfg.weights[inf]; if (w===undefined) w = cur.v.common?3:1;
    w = Math.max(0.1, Math.min(12, w*factor));
    cfg.weights[inf]=w; saveCfg();
    // small confirmation
    const note=document.createElement('div');
    note.className='note';
    note.textContent = factor<1 ? `verás «${inf}» menos a menudo` : `verás «${inf}» más a menudo`;
    el.fb.appendChild(note);
  }
  
  // keyboard
  el.answer.addEventListener('keydown', e=>{
    if (e.key==='Enter'){ e.preventDefault(); if(!answered) submit(); }
  });
  document.addEventListener('keydown', e=>{
    if (e.key==='Enter' && answered && document.activeElement!==el.answer){ next(); }
    if (e.key==='Enter' && answered && document.activeElement===el.answer){ next(); }
  });
  
  // ---- settings ----
  function buildSettings(){
    el.commonOnly.checked = cfg.commonOnly;
    el.commonOnly.onchange=()=>{ cfg.commonOnly=el.commonOnly.checked; recent=[]; saveCfg(); next(); };
    el.tenseOpts.innerHTML='';
    TENSES.forEach(t=>{
      const lab=document.createElement('label'); lab.className='opt';
      const cb=document.createElement('input'); cb.type='checkbox';
      cb.checked=cfg.tenses.includes(t.key);
      cb.onchange=()=>{
        if (cb.checked){ if(!cfg.tenses.includes(t.key)) cfg.tenses.push(t.key); }
        else cfg.tenses = cfg.tenses.filter(k=>k!==t.key);
        saveCfg();
      };
      lab.appendChild(cb); lab.appendChild(document.createTextNode(' '+t.label));
      el.tenseOpts.appendChild(lab);
    });
    el.reset.onclick=()=>{ cfg.weights={}; saveCfg(); el.reset.textContent='pesos restablecidos'; };
    el.gear.onclick=()=>el.panel.classList.add('open');
    el.closex.onclick=()=>{ el.panel.classList.remove('open'); next(); };
    el.panel.onclick=(e)=>{ if(e.target===el.panel){ el.panel.classList.remove('open'); next(); } };
  }
  })();
  