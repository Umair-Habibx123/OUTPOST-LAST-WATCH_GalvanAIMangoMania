// src/voice.js
/* Optional VOICE HELP (Settings → "Voice help during game").
   Hands-free QUICK ACCESS to the field kit + weapon switching while you play —
   NOT aiming or firing (device / hand controls still do that). Say things like:
     "war beast" · "dragon" / "dracarys" · "backup team" · "supply" ·
     a weapon name ("repeater", "shotgun", "mortar", "tesla" …) · "volley"
   and it deploys / switches for you. Uses the Web Speech API; the mic is only
   open while a match is running AND the setting is on, and is released otherwise.
   Fails silent if the browser has no speech recognition. */
window.OLW = window.OLW || {};

OLW.Voice = (function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  let recog = null;
  let running = false;   // recognition actually active
  let wantOn = false;    // we WANT it active (setting on + playing + visible)
  let toastEl = null, toastTimer = null;

  const G = () => window.OLW_GAME;

  const item = (id) => (OLW.Arsenal && OLW.Arsenal.useItem ? OLW.Arsenal.useItem(id) : undefined);
  const weapon = (id) => (OLW.Arsenal && OLW.Arsenal.equip ? OLW.Arsenal.equip(id) : undefined);

  // First matching phrase wins. Field-kit first, then weapons, then volley.
  const COMMANDS = [
    { re: /\b(dracarys|dracarus|dragon|ember)\b/, act: () => item('dragon'), label: 'Dragon Strike' },
    { re: /\b(war ?beast|war ?beats|beast|war ?hound|hound)\b/, act: () => item('warhound'), label: 'War Beast' },
    { re: /\b(back ?up|reinforce\w*|rally|allies|squad)\b/, act: () => item('rally'), label: 'Backup Team' },
    { re: /\b(weapon supply|resupply|re ?arm|ammo|reload)\b/, act: () => item('weaponSupply'), label: 'Weapon Supply' },
    { re: /\b(supply|repair|mango|patch|mend)\b/, act: () => item('supply'), label: 'Supply Line' },
    { re: /\b(volley|signal)\b/, act: () => { const g = G(); if (g && g.useVolley) g.useVolley(); return true; }, label: 'Signal Volley' },
    { re: /\b(side ?arm|pistol)\b/, act: () => weapon('sidearm'), label: 'Sidearm' },
    { re: /\b(repeater|rifle|rapid)\b/, act: () => weapon('repeater'), label: 'Repeater' },
    { re: /\b(scatter\w*|shot ?gun|spread)\b/, act: () => weapon('scattergun'), label: 'Scattergun' },
    { re: /\b(cannon|siege)\b/, act: () => weapon('cannon'), label: 'Siege Cannon' },
    { re: /\b(mortar|artillery)\b/, act: () => weapon('mortar'), label: 'Mortar' },
    { re: /\b(tesla|coil|chain|lightning)\b/, act: () => weapon('tesla'), label: 'Tesla Coil' },
  ];

  function ensureToast() {
    if (toastEl) return;
    if (!document.getElementById('voice-css')) {
      const s = document.createElement('style'); s.id = 'voice-css';
      s.textContent = '.olw-voice-toast{position:absolute;left:50%;top:104px;transform:translateX(-50%);z-index:8;background:rgba(12,16,22,.9);border:1px solid #4a4436;color:#f5c36b;font-size:12px;font-weight:800;padding:5px 13px;border-radius:14px;pointer-events:none;opacity:0;transition:opacity .18s;white-space:nowrap}.olw-voice-toast.err{border-color:#c5543f;color:#f2a295}';
      document.head.appendChild(s);
    }
    toastEl = document.createElement('div'); toastEl.className = 'olw-voice-toast';
    (document.getElementById('stage') || document.body).appendChild(toastEl);
  }
  function toast(msg, ok) {
    ensureToast();
    toastEl.textContent = '🎙 ' + msg;
    toastEl.className = 'olw-voice-toast' + (ok === false ? ' err' : '');
    toastEl.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.style.opacity = '0'; }, 1400);
  }

  function handle(transcript) {
    const t = (transcript || '').toLowerCase();
    for (const c of COMMANDS) {
      if (c.re.test(t)) {
        const r = c.act();
        toast(c.label + (r === false ? ' — none left' : ''), r !== false);
        return true;
      }
    }
    return false;
  }

  function ensureRecog() {
    if (recog || !SR) return recog;
    recog = new SR();
    recog.continuous = true;
    recog.interimResults = false;
    recog.lang = 'en-US';
    recog.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) handle(ev.results[i][0].transcript);
      }
    };
    recog.onend = () => { running = false; if (wantOn) start(); };   // auto-restart while wanted
    recog.onerror = (e) => {
      if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
        wantOn = false;
        toast('Mic blocked', false);
        if (OLW.Settings && OLW.Settings.set) OLW.Settings.set('voiceHelp', false);
      }
    };
    return recog;
  }

  function start() {
    if (running || !SR) return;
    ensureRecog();
    try { recog.start(); running = true; } catch (e) { /* start() throws if already starting */ }
  }

  // Decide whether the mic should be open right now.
  function evaluate() {
    const on = !!(OLW.Settings && OLW.Settings.get && OLW.Settings.get('voiceHelp'));
    const g = G();
    const playing = g && g.state === 'playing';
    wantOn = !!(SR && on && playing && !document.hidden);
    if (wantOn) start();
    else if (running && recog) { try { recog.stop(); } catch (e) {} running = false; }
  }

  window.addEventListener('olw:profilesync', evaluate);   // setting changed / synced
  document.addEventListener('visibilitychange', evaluate);
  setInterval(evaluate, 500);                             // follow game start/stop

  // `command(text)` runs the same matcher the mic uses — handy for QA / a future
  // text-command fallback. Returns true if a phrase matched.
  return { supported: !!SR, evaluate, command: handle };
})();
