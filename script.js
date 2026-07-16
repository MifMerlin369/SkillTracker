"use strict";

/* ============ SUPABASE ============
   Le client est créé à partir des valeurs définies dans config.js
   (window.SUPABASE_URL / window.SUPABASE_ANON_KEY). L'anon key est
   publique par design : la sécurité vient des policies RLS côté
   Supabase (voir schema.sql), pas du secret de cette clé. */
const supabaseClient = window.supabase.createClient(
  window.SUPABASE_URL,
  window.SUPABASE_ANON_KEY
);

(function(){

/* ============ CONFIG ============ */
const CATEGORIES = ["Programmation","Mathématiques","Électricité auto","Anglais","Cybersécurité","Autre"];
const COLOR_MAP = {
  cyan:   {accent:"#00e5ff", label:"Cyan"},
  violet: {accent:"#8b5cf6", label:"Violet"},
  magenta:{accent:"#ff2fb0", label:"Magenta"},
  green:  {accent:"#39ffb0", label:"Vert"},
  amber:  {accent:"#ffb340", label:"Ambre"},
  red:    {accent:"#ff4d7e", label:"Rouge"},
};
const THEME_ACCENTS = {
  cyan:   {"--accent":"#00e5ff","--accent-2":"#8b5cf6"},
  violet: {"--accent":"#8b5cf6","--accent-2":"#ff2fb0"},
  green:  {"--accent":"#39ffb0","--accent-2":"#00e5ff"},
  amber:  {"--accent":"#ffb340","--accent-2":"#ff4d7e"},
};
const STATUS_ORDER = ["todo","doing","blocked","done"];
const STATUS_META = {
  todo:    {label:"À faire",  icon:"",  color:"#5f7089"},
  doing:   {label:"En cours", icon:"◐", color:"var(--accent)"},
  blocked: {label:"Bloqué",   icon:"!", color:"#ff4d7e"},
  done:    {label:"Terminé",  icon:"✓", color:"#39ffb0"},
};

/* ============ STATE ============ */
let state = {
  user: null,          // objet utilisateur Supabase une fois connecté
  authMode: "login",   // 'login' | 'signup'
  authError: "",
  authNotice: "",
  authLoading: false,
  dataLoadOk: true, // passe à false si le chargement initial échoue → bloque persist() par sécurité
  skills: [],
  settings: { theme: "cyan" },
  selectedId: null,
  view: "dashboard", // 'dashboard' | 'skill'
  readOnly: false, // mode "Afficher" : consultation sans possibilité de modifier
  search: "",
  filterCat: "all",
  sortBy: "recent", // 'recent' | 'name' | 'progress'
  openAddChild: new Set(), // ids de sous-tâches avec la ligne "ajouter une sous-étape" ouverte (transitoire)
};
let loaded = false;

/* ============ MIGRATION (anciennes données) ============ */
function migrateSkills(){
  state.skills.forEach(s=>{
    if(!Array.isArray(s.tags)) s.tags = [];
    if(!Array.isArray(s.history)) s.history = [];
    s.subtasks = (s.subtasks||[]).map(st=>{
      const status = st.status || (st.done ? "done" : "todo");
      return {
        id: st.id,
        title: st.title,
        status,
        blockedNote: st.blockedNote || "",
        children: (st.children||[]).map(ch=>({
          id: ch.id,
          title: ch.title,
          status: ch.status || (ch.done ? "done" : "todo"),
          blockedNote: ch.blockedNote || "",
        })),
      };
    });
  });
}

/* ============ EXPORT / IMPORT MANUEL (sauvegarde locale en plus de Supabase) ============ */
function downloadJSON(){
  const data = JSON.stringify({skills:state.skills, settings:state.settings}, null, 2);
  const blob = new Blob([data], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "progression-data.json";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  showToast("✓ Fichier téléchargé");
}
function handleUploadFile(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const parsed = JSON.parse(reader.result);
      if(!Array.isArray(parsed.skills)) throw new Error("format invalide");
      state.skills = parsed.skills;
      if(parsed.settings) state.settings = parsed.settings;
      migrateSkills();
      persist();
      applyTheme();
      closeModal();
      goDashboard();
      showToast("✓ Données chargées depuis " + file.name);
    }catch(e){
      showToast("⚠ Fichier JSON invalide");
    }
  };
  reader.readAsText(file);
}

/* ============ AUTH ============ */
async function initAuth(){
  const { data:{ session } } = await supabaseClient.auth.getSession();
  if(session){
    state.user = session.user;
    await fetchUserData();
    migrateSkills();
  }
  loaded = true;
  applyTheme();
  render();

  supabaseClient.auth.onAuthStateChange((event, session)=>{
    if(event === "SIGNED_IN" && session){
      state.user = session.user;
      fetchUserData().then(()=>{ migrateSkills(); goDashboard(); });
    }
    if(event === "SIGNED_OUT"){
      state.user = null;
      state.skills = [];
      state.selectedId = null;
      state.view = "dashboard";
      render();
    }
    if(event === "PASSWORD_RECOVERY"){
      // L'utilisateur a cliqué sur le lien reçu par email : on lui permet
      // de définir un nouveau mot de passe avant de continuer.
      state.authMode = "reset";
      state.authError = ""; state.authNotice = "";
      render();
    }
  });
}
function isValidEmail(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
async function handleSignup(email, password){
  if(!isValidEmail(email)){ state.authError = "Adresse email invalide."; render(); return; }
  if(password.length < 6){ state.authError = "Le mot de passe doit faire au moins 6 caractères."; render(); return; }
  state.authLoading = true; state.authError = ""; state.authNotice = ""; render();
  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  state.authLoading = false;
  if(error){ state.authError = error.message; render(); return; }
  if(data.user && !data.session){
    state.authNotice = "✓ Compte créé. Vérifie tes emails pour confirmer ton adresse, puis connecte-toi.";
    state.authMode = "login";
  }
  render();
}
async function handleLogin(email, password){
  if(!isValidEmail(email)){ state.authError = "Adresse email invalide."; render(); return; }
  state.authLoading = true; state.authError = ""; state.authNotice = ""; render();
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  state.authLoading = false;
  if(error){ state.authError = error.message; render(); return; }
  // onAuthStateChange s'occupe de charger les données et de re-render
}
async function handleLogout(){
  await supabaseClient.auth.signOut();
}
async function handleForgotPassword(email){
  if(!isValidEmail(email)){ state.authError = "Adresse email invalide."; render(); return; }
  state.authLoading = true; state.authError = ""; state.authNotice = ""; render();
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  state.authLoading = false;
  if(error){ state.authError = error.message; render(); return; }
  state.authNotice = "✓ Email envoyé. Clique sur le lien reçu pour choisir un nouveau mot de passe.";
  state.authMode = "login";
  render();
}
async function handleSetNewPassword(password){
  if(password.length < 6){ state.authError = "Le mot de passe doit faire au moins 6 caractères."; render(); return; }
  state.authLoading = true; state.authError = ""; render();
  const { error } = await supabaseClient.auth.updateUser({ password });
  state.authLoading = false;
  if(error){ state.authError = error.message; render(); return; }
  state.authMode = "login";
  state.authNotice = "✓ Mot de passe mis à jour. Reconnecte-toi.";
  await supabaseClient.auth.signOut();
  render();
}

/* ============ PERSISTENCE (table user_data, une ligne JSON par utilisateur) ============ */
async function fetchUserData(){
  try{
    const { data, error } = await supabaseClient
      .from('user_data')
      .select('data')
      .eq('user_id', state.user.id)
      .maybeSingle();
    if(error) throw error;
    if(data && data.data){
      state.skills = data.data.skills || [];
      state.settings = data.data.settings || { theme: "cyan" };
    }else{
      state.skills = [];
      state.settings = { theme: "cyan" };
    }
    state.dataLoadOk = true;
  }catch(e){
    // Important : si le chargement échoue, on NE remplace PAS les données
    // et on bloque toute sauvegarde tant que ce n'est pas résolu — sinon
    // un état vide écraserait silencieusement les vraies données en base
    // dès la première modification.
    state.dataLoadOk = false;
    showToast("⚠ Chargement impossible — recharge la page avant de continuer");
  }
}
let saveTimer=null;
function setSaveIndicator(status){
  const el = document.getElementById('save-indicator');
  if(!el) return;
  el.className = "save-indicator " + status;
  el.textContent = status === "saving" ? "● Enregistrement..."
    : status === "saved" ? "✓ Enregistré"
    : status === "error" ? "⚠ Échec de sauvegarde"
    : "";
  clearTimeout(el._fadeTimer);
  if(status === "saved"){
    el._fadeTimer = setTimeout(()=>{ el.textContent = ""; el.className = "save-indicator idle"; }, 2500);
  }
}
function persist(){
  if(!state.user) return;
  if(state.dataLoadOk === false){
    showToast("⚠ Sauvegarde bloquée : recharge la page (le chargement initial a échoué)");
    return;
  }
  clearTimeout(saveTimer);
  setSaveIndicator("saving");
  saveTimer = setTimeout(async ()=>{
    try{
      const { error } = await supabaseClient.from('user_data').upsert({
        user_id: state.user.id,
        data: { skills: state.skills, settings: state.settings },
        updated_at: new Date().toISOString(),
      });
      if(error) throw error;
      setSaveIndicator("saved");
    }catch(e){
      setSaveIndicator("error");
      showToast("⚠ Sauvegarde impossible, réessaie");
    }
  }, 400);
}

function applyTheme(){
  const t = THEME_ACCENTS[state.settings.theme] || THEME_ACCENTS.cyan;
  Object.entries(t).forEach(([k,v])=>document.documentElement.style.setProperty(k,v));
}

/* ============ HELPERS ============ */
function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }
function now(){ return Date.now(); }
function esc(str){
  const d = document.createElement('div');
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}
function allItems(skill){
  const items = [];
  (skill.subtasks||[]).forEach(st=>{
    items.push(st);
    (st.children||[]).forEach(ch=>items.push(ch));
  });
  return items;
}
function skillProgress(skill){
  const items = allItems(skill);
  if(!items.length) return 0;
  const done = items.filter(i=>i.status==='done').length;
  return Math.round((done/items.length)*100);
}
function getSkill(id){ return state.skills.find(s=>s.id===id); }
function nextStatus(s){ return STATUS_ORDER[(STATUS_ORDER.indexOf(s)+1)%STATUS_ORDER.length]; }
function locate(skill, id){
  for(let i=0;i<skill.subtasks.length;i++){
    const st = skill.subtasks[i];
    if(st.id===id) return {item:st, container:skill.subtasks, index:i};
    const children = st.children||[];
    for(let j=0;j<children.length;j++){
      if(children[j].id===id) return {item:children[j], container:children, index:j};
    }
  }
  return null;
}
function accentOf(skill){ return (COLOR_MAP[skill.color]||COLOR_MAP.cyan).accent; }
function ringSVG(pct, size, stroke, color, fontSize){
  const r = (size-stroke)/2;
  const c = 2*Math.PI*r;
  const offset = c - (pct/100)*c;
  return `
    <div class="ring-wrap" style="width:${size}px;height:${size}px;">
      <svg width="${size}" height="${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="rgba(255,255,255,0.08)" stroke-width="${stroke}" fill="none"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" stroke="${color}" stroke-width="${stroke}" fill="none"
          stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"
          style="transition:stroke-dashoffset .5s ease; filter:drop-shadow(0 0 6px ${color}aa);"/>
      </svg>
      <div class="ring-pct" style="font-size:${fontSize}px;color:${color};">${pct}%</div>
    </div>`;
}
function timeAgo(ts){
  if(!ts) return "";
  const diff = Date.now() - ts;
  const min = Math.floor(diff/60000);
  if(min<1) return "à l'instant";
  if(min<60) return `il y a ${min} min`;
  const h = Math.floor(min/60);
  if(h<24) return `il y a ${h} h`;
  const d = Math.floor(h/24);
  if(d<30) return `il y a ${d} j`;
  return new Date(ts).toLocaleDateString('fr-FR');
}
function showToast(msg){
  let t = document.getElementById('toast');
  if(!t){
    t = document.createElement('div');
    t.id='toast'; t.className='toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.remove('show'), 2200);
}

/* ============ ACTIONS ============ */
function selectSkill(id){
  state.selectedId = id; state.view = "skill"; state.readOnly = false; render();
}
function goDashboard(){
  state.selectedId = null; state.view = "dashboard"; render();
}
function createSkill(data){
  const skill = {
    id: uid(),
    name: data.name.trim(),
    category: data.category,
    color: data.color,
    description: data.description.trim(),
    lastPosition: "",
    nextStep: "",
    tags: [],
    subtasks: [],
    history: [{id:uid(), date:now(), type:"auto", text:"Compétence créée", duration:null}],
    createdAt: now(),
    updatedAt: now(),
  };
  state.skills.unshift(skill);
  persist();
  selectSkill(skill.id);
  showToast("✓ Compétence créée");
}
function updateSkill(id, patch){
  const s = state.skills.find(s=>s.id===id);
  if(!s) return;
  Object.assign(s, patch, {updatedAt: now()});
  persist();
}
function deleteSkill(id){
  state.skills = state.skills.filter(s=>s.id!==id);
  if(state.selectedId===id) goDashboard();
  else render();
  persist();
  showToast("🗑 Compétence supprimée");
}
function addSubtask(skillId, title){
  const s = getSkill(skillId);
  if(!s || !title.trim()) return;
  s.subtasks.push({id:uid(), title:title.trim(), status:"todo", blockedNote:"", children:[]});
  s.updatedAt = now();
  persist();
  render();
}
function addChildSubtask(skillId, parentId, title){
  const s = getSkill(skillId);
  if(!s || !title.trim()) return;
  const parent = s.subtasks.find(x=>x.id===parentId);
  if(!parent) return;
  if(!parent.children) parent.children = [];
  parent.children.push({id:uid(), title:title.trim(), status:"todo", blockedNote:""});
  s.updatedAt = now();
  persist();
  render();
}
function cycleSubtaskStatus(skillId, subId){
  const s = getSkill(skillId);
  if(!s) return;
  const loc = locate(s, subId);
  if(!loc) return;
  loc.item.status = nextStatus(loc.item.status);
  if(!s.history) s.history = [];
  if(loc.item.status === "done"){
    s.history.push({id:uid(), date:now(), type:"auto", text:`✓ Terminé : ${loc.item.title}`, duration:null});
  }else if(loc.item.status === "blocked"){
    s.history.push({id:uid(), date:now(), type:"auto", text:`⚠ Bloqué : ${loc.item.title}`, duration:null});
  }
  s.updatedAt = now();
  persist();
  render();
}
function updateBlockedNote(skillId, subId, note){
  const s = getSkill(skillId);
  if(!s) return;
  const loc = locate(s, subId);
  if(!loc) return;
  loc.item.blockedNote = note;
  s.updatedAt = now();
  persist();
}
function deleteSubtask(skillId, subId){
  const s = getSkill(skillId);
  if(!s) return;
  const loc = locate(s, subId);
  if(!loc) return;
  const childCount = (loc.item.children||[]).length;
  const msg = childCount
    ? `Supprimer « ${loc.item.title} » et ses ${childCount} sous-étape${childCount>1?'s':''} ?`
    : `Supprimer « ${loc.item.title} » ?`;
  if(!confirm(msg)) return;
  loc.container.splice(loc.index, 1);
  s.updatedAt = now();
  persist();
  render();
}
function addHistoryEntry(skillId, text, type, duration){
  const s = getSkill(skillId);
  if(!s || !text.trim()) return;
  if(!s.history) s.history = [];
  s.history.push({id:uid(), date:now(), type:type||"manual", text:text.trim(), duration: duration || null});
  s.updatedAt = now();
  persist();
  render();
}
function deleteHistoryEntry(skillId, entryId){
  const s = getSkill(skillId);
  if(!s) return;
  if(!confirm("Supprimer cette entrée du journal ?")) return;
  s.history = (s.history||[]).filter(h=>h.id!==entryId);
  persist();
  render();
}
function formatMinutes(mins){
  if(!mins) return "0 min";
  const h = Math.floor(mins/60), m = mins%60;
  if(h && m) return `${h}h${String(m).padStart(2,'0')}`;
  if(h) return `${h}h`;
  return `${m} min`;
}
function skillMinutes(skill){
  return (skill.history||[]).reduce((a,h)=>a+(h.duration||0),0);
}
function globalMinutes(){
  return state.skills.reduce((a,s)=>a+skillMinutes(s),0);
}
function formatDate(ts){
  return new Date(ts).toLocaleDateString('fr-FR', {day:'2-digit', month:'2-digit', year:'numeric'});
}
function addTag(skillId, raw){
  const s = getSkill(skillId);
  if(!s || !raw.trim()) return;
  const tag = raw.trim().toLowerCase().replace(/\s+/g,'-').replace(/^#/,'');
  if(!tag) return;
  if(!s.tags.includes(tag)) s.tags.push(tag);
  s.updatedAt = now();
  persist();
  render();
}
function removeTag(skillId, tag){
  const s = getSkill(skillId);
  if(!s) return;
  s.tags = s.tags.filter(t=>t!==tag);
  s.updatedAt = now();
  persist();
  render();
}

/* ============ MODALS ============ */
function closeModal(){
  const ov = document.querySelector('.overlay');
  if(ov) ov.remove();
}
function openSkillModal(existing){
  closeModal();
  const isEdit = !!existing;
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
    <div class="modal">
      <h3>${isEdit ? "Modifier la compétence" : "Nouvelle compétence"}</h3>
      <div class="field">
        <label>Nom</label>
        <input id="m-name" placeholder="Ex: Réseaux (cybersécurité), Python avancé..." value="${isEdit?esc(existing.name):""}">
      </div>
      <div class="field">
        <label>Catégorie</label>
        <select id="m-cat">
          ${CATEGORIES.map(c=>`<option ${isEdit && existing.category===c?"selected":""}>${c}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Couleur</label>
        <div class="color-row" id="m-colors">
          ${Object.entries(COLOR_MAP).map(([key,v])=>`
            <div class="color-swatch ${(isEdit?existing.color:'cyan')===key?'selected':''}" data-color="${key}" style="background:${v.accent}"></div>
          `).join("")}
        </div>
      </div>
      <div class="field">
        <label>Description (optionnel)</label>
        <textarea id="m-desc" placeholder="Pourquoi cette compétence, objectif final...">${isEdit?esc(existing.description):""}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="m-cancel">Annuler</button>
        <button class="btn btn-primary" id="m-save">${isEdit?"Enregistrer":"Créer"}</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  let selectedColor = isEdit ? existing.color : 'cyan';
  ov.querySelectorAll('.color-swatch').forEach(sw=>{
    sw.addEventListener('click',()=>{
      selectedColor = sw.dataset.color;
      ov.querySelectorAll('.color-swatch').forEach(s2=>s2.classList.remove('selected'));
      sw.classList.add('selected');
    });
  });
  ov.addEventListener('click', e=>{ if(e.target===ov) closeModal(); });
  ov.querySelector('#m-cancel').addEventListener('click', closeModal);
  ov.querySelector('#m-save').addEventListener('click', ()=>{
    const name = ov.querySelector('#m-name').value;
    if(!name.trim()){ showToast("⚠ Donne un nom à la compétence"); return; }
    const data = {
      name,
      category: ov.querySelector('#m-cat').value,
      color: selectedColor,
      description: ov.querySelector('#m-desc').value,
    };
    if(isEdit){ updateSkill(existing.id, data); render(); showToast("✓ Modifications enregistrées"); }
    else createSkill(data);
    closeModal();
  });
  ov.querySelector('#m-name').focus();
}

function openDeleteConfirm(skill){
  closeModal();
  const ov = document.createElement('div');
  ov.className='overlay';
  ov.innerHTML = `
    <div class="modal" style="max-width:380px;">
      <h3>Supprimer « ${esc(skill.name)} » ?</h3>
      <p style="color:var(--text-mid);font-size:14px;margin-bottom:6px;">
        Cette action est définitive. Toutes les sous-tâches et notes associées seront perdues.
      </p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="d-cancel">Annuler</button>
        <button class="btn btn-danger" id="d-confirm">Supprimer</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e=>{ if(e.target===ov) closeModal(); });
  ov.querySelector('#d-cancel').addEventListener('click', closeModal);
  ov.querySelector('#d-confirm').addEventListener('click', ()=>{ deleteSkill(skill.id); closeModal(); });
}

function openSettingsModal(){
  closeModal();
  const ov = document.createElement('div');
  ov.className='overlay';
  ov.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <h3>Paramètres</h3>
      <label style="display:block;font-size:12.5px;color:var(--text-mid);margin-bottom:10px;font-weight:600;">Thème d'accent</label>
      <div class="theme-row">
        ${Object.entries(THEME_ACCENTS).map(([key,v])=>`
          <div class="theme-swatch ${state.settings.theme===key?'active':''}" data-theme="${key}">
            <span class="theme-dot" style="background:${v['--accent']}"></span>
            ${key === 'cyan' ? 'Cyan / Violet' : key==='violet' ? 'Violet / Magenta' : key==='green' ? 'Vert / Cyan' : 'Ambre / Rouge'}
          </div>
        `).join("")}
      </div>
      <div class="settings-divider"></div>
      <label style="display:block;font-size:12.5px;color:var(--text-mid);margin-bottom:10px;font-weight:600;">Exporter mes données</label>
      <textarea class="json-area" id="s-export" readonly></textarea>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-ghost btn-sm" id="s-copy">Copier</button>
        <button class="btn btn-ghost btn-sm" id="s-download">Télécharger .json</button>
      </div>
      <div class="small-note">Sauvegarde locale en plus de Supabase — utile si tu veux garder une copie hors-ligne.</div>
      <div class="settings-divider"></div>
      <label style="display:block;font-size:12.5px;color:var(--text-mid);margin-bottom:10px;font-weight:600;">Importer des données</label>
      <textarea class="json-area" id="s-import" placeholder="Colle ici un export JSON précédent..."></textarea>
      <div style="margin-top:8px;">
        <input type="file" id="s-upload" accept="application/json" style="font-size:12.5px;color:var(--text-mid);">
      </div>
      <div class="modal-actions" style="justify-content:space-between;">
        <button class="btn btn-danger btn-sm" id="s-reset">Réinitialiser tout</button>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-ghost" id="s-close">Fermer</button>
          <button class="btn btn-primary" id="s-import-btn">Importer</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#s-export').value = JSON.stringify({skills:state.skills, settings:state.settings}, null, 2);
  ov.querySelectorAll('.theme-swatch').forEach(sw=>{
    sw.addEventListener('click', ()=>{
      state.settings.theme = sw.dataset.theme;
      applyTheme(); persist();
      ov.querySelectorAll('.theme-swatch').forEach(s2=>s2.classList.remove('active'));
      sw.classList.add('active');
    });
  });
  ov.addEventListener('click', e=>{ if(e.target===ov) closeModal(); });
  ov.querySelector('#s-close').addEventListener('click', closeModal);
  ov.querySelector('#s-copy').addEventListener('click', async ()=>{
    const ta = ov.querySelector('#s-export');
    ta.select();
    try{
      await navigator.clipboard.writeText(ta.value);
      showToast("✓ Copié dans le presse-papier");
    }catch(e){
      try{ document.execCommand('copy'); showToast("✓ Copié"); }
      catch(e2){ showToast("Sélectionne le texte et copie manuellement (Ctrl+C)"); }
    }
  });
  ov.querySelector('#s-download').addEventListener('click', downloadJSON);
  ov.querySelector('#s-upload').addEventListener('change', e=>{
    const file = e.target.files[0];
    if(file) handleUploadFile(file);
  });
  ov.querySelector('#s-reset').addEventListener('click', ()=>{
    if(confirm("Supprimer TOUTES les compétences et données ? Cette action est irréversible.")){
      state.skills = [];
      persist();
      closeModal();
      goDashboard();
      showToast("Données réinitialisées");
    }
  });
  ov.querySelector('#s-import-btn').addEventListener('click', ()=>{
    const raw = ov.querySelector('#s-import').value.trim();
    if(!raw){ showToast("⚠ Colle un JSON d'abord"); return; }
    try{
      const parsed = JSON.parse(raw);
      if(!Array.isArray(parsed.skills)) throw new Error("format invalide");
      state.skills = parsed.skills;
      if(parsed.settings) state.settings = parsed.settings;
      migrateSkills();
      persist(); applyTheme();
      closeModal(); goDashboard();
      showToast("✓ Données importées");
    }catch(e){
      showToast("⚠ JSON invalide, vérifie le format");
    }
  });
}

/* ============ RENDER: SIDEBAR ============ */
function renderSidebar(){
  const filtered = state.skills.filter(s=>{
    const q = state.search.toLowerCase();
    const matchSearch = !state.search || s.name.toLowerCase().includes(q) || (s.tags||[]).some(t=>t.includes(q));
    const matchCat = state.filterCat==='all' || s.category===state.filterCat;
    return matchSearch && matchCat;
  }).sort((a,b)=>{
    if(state.sortBy === 'name') return a.name.localeCompare(b.name, 'fr');
    if(state.sortBy === 'progress') return skillProgress(b) - skillProgress(a);
    return b.updatedAt - a.updatedAt; // 'recent' par défaut
  });

  const cats = ['all', ...CATEGORIES];
  const sortLabels = { recent:"Récent", name:"Nom (A-Z)", progress:"Progression" };

  return `
    <div class="sidebar">
      <div class="search-box">
        <span class="ic">⌕</span>
        <input id="search-input" placeholder="Rechercher une compétence..." value="${esc(state.search)}">
      </div>

      <div class="nav-item ${state.view==='dashboard'?'active':''}" id="nav-dashboard">
        ⌂ &nbsp;Vue d'ensemble
      </div>

      <div class="sidebar-label">Catégories</div>
      <div class="chip-row">
        ${cats.map(c=>`<div class="chip ${state.filterCat===c?'active':''}" data-cat="${esc(c)}">${c==='all'?'Toutes':esc(c)}</div>`).join("")}
      </div>

      <div class="sort-row">
        <span class="sidebar-label" style="margin:0;">Trier</span>
        <select id="sort-select">
          ${Object.entries(sortLabels).map(([k,l])=>`<option value="${k}" ${state.sortBy===k?'selected':''}>${l}</option>`).join("")}
        </select>
      </div>

      <div class="sidebar-label">Compétences (${filtered.length})</div>
      <div class="skill-list">
        ${filtered.length ? filtered.map(s=>{
          const pct = skillProgress(s);
          const color = accentOf(s);
          return `
          <div class="skill-item ${state.selectedId===s.id?'active':''}" data-select="${s.id}">
            <div class="skill-item-top">
              <span class="skill-item-name">${esc(s.name)}</span>
              <span class="skill-item-pct" style="color:${color}">${pct}%</span>
            </div>
            <div class="mini-bar"><div style="width:${pct}%;background:${color};"></div></div>
            <span class="cat-tag">${esc(s.category)}${(s.tags&&s.tags.length) ? ' · ' + s.tags.slice(0,2).map(t=>'#'+esc(t)).join(' ') : ''}</span>
          </div>`;
        }).join("") : `<div class="empty-side">Aucune compétence ${state.search||state.filterCat!=='all' ? 'ne correspond' : 'pour l’instant'}.</div>`}
      </div>
    </div>`;
}

/* ============ RENDER: DASHBOARD ============ */
function renderDashboard(){
  const skills = state.skills;
  const totalSub = skills.reduce((a,s)=>a+allItems(s).length,0);
  const doneSub = skills.reduce((a,s)=>a+allItems(s).filter(x=>x.status==='done').length,0);
  const avgPct = skills.length ? Math.round(skills.reduce((a,s)=>a+skillProgress(s),0)/skills.length) : 0;
  const loggedMinutes = globalMinutes();

  const reprise = skills
    .filter(s=>s.nextStep && s.nextStep.trim())
    .sort((a,b)=>b.updatedAt-a.updatedAt)
    .slice(0,4);

  if(!skills.length){
    return `
      <div class="view">
        <div class="section-title">Vue d'ensemble</div>
        <div class="section-sub">Ton tableau de bord d'apprentissage.</div>
        <div class="glass empty-state">
          <h3>Aucune compétence pour le moment</h3>
          <p>Crée ta première compétence à suivre — programmation, maths, électricité auto, anglais, cybersécurité, ou autre chose. Ajoute des sous-tâches et note toujours où tu t'arrêtes : plus jamais perdu.</p>
          <button class="btn btn-primary" id="empty-cta">+ Créer ma première compétence</button>
        </div>
      </div>`;
  }

  return `
    <div class="view">
      <div class="section-title">Vue d'ensemble</div>
      <div class="section-sub">${skills.length} compétence${skills.length>1?'s':''} en cours de suivi.</div>

      <div class="stat-grid">
        <div class="glass stat-card">
          <div class="num">${skills.length}</div>
          <div class="label">COMPÉTENCES SUIVIES</div>
        </div>
        <div class="glass stat-card">
          <div class="num" style="color:var(--accent)">${avgPct}%</div>
          <div class="label">PROGRESSION MOYENNE</div>
        </div>
        <div class="glass stat-card">
          <div class="num">${doneSub}<span style="color:var(--text-dim);font-size:18px;">/${totalSub}</span></div>
          <div class="label">SOUS-TÂCHES TERMINÉES</div>
        </div>
        <div class="glass stat-card">
          <div class="num" style="color:var(--warn)">${reprise.length}</div>
          <div class="label">À REPRENDRE</div>
        </div>
        <div class="glass stat-card">
          <div class="num" style="color:var(--accent-2)">${formatMinutes(loggedMinutes)}</div>
          <div class="label">TEMPS LOGGÉ</div>
        </div>
      </div>

      <div class="glass activity-box">
        <div class="sidebar-label" style="margin-bottom:12px;">Activité (14 dernières semaines)</div>
        ${renderHeatmap()}
      </div>

      ${reprise.length ? `
      <div class="resume-block">
        <div class="sidebar-label" style="margin-bottom:10px;">↻ Reprendre où tu en étais</div>
        <div class="resume-list">
          ${reprise.map(s=>`
            <div class="glass resume-card" data-select="${s.id}">
              <div class="resume-dot" style="background:${accentOf(s)};box-shadow:0 0 10px ${accentOf(s)}66;"></div>
              <div class="resume-body">
                <div class="resume-name">${esc(s.name)}</div>
                <div class="resume-next">→ ${esc(s.nextStep)}</div>
              </div>
              <div class="resume-arrow">›</div>
            </div>
          `).join("")}
        </div>
      </div>` : ""}

      <div class="sidebar-label" style="margin-bottom:12px;">Toutes les compétences</div>
      <div class="card-grid">
        ${skills.map(s=>{
          const pct = skillProgress(s);
          const color = accentOf(s);
          return `
          <div class="glass skill-card" data-select="${s.id}">
            <div class="skill-card-top">
              <div>
                <div class="skill-card-name">${esc(s.name)}</div>
                <div class="cat-tag">${esc(s.category)}</div>
              </div>
              ${ringSVG(pct, 52, 5, color, 12)}
            </div>
            <div class="skill-card-sub">${allItems(s).filter(x=>x.status==='done').length}/${allItems(s).length} sous-tâches · ${timeAgo(s.updatedAt)}</div>
          </div>`;
        }).join("")}
      </div>
    </div>`;
}

function dayKey(d){ return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }
function renderHeatmap(){
  const counts = {};
  state.skills.forEach(s=>(s.history||[]).forEach(h=>{
    const key = dayKey(new Date(h.date));
    counts[key] = (counts[key]||0) + 1;
  }));
  const totalDays = 98; // ~14 semaines
  const today = new Date(); today.setHours(0,0,0,0);
  const days = [];
  for(let i=totalDays-1;i>=0;i--){
    const d = new Date(today); d.setDate(d.getDate()-i);
    days.push({date:d, count: counts[dayKey(d)] || 0});
  }
  const firstDow = days[0].date.getDay();
  const padded = Array(firstDow).fill(null).concat(days);
  const weeks = [];
  for(let i=0;i<padded.length;i+=7) weeks.push(padded.slice(i,i+7));

  const cols = weeks.map(week=>`
    <div class="heat-col">
      ${week.map(day=>{
        if(!day) return `<div class="heat-cell empty"></div>`;
        const level = day.count===0 ? 0 : day.count===1 ? 1 : day.count<=2 ? 2 : day.count<=4 ? 3 : 4;
        const label = `${day.date.toLocaleDateString('fr-FR')} · ${day.count} entrée${day.count>1?'s':''}`;
        return `<div class="heat-cell level-${level}" title="${label}"></div>`;
      }).join("")}
    </div>`).join("");

  return `<div class="heatmap-wrap"><div class="heatmap">${cols}</div>
    <div class="heat-legend">Moins <span class="heat-cell level-0"></span><span class="heat-cell level-1"></span><span class="heat-cell level-2"></span><span class="heat-cell level-3"></span><span class="heat-cell level-4"></span> Plus</div></div>`;
}
function renderSkillDetail(){
  const s = state.skills.find(x=>x.id===state.selectedId);
  if(!s) return renderDashboard();
  const pct = skillProgress(s);
  const color = accentOf(s);
  const ro = state.readOnly;

  return `
    <div class="view">
      <div class="detail-header">
        <div class="detail-title-row">
          ${ringSVG(pct, 76, 6, color, 16).replace('ring-wrap','big-ring-wrap').replace('ring-pct','big-ring-pct')}
          <div>
            <div class="detail-name">${esc(s.name)}</div>
            <div class="cat-tag" style="font-size:12px;">${esc(s.category)}</div>
            ${s.description ? `<div class="detail-desc">${esc(s.description)}</div>` : ""}
          </div>
        </div>
        <div class="detail-actions">
          <button class="btn ${ro?'btn-primary':'btn-ghost'} btn-sm" id="toggle-view">${ro ? "✏️ Revenir à l'édition" : "👁 Afficher"}</button>
          ${!ro ? `
            <button class="btn btn-ghost btn-sm" id="edit-skill">Modifier</button>
            <button class="btn btn-danger btn-sm" id="del-skill">Supprimer</button>
          ` : ""}
        </div>
      </div>
      ${ro ? `<div class="readonly-banner">👁 Mode affichage — consultation uniquement, rien ne peut être modifié ici.</div>` : ""}

      <div class="tag-row">
        ${(s.tags||[]).map(t=>`<span class="tag-chip">#${esc(t)}${!ro ? `<button data-removetag="${esc(t)}">✕</button>` : ""}</span>`).join("")}
        ${!ro ? `<input id="new-tag" class="tag-input" placeholder="+ tag">` : ""}
        ${(ro && !(s.tags||[]).length) ? `<span class="empty-side" style="padding:0;">Aucun tag.</span>` : ""}
      </div>

      <div class="grid-2">
        <div class="glass panel-box">
          <label>📍 Où j'en suis</label>
          ${ro
            ? `<div class="readonly-text">${s.lastPosition ? esc(s.lastPosition) : '<span class="empty-side" style="padding:0;">Rien de noté.</span>'}</div>`
            : `<textarea id="last-pos" placeholder="Ex: j'ai fini le chapitre sur les fonctions, je bloque sur la récursivité...">${esc(s.lastPosition)}</textarea>
               <div class="save-row">
                 <span class="save-hint">Ctrl+Entrée pour enregistrer</span>
                 <button class="btn btn-primary btn-sm" id="save-pos">Enregistrer</button>
               </div>`}
        </div>
        <div class="glass panel-box">
          <label>➜ Prochaine étape</label>
          ${ro
            ? `<div class="readonly-text">${s.nextStep ? esc(s.nextStep) : '<span class="empty-side" style="padding:0;">Rien de noté.</span>'}</div>`
            : `<textarea id="next-step" placeholder="Ex: reprendre l'exercice sur la récursivité, chapitre 4...">${esc(s.nextStep)}</textarea>
               <div class="save-row">
                 <span class="save-hint">Apparaît dans « à reprendre »</span>
                 <button class="btn btn-primary btn-sm" id="save-next">Enregistrer</button>
               </div>`}
        </div>
      </div>

      <div class="glass subtasks-box">
        <div class="subtasks-head">
          <div class="sidebar-label" style="margin:0;">Sous-tâches</div>
          <div class="subtasks-progress-text">${allItems(s).filter(x=>x.status==='done').length} / ${allItems(s).length} terminées</div>
        </div>
        ${s.subtasks.length ? s.subtasks.map(st=>subtaskRow(s.id, st, ro)).join("")
          : `<div class="empty-side" style="text-align:left;padding:8px 4px;">Aucune sous-tâche${ro ? "." : ". Découpe cette compétence en étapes concrètes pour ne rien perdre de vue."}</div>`}
        ${!ro ? `
          <div class="add-subtask-row">
            <input id="new-subtask" placeholder="Ajouter une sous-tâche... (Entrée pour valider)">
            <button class="btn btn-primary btn-sm" id="add-subtask-btn">+ Ajouter</button>
          </div>` : ""}
      </div>

      <div class="glass journal-box">
        <div class="subtasks-head">
          <div class="sidebar-label" style="margin:0;">📓 Journal de progression</div>
          <div class="subtasks-progress-text">${formatMinutes(skillMinutes(s))} au total</div>
        </div>
        ${!ro ? `
          <div class="journal-add-row">
            <textarea id="journal-note" placeholder="Ex: bossé 40 min sur les fonctions, bloqué sur la récursivité..."></textarea>
            <div class="journal-add-actions">
              <input id="journal-duration" type="number" min="0" placeholder="min" class="duration-input">
              <button class="btn btn-primary btn-sm" id="add-journal-btn">+ Ajouter au journal</button>
            </div>
          </div>` : ""}
        <div class="journal-list">
          ${(s.history||[]).slice().sort((a,b)=>b.date-a.date).map(h=>journalEntryHtml(h, ro)).join("")
            || `<div class="empty-side" style="text-align:left;padding:8px 4px;">Aucune entrée${ro ? "." : ". Note tes sessions ici pour garder une trace de ta progression dans le temps."}</div>`}
        </div>
      </div>
    </div>`;
}

function journalEntryHtml(h, ro){
  const isAuto = h.type === "auto";
  return `
    <div class="journal-entry">
      <div class="journal-icon ${isAuto?'auto':'manual'}">${isAuto?'⚙':'📝'}</div>
      <div class="journal-body">
        <div class="journal-text">${esc(h.text)}${h.duration ? ` <span class="journal-duration">· ${h.duration} min</span>` : ""}</div>
        <div class="journal-date">${formatDate(h.date)} · ${timeAgo(h.date)}</div>
      </div>
      ${!ro ? `<button class="journal-del" data-delhist="${h.id}">✕</button>` : ""}
    </div>`;
}

function statusPill(skillId, item, ro){
  const meta = STATUS_META[item.status] || STATUS_META.todo;
  if(ro){
    return `<div class="status-pill status-${item.status} readonly" title="${meta.label}">${meta.icon}</div>`;
  }
  return `<div class="status-pill status-${item.status}" data-cyclestatus="${item.id}" title="${meta.label} — cliquer pour changer">${meta.icon}</div>`;
}

function subtaskRow(skillId, st, ro){
  const childrenOpen = state.openAddChild.has(st.id);
  return `
    <div class="subtask-group">
      <div class="subtask-row">
        ${statusPill(skillId, st, ro)}
        <div class="subtask-title-wrap">
          <div class="subtask-title ${st.status==='done'?'done':''}">${esc(st.title)}</div>
          ${st.status==='blocked' ? (ro
            ? `<div class="blocked-note readonly-text" style="margin-top:8px;">${st.blockedNote ? esc(st.blockedNote) : "—"}</div>`
            : `<textarea class="blocked-note" data-blockednote="${st.id}" placeholder="Pourquoi c'est bloqué ?">${esc(st.blockedNote)}</textarea>`) : ""}
        </div>
        ${!ro ? `
          <button class="subtask-addchild ${childrenOpen?'active':''}" data-addchild="${st.id}" title="Ajouter une sous-étape">+</button>
          <button class="subtask-del" data-delsub="${st.id}">✕</button>
        ` : ""}
      </div>
      ${(st.children||[]).map(ch=>`
        <div class="subtask-row child-row">
          ${statusPill(skillId, ch, ro)}
          <div class="subtask-title-wrap">
            <div class="subtask-title ${ch.status==='done'?'done':''}">${esc(ch.title)}</div>
            ${ch.status==='blocked' ? (ro
              ? `<div class="blocked-note readonly-text" style="margin-top:8px;">${ch.blockedNote ? esc(ch.blockedNote) : "—"}</div>`
              : `<textarea class="blocked-note" data-blockednote="${ch.id}" placeholder="Pourquoi c'est bloqué ?">${esc(ch.blockedNote)}</textarea>`) : ""}
          </div>
          ${!ro ? `<button class="subtask-del" data-delsub="${ch.id}">✕</button>` : ""}
        </div>
      `).join("")}
      ${(childrenOpen && !ro) ? `
        <div class="child-add-row">
          <input class="child-input" data-childinput="${st.id}" placeholder="Sous-étape... (Entrée pour valider)">
        </div>` : ""}
    </div>`;
}

/* ============ RENDER: AUTH SCREEN ============ */
function renderAuthScreen(){
  const mode = state.authMode; // login | signup | forgot | reset
  const titles = { login:"Se connecter", signup:"Créer un compte", forgot:"Mot de passe oublié", reset:"Nouveau mot de passe" };
  return `
    <div class="auth-wrap">
      <div class="glass auth-card">
        <div class="brand" style="margin-bottom:8px;justify-content:center;"><span class="dot"></span>SkillTracker</div>
        <div class="brand-sub" style="text-align:center;margin-bottom:18px;">Suivi de compétences</div>
        <h3 style="text-align:center;margin-bottom:18px;">${titles[mode]}</h3>
        ${state.authNotice ? `<div class="auth-notice">${esc(state.authNotice)}</div>` : ""}
        ${state.authError ? `<div class="auth-error">${esc(state.authError)}</div>` : ""}

        ${mode === "reset" ? `
          <div class="field">
            <label>Nouveau mot de passe</label>
            <input id="auth-password" type="password" placeholder="•••••••• (6 caractères min.)" autocomplete="new-password">
          </div>
          <button class="btn btn-primary" id="auth-submit" style="width:100%;justify-content:center;margin-top:6px;" ${state.authLoading?'disabled':''}>
            ${state.authLoading ? "..." : "Enregistrer le mot de passe"}
          </button>
        ` : `
          <div class="field">
            <label>Email</label>
            <input id="auth-email" type="email" placeholder="toi@exemple.com" autocomplete="email">
          </div>
          ${mode !== "forgot" ? `
            <div class="field">
              <label>Mot de passe</label>
              <input id="auth-password" type="password" placeholder="•••••••• (6 caractères min.)" autocomplete="${mode==='signup'?'new-password':'current-password'}">
            </div>
          ` : ""}
          <button class="btn btn-primary" id="auth-submit" style="width:100%;justify-content:center;margin-top:6px;" ${state.authLoading?'disabled':''}>
            ${state.authLoading ? "..." : mode === "signup" ? "Créer mon compte" : mode === "forgot" ? "Envoyer le lien" : "Se connecter"}
          </button>
        `}

        ${mode === "login" ? `<div class="auth-forgot"><button id="auth-forgot-link">Mot de passe oublié ?</button></div>` : ""}

        <div class="auth-switch">
          ${mode === "signup" ? `Déjà un compte ? <button id="auth-toggle">Se connecter</button>`
            : mode === "forgot" ? `<button id="auth-toggle">← Retour à la connexion</button>`
            : mode === "reset" ? ""
            : `Pas encore de compte ? <button id="auth-toggle">Créer un compte</button>`}
        </div>
      </div>
    </div>`;
}

/* ============ MAIN RENDER ============ */
function render(){
  const app = document.getElementById('app');
  if(!loaded){
    app.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:var(--text-dim);font-family:var(--font-mono);">Chargement...</div>`;
    return;
  }
  if(!state.user){
    app.innerHTML = renderAuthScreen();
    bindAuthEvents();
    return;
  }
  app.innerHTML = `
    <div class="topbar">
      <div class="brand"><span class="dot"></span>SkillTracker <small>// SUIVI DE COMPÉTENCES</small></div>
      <div class="topbar-actions">
        <span id="save-indicator" class="save-indicator idle"></span>
        <button class="btn btn-primary" id="new-skill-btn">+ Nouvelle compétence</button>
        <button class="btn btn-ghost btn-icon" id="settings-btn" title="Paramètres">⚙</button>
        <button class="btn btn-ghost btn-icon" id="logout-btn" title="Se déconnecter">⏻</button>
      </div>
    </div>
    <div class="layout">
      ${renderSidebar()}
      <div class="main">
        ${state.view==='skill' ? renderSkillDetail() : renderDashboard()}
      </div>
    </div>
  `;
  bindEvents();
}

function bindAuthEvents(){
  const $ = sel => document.querySelector(sel);
  $('#auth-toggle')?.addEventListener('click', ()=>{
    state.authMode = state.authMode === "signup" ? "login" : (state.authMode === "forgot" ? "login" : "signup");
    state.authError = ""; state.authNotice = "";
    render();
  });
  $('#auth-forgot-link')?.addEventListener('click', ()=>{
    state.authMode = "forgot";
    state.authError = ""; state.authNotice = "";
    render();
  });
  const submit = ()=>{
    const mode = state.authMode;
    if(mode === "reset"){
      const password = $('#auth-password').value;
      if(!password){ state.authError = "Renseigne un mot de passe."; render(); return; }
      handleSetNewPassword(password);
      return;
    }
    const email = $('#auth-email').value.trim();
    if(mode === "forgot"){
      if(!email){ state.authError = "Renseigne ton email."; render(); return; }
      handleForgotPassword(email);
      return;
    }
    const password = $('#auth-password').value;
    if(!email || !password){ state.authError = "Renseigne un email et un mot de passe."; render(); return; }
    if(mode === "signup") handleSignup(email, password);
    else handleLogin(email, password);
  };
  $('#auth-submit').addEventListener('click', submit);
  $('#auth-password')?.addEventListener('keydown', e=>{ if(e.key==='Enter') submit(); });
  $('#auth-email')?.addEventListener('keydown', e=>{ if(e.key==='Enter' && state.authMode==='forgot') submit(); });
}

/* ============ EVENT BINDING ============ */
function bindEvents(){
  const $ = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  $('#new-skill-btn')?.addEventListener('click', ()=>openSkillModal(null));
  $('#settings-btn')?.addEventListener('click', openSettingsModal);
  $('#logout-btn')?.addEventListener('click', ()=>{
    if(confirm("Te déconnecter ?")) handleLogout();
  });
  $('#nav-dashboard')?.addEventListener('click', goDashboard);
  $('#empty-cta')?.addEventListener('click', ()=>openSkillModal(null));

  const searchInput = $('#search-input');
  if(searchInput){
    searchInput.addEventListener('input', e=>{
      state.search = e.target.value;
      // re-render only sidebar to keep focus smooth
      const sidebarEl = document.querySelector('.sidebar');
      const temp = document.createElement('div');
      temp.innerHTML = renderSidebar();
      sidebarEl.replaceWith(temp.firstElementChild);
      bindEvents();
      document.getElementById('search-input').focus();
      const val = document.getElementById('search-input').value;
      document.getElementById('search-input').setSelectionRange(val.length,val.length);
    });
  }

  $$('.chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{ state.filterCat = chip.dataset.cat; render(); });
  });
  $('#sort-select')?.addEventListener('change', e=>{ state.sortBy = e.target.value; render(); });

  $$('[data-select]').forEach(el=>{
    el.addEventListener('click', ()=> selectSkill(el.dataset.select));
  });

  $('#toggle-view')?.addEventListener('click', ()=>{
    state.readOnly = !state.readOnly;
    render();
  });
  $('#edit-skill')?.addEventListener('click', ()=>{
    const s = state.skills.find(x=>x.id===state.selectedId);
    if(s) openSkillModal(s);
  });
  $('#del-skill')?.addEventListener('click', ()=>{
    const s = state.skills.find(x=>x.id===state.selectedId);
    if(s) openDeleteConfirm(s);
  });

  const posArea = $('#last-pos');
  if(posArea){
    posArea.addEventListener('keydown', e=>{
      if(e.key==='Enter' && (e.ctrlKey||e.metaKey)) $('#save-pos').click();
    });
    $('#save-pos').addEventListener('click', ()=>{
      updateSkill(state.selectedId, {lastPosition: posArea.value});
      showToast("✓ Position enregistrée");
    });
  }
  const nextArea = $('#next-step');
  if(nextArea){
    nextArea.addEventListener('keydown', e=>{
      if(e.key==='Enter' && (e.ctrlKey||e.metaKey)) $('#save-next').click();
    });
    $('#save-next').addEventListener('click', ()=>{
      updateSkill(state.selectedId, {nextStep: nextArea.value});
      showToast("✓ Prochaine étape enregistrée");
    });
  }

  $$('[data-cyclestatus]').forEach(el=>{
    el.addEventListener('click', ()=> cycleSubtaskStatus(state.selectedId, el.dataset.cyclestatus));
  });
  $$('[data-delsub]').forEach(el=>{
    el.addEventListener('click', ()=> deleteSubtask(state.selectedId, el.dataset.delsub));
  });
  $$('[data-blockednote]').forEach(el=>{
    el.addEventListener('input', ()=> updateBlockedNote(state.selectedId, el.dataset.blockednote, el.value));
  });
  $$('[data-addchild]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const id = el.dataset.addchild;
      if(state.openAddChild.has(id)) state.openAddChild.delete(id);
      else state.openAddChild.add(id);
      render();
      const input = document.querySelector(`[data-childinput="${id}"]`);
      if(input) input.focus();
    });
  });
  $$('[data-childinput]').forEach(el=>{
    el.addEventListener('keydown', e=>{
      if(e.key==='Enter' && el.value.trim()){
        const parentId = el.dataset.childinput;
        addChildSubtask(state.selectedId, parentId, el.value);
        state.openAddChild.add(parentId);
      }
    });
  });
  $$('[data-removetag]').forEach(el=>{
    el.addEventListener('click', ()=> removeTag(state.selectedId, el.dataset.removetag));
  });
  const newTag = $('#new-tag');
  if(newTag){
    newTag.addEventListener('keydown', e=>{
      if(e.key==='Enter' && newTag.value.trim()){ addTag(state.selectedId, newTag.value); }
    });
  }
  const newSub = $('#new-subtask');
  if(newSub){
    const doAdd = ()=>{ addSubtask(state.selectedId, newSub.value); };
    $('#add-subtask-btn').addEventListener('click', doAdd);
    newSub.addEventListener('keydown', e=>{ if(e.key==='Enter') doAdd(); });
  }

  const journalNote = $('#journal-note');
  if(journalNote){
    const doAddJournal = ()=>{
      const text = journalNote.value.trim();
      if(!text){ showToast("⚠ Écris une note avant d'ajouter"); return; }
      const durVal = $('#journal-duration').value;
      const duration = durVal ? parseInt(durVal,10) : null;
      addHistoryEntry(state.selectedId, text, "manual", duration);
    };
    $('#add-journal-btn').addEventListener('click', doAddJournal);
    journalNote.addEventListener('keydown', e=>{
      if(e.key==='Enter' && (e.ctrlKey||e.metaKey)) doAddJournal();
    });
  }
  $$('[data-delhist]').forEach(el=>{
    el.addEventListener('click', ()=> deleteHistoryEntry(state.selectedId, el.dataset.delhist));
  });
}

/* ============ INIT ============ */
initAuth();
})();
