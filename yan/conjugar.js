(() => {
'use strict';
const LS = 'yan_conjugar_v1';
const TENSES = [
  {key:'presente', label:'Presente', desc:'acciones habituales o del presente', type:'six'},
  {key:'preterito', label:'Pretérito indefinido', desc:'acciones terminadas y puntuales en el pasado', type:'six'},
  {key:'imperfecto', label:'Imperfecto', desc:'acciones en curso, repetidas o descripción en el pasado', type:'six'},
  {key:'futuro', label:'Futuro', desc:'acciones futuras o conjetura sobre el presente', type:'six'},
  {key:'condicional', label:'Condicional', desc:'hipótesis, cortesía o «futuro del pasado»', type:'six'},
  {key:'subj_presente', label:'Presente de subjuntivo', desc:'deseo, duda o emoción; presente o futuro', type:'six'},
  {key:'subj_imperfecto_ra', label:'Imperfecto de subjuntivo', desc:'subjuntivo en pasado; condiciones irreales, «si pudiera…»', type:'six'},
  {key:'imperativo_afirm', label:'Imperativo afirmativo', desc:'órdenes y peticiones', type:'imper'},
  {key:'imperativo_neg', label:'Imperativo negativo', desc:'órdenes negativas, «no lo hagas»', type:'imper'},
  {key:'perfecto', label:'Pretérito perfecto', desc:'pasado reciente o ligado al presente, «he hecho»', type:'six'},
  {key:'pluscuamperfecto', label:'Pluscuamperfecto', desc:'acción anterior a otra pasada, «ya había hecho»', type:'six'},
  {key:'cond_compuesto', label:'Condicional compuesto', desc:'lo que habría pasado, «habría hecho»', type:'six'},
  {key:'subj_pluscuam', label:'Pluscuamperfecto de subjuntivo', desc:'pasado irreal, «si hubiera hecho…»', type:'six'},
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
let recent = [];
let cur = null;
let answered = false;
let history = [];

function loadCfg(){
  let c = {};
  try { c = JSON.parse(localStorage.getItem(LS)) || {}; } catch(e){}
  return {
    commonOnly: c.commonOnly !== undefined ? c.commonOnly : true,
    tenses: Array.isArray(c.tenses) && c.tenses.length ? c.tenses : DEFAULT_TENSES.slice(),
    weights: c.weights || {},
    seen: c.seen || 0,
    seenDay: c.seenDay || '',
    seenToday: c.seenToday || 0
  };
}
function saveCfg(){ try{ localStorage.setItem(LS, JSON.stringify(cfg)); }catch(e){} }
function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
function bumpCounts(){
  const t = todayStr();
  if (cfg.seenDay !== t){ cfg.seenDay = t; cfg.seenToday = 0; }
  cfg.seenToday++; cfg.seen = (cfg.seen||0)+1;
}

const $ = s => document.querySelector(s);
const el = {
  toptag:$('#toptag'), verb:$('#verb'), gloss:$('#gloss'), tense:$('#tense'),
  tdesc:$('#tdesc'), person:$('#person'), answer:$('#answer'), accents:$('#accents'),
  fb:$('#fb'), row:$('#row'), history:$('#history'),
  panel:$('#panel'), gear:$('#gear'), closex:$('#closex'),
  commonOnly:$('#commonOnly'), tenseOpts:$('#tenseOpts'), reset:$('#resetWeights')
};

(function(){
  const need = ['toptag','verb','gloss','tense','tdesc','person','answer','accents','fb','row','history','panel','gear','closex','commonOnly','tenseOpts','reset'];
  const missing = need.filter(k => !el[k]);
  if (missing.length){
    const host = el.verb || el.gloss || document.getElementById('stage') || document.body;
    const ids = missing.map(k => k==='reset' ? '#resetWeights' : '#'+k).join(', ');
    host.textContent = 'conjugar.html está desactualizado — faltan: ' + ids + '. Sustituye los tres archivos (conjugar.html, conjugar.js, yan.css) por las versiones nuevas.';
    host.style.color = '#B5543A'; host.style.fontSize = '16px';
    return;
  }
  fetch('conjugations.json').then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }).then(d=>{
    VERBS = d.verbs || d;
    if (!VERBS.length) throw new Error('conjugations.json vacío');
    buildSettings();
    next();
  }).catch(e=>{
    el.verb.textContent = 'No se pudo cargar conjugations.json';
    el.gloss.textContent = e.message;
  });
})();

function weightOf(v){
  const w = cfg.weights[v.inf];
  if (w !== undefined) return w;
  return v.common ? 3 : 1;
}
function pool(){ return VERBS.filter(v => cfg.commonOnly ? v.common : true); }
function activeTenses(){ return TENSES.filter(t => cfg.tenses.includes(t.key)); }
function pickVerb(){
  const p = pool(); if (!p.length) return null;
  const cool = Math.min(recent.length, Math.max(0, p.length - 3), 12);
  const banned = new Set(recent.slice(-cool));
  let cand = p.filter(v => !banned.has(v.inf)); if (!cand.length) cand = p;
  let total = 0; for (const v of cand) total += weightOf(v);
  let r = Math.random()*total;
  for (const v of cand){ r -= weightOf(v); if (r<=0) return v; }
  return cand[cand.length-1];
}
function pickQuestion(){
  const ats = activeTenses(); if (!ats.length) return null;
  for (let tries=0; tries<40; tries++){
    const v = pickVerb(); if (!v) return null;
    const t = ats[Math.floor(Math.random()*ats.length)];
    if (t.type==='six'){
      const forms = v.tenses[t.key];
      const idxs = [0,1,2,3,4,5].filter(i => forms[i] && forms[i].trim());
      if (!idxs.length) continue;
      const pi = idxs[Math.floor(Math.random()*idxs.length)];
      return {v, tense:t, kind:'six', personLabel:SIX[pi].label, answer:forms[pi]};
    } else {
      const m = v.tenses[t.key] || {};
      const keys = IMPER.map(x=>x.k).filter(k => m[k] && m[k].trim());
      if (!keys.length) continue;
      const pk = keys[Math.floor(Math.random()*keys.length)];
      return {v, tense:t, kind:'imper', personLabel:IMPER.find(x=>x.k===pk).label, answer:m[pk]};
    }
  }
  return null;
}

function norm(s){ return (s||'').trim().toLowerCase().replace(/\s+/g,' '); }
function stripAccents(s){ return s.replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i').replace(/ó/g,'o').replace(/ú/g,'u').replace(/ü/g,'u'); }
function check(input){
  const a = norm(input), b = norm(cur.answer);
  if (a===b) return {ok:true};
  if (stripAccents(a)===stripAccents(b)) return {ok:false, accent:true};
  return {ok:false, accent:false};
}

function next(){
  answered = false;
  cur = pickQuestion();
  if (!cur){
    el.verb.textContent = 'Sin tiempos activos';
    el.gloss.textContent = 'Abre ajustes y elige al menos un tiempo.';
    el.toptag.textContent=''; el.tense.textContent=''; el.tdesc.textContent=''; el.person.textContent='';
    el.answer.style.display='none'; el.accents.innerHTML=''; el.fb.innerHTML=''; el.row.innerHTML='';
    return;
  }
  recent.push(cur.v.inf); if (recent.length>30) recent.shift();
  el.toptag.textContent = cur.v.irregular ? 'irregular' : 'regular';
  el.verb.textContent = cur.v.inf;
  el.gloss.textContent = cur.v.gloss;
  el.tense.innerHTML = `${escapeHtml(cur.tense.label)} <span class="td">(${escapeHtml(cur.tense.desc)})</span>`;
  el.person.textContent = cur.personLabel;
  el.answer.style.display='';
  el.answer.className='answer';
  el.answer.value='';
  el.fb.innerHTML='';
  renderAccents();
  renderRow();
  el.answer.focus();
}
function renderAccents(){
  const chars = ['á','é','í','ó','ú','ñ','ü'];
  el.accents.innerHTML='';
  chars.forEach(c=>{
    const b=document.createElement('button'); b.type='button'; b.textContent=c;
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
    less.className='ghost'; less.textContent='ver menos'; less.onclick=()=>adjust(0.4);
    const more=document.createElement('button');
    more.className='ghost'; more.textContent='ver más'; more.onclick=()=>adjust(1.8);
    el.row.appendChild(less); el.row.appendChild(more);
  }
}
function submit(){
  if (answered) return;
  const your = el.answer.value.trim();
  const res = check(your);
  answered = true;
  bumpCounts(); saveCfg();
  el.answer.classList.add(res.ok?'good':'bad');
  let html='';
  if (res.ok){
    html = `<div class="flag good"><span class="ic">✓</span>correcto</div>`
         + `<div class="sol good">${cur.answer}</div>`;
  } else {
    html = `<div class="flag bad"><span class="ic">✗</span>${res.accent?'casi — la tilde':'no es correcto'}</div>`;
    if (your) html += `<div class="you">tu respuesta: <s>${escapeHtml(your)}</s></div>`;
    html += `<div class="sol bad">${cur.answer}</div>`;
  }
  el.fb.innerHTML = html;
  history.unshift({ok:res.ok, verb:cur.v.inf, person:cur.personLabel, form:cur.answer, your});
  if (history.length>40) history.pop();
  renderHistory();
  renderRow();
}
function renderHistory(){
  if (!history.length){ el.history.className='history'; el.history.innerHTML=''; return; }
  el.history.className='history show';
  const rows = history.map(h=>{
    const ic = h.ok ? `<span class="hic g">✓</span>` : `<span class="hic b">✗</span>`;
    const res = h.ok
      ? `<span class="hform">${escapeHtml(h.form)}</span>`
      : `${h.your?`<span class="hwrong">${escapeHtml(h.your)}</span>`:''}<span class="hform">${escapeHtml(h.form)}</span>`;
    return `<div class="hrow">${ic}<span class="hv">${escapeHtml(h.verb)}</span>`+
      `<span class="hp">${escapeHtml(h.person)}</span><span class="hres">${res}</span></div>`;
  }).join('');
  el.history.innerHTML = `<div class="hhead">historial · ${cfg.seenToday} hoy</div>${rows}`;
}
function escapeHtml(s){ return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function adjust(factor){
  const inf = cur.v.inf;
  let w = cfg.weights[inf]; if (w===undefined) w = cur.v.common?3:1;
  w = Math.max(0.1, Math.min(12, w*factor));
  cfg.weights[inf]=w; saveCfg();
  const note=document.createElement('div');
  note.className='note';
  note.textContent = factor<1 ? `verás «${inf}» menos a menudo` : `verás «${inf}» más a menudo`;
  el.fb.appendChild(note);
}

el.answer.addEventListener('keydown', e=>{
  if (e.key==='Enter'){
    e.preventDefault();
    if (!answered) submit(); else next();
  }
});

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
