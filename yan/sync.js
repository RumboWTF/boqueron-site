// sync.js — optional Supabase sync for the /yan trainer.
// Anonymous use stays fully local; logging in (passwordless email) turns on
// cross-device sync. Every method is a no-op when there is no session, so the
// trainer works unchanged offline or logged out.
(function(){
'use strict';
const SUPABASE_URL = 'https://ruwqhnuxucomisvqcclh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_vmdnQDicnE4fI8MdvdzGFw_5IlAAGIp';

let client = null, currentUser = null;
const cbs = [];

function notify(){ cbs.forEach(cb => { try { cb(currentUser); } catch(e){} }); }

function init(onChange){
  if (onChange) cbs.push(onChange);
  if (client) { if (onChange) onChange(currentUser); return; }
  if (!window.supabase || !window.supabase.createClient){
    console.warn('[yan] supabase-js not loaded; sync disabled');
    notify();
    return;
  }
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  client.auth.onAuthStateChange((_evt, session) => {
    currentUser = session ? session.user : null;
    notify();
  });
  client.auth.getSession().then(({ data }) => {
    currentUser = data && data.session ? data.session.user : null;
    notify();
  });
}

function user(){ return currentUser; }

async function sendMagicLink(email){
  if (!client) throw new Error('sync no disponible');
  const redirect = location.origin + location.pathname;
  const { error } = await client.auth.signInWithOtp({
    email: email, options: { emailRedirectTo: redirect }
  });
  if (error) throw error;
}

async function signOut(){ if (client) await client.auth.signOut(); }

function logAttempt(a){
  if (!client || !currentUser) return;
  client.from('attempts').insert({
    user_id: currentUser.id,
    verb: a.verb, tense: a.tense, person: a.person,
    answer: a.answer, response: a.response, correct: a.correct
  }).then(({ error }) => { if (error) console.warn('[yan] attempt not saved:', error.message); });
}

async function loadPrefs(){
  if (!client || !currentUser) return null;
  const { data, error } = await client.from('prefs')
    .select('common_only,tenses,weights').eq('user_id', currentUser.id).maybeSingle();
  if (error){ console.warn('[yan] prefs load:', error.message); return null; }
  return data;
}

async function savePrefs(p){
  if (!client || !currentUser) return;
  const { error } = await client.from('prefs').upsert({
    user_id: currentUser.id,
    common_only: p.commonOnly,
    tenses: p.tenses,
    weights: p.weights,
    updated_at: new Date().toISOString()
  });
  if (error) console.warn('[yan] prefs save:', error.message);
}

async function loadToday(){
  if (!client || !currentUser) return null;
  const start = new Date(); start.setHours(0,0,0,0);
  const { count, error } = await client.from('attempts')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', start.toISOString());
  if (error){ console.warn('[yan] today count:', error.message); return null; }
  return count || 0;
}

async function loadHistory(limit){
  if (!client || !currentUser) return [];
  const { data, error } = await client.from('attempts')
    .select('verb,tense,person,answer,response,correct')
    .order('created_at', { ascending: false }).limit(limit || 40);
  if (error){ console.warn('[yan] history load:', error.message); return []; }
  return (data || []).map(r => ({
    ok: r.correct, verb: r.verb, person: r.person, form: r.answer, your: r.response
  }));
}

// today's attempts: volume + correct count for the "hoy" chip
async function loadTodayStats(){
  if (!client || !currentUser) return null;
  const start = new Date(); start.setHours(0,0,0,0);
  const { data, error } = await client.from('attempts')
    .select('correct').gte('created_at', start.toISOString());
  if (error){ console.warn('[yan] today stats:', error.message); return null; }
  const total = data.length;
  const correct = data.reduce((n,r)=> n + (r.correct?1:0), 0);
  return { total, correct };
}

// recent attempts (newest first) for rolling accuracy + person/tense weak spots
async function loadRecent(limit){
  if (!client || !currentUser) return [];
  const { data, error } = await client.from('attempts')
    .select('tense,person,correct')
    .order('created_at', { ascending: false }).limit(limit || 400);
  if (error){ console.warn('[yan] recent load:', error.message); return []; }
  return data || [];
}

window.YanSync = { init, user, sendMagicLink, signOut, logAttempt, loadPrefs, savePrefs, loadToday, loadTodayStats, loadHistory, loadRecent };
})();
