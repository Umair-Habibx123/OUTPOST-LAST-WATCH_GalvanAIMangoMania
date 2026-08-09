// src/voice.js
/*
  OUTPOST: LAST WATCH — FAST VOICE QUICK ACCESS

  Voice is ONLY for:
    - field-kit activation
    - weapon switching
    - signal volley

  It does NOT aim or fire.

  Main improvement:
  We process INTERIM Web Speech API results instead of waiting for a final
  transcript. That removes most of the noticeable command delay.
*/

const VOICE_COMMANDS = [
  {
    id: 'dragon',
    title: 'Dragon Strike',
    callout: 'DRACARYS!',
    category: 'Field Kit',
    phrases: [
      'Dracarys',
      'Dracarus',
      'Dracaris',
      'Dragon',
      'Dragon Strike',
      'Ember Strike'
    ],
    re: /\b(dracarys|dracarus|dracaris|dragon|dragon strike|ember strike)\b/i,
    act: () => useItem('dragon')
  },

  {
    id: 'warhound',
    title: 'War Beast',
    callout: 'RELEASE THE BEAST!',
    category: 'Field Kit',
    phrases: [
      'War Beast',
      'Warbeast',
      'War Hound',
      'Warhound',
      'Hound',
      'Beast'
    ],
    re: /\b(war beast|warbeast|war hound|warhound|hound|beast)\b/i,
    act: () => useItem('warhound')
  },

  {
    id: 'rally',
    title: 'Backup Team',
    callout: 'REINFORCEMENTS!',
    category: 'Field Kit',
    phrases: [
      'Backup Team',
      'Back Up Team',
      'Backup',
      'Back Up',
      'Reinforcements',
      'Reinforcement',
      'Reinforce',
      'Rally',
      'Allies',
      'Squad'
    ],
    re: /\b(backup team|back up team|backup|back up|reinforcements?|reinforce|rally|allies|squad)\b/i,
    act: () => useItem('rally')
  },

  {
    id: 'weaponSupply',
    title: 'Weapon Supply',
    callout: 'REARM!',
    category: 'Field Kit',
    phrases: [
      'Weapon Supply',
      'Weapons Supply',
      'Ammo Supply',
      'Resupply',
      'Re Supply',
      'Rearm',
      'Re Arm',
      'Reload Ammo',
      'Ammunition'
    ],
    re: /\b(weapon supply|weapons supply|ammo supply|resupply|re supply|rearm|re arm|reload ammo|ammunition)\b/i,
    act: () => useItem('weaponSupply')
  },

  {
    id: 'supply',
    title: 'Supply Line',
    callout: 'MEND THE WALL!',
    category: 'Field Kit',
    phrases: [
      'Supply Line',
      'Wall Supply',
      'Repair Wall',
      'Repair',
      'Supplies',
      'Supply',
      'Mango',
      'Patch Wall',
      'Mend Wall'
    ],
    re: /\b(supply line|wall supply|repair wall|repair|supplies|supply|mango|patch wall|mend wall)\b/i,
    act: () => useItem('supply')
  },

  {
    id: 'volley',
    title: 'Signal Volley',
    callout: 'FIRE VOLLEY!',
    category: 'Battle Command',
    phrases: [
      'Signal Volley',
      'Fire Volley',
      'Volley',
      'Signal'
    ],
    re: /\b(signal volley|fire volley|volley|signal)\b/i,
    act: useVolley
  },

  {
    id: 'sidearm',
    title: 'Sidearm',
    category: 'Weapon',
    phrases: [
      'Sidearm',
      'Side Arm',
      'Pistol',
      'Handgun'
    ],
    re: /\b(sidearm|side arm|pistol|handgun)\b/i,
    act: () => equipWeapon('sidearm')
  },

  {
    id: 'repeater',
    title: 'Repeater',
    category: 'Weapon',
    phrases: [
      'Repeater',
      'Rapid Rifle',
      'Rapid',
      'Rifle'
    ],
    re: /\b(repeater|rapid rifle|rapid|rifle)\b/i,
    act: () => equipWeapon('repeater')
  },

  {
    id: 'scattergun',
    title: 'Scattergun',
    category: 'Weapon',
    phrases: [
      'Scattergun',
      'Scatter Gun',
      'Shotgun',
      'Shot Gun',
      'Spread Gun'
    ],
    re: /\b(scattergun|scatter gun|shotgun|shot gun|spread gun)\b/i,
    act: () => equipWeapon('scattergun')
  },

  {
    id: 'cannon',
    title: 'Siege Cannon',
    category: 'Weapon',
    phrases: [
      'Siege Cannon',
      'Cannon',
      'Heavy Cannon',
      'Siege'
    ],
    re: /\b(siege cannon|cannon|heavy cannon|siege)\b/i,
    act: () => equipWeapon('cannon')
  },

  {
    id: 'mortar',
    title: 'Mortar',
    category: 'Weapon',
    phrases: [
      'Mortar',
      'Artillery'
    ],
    re: /\b(mortar|artillery)\b/i,
    act: () => equipWeapon('mortar')
  },

  {
    id: 'tesla',
    title: 'Tesla Coil',
    category: 'Weapon',
    phrases: [
      'Tesla Coil',
      'Tesla',
      'Coil',
      'Lightning',
      'Chain Lightning'
    ],
    re: /\b(tesla coil|tesla|coil|lightning|chain lightning)\b/i,
    act: () => equipWeapon('tesla')
  }
];

window.OLW = window.OLW || {};

OLW.Voice = (function () {
  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  const SpeechGrammarList =
    window.SpeechGrammarList ||
    window.webkitSpeechGrammarList;

  let recognition = null;

  let running = false;
  let starting = false;
  let wantOn = false;

  let restartTimer = null;

  let toastEl = null;
  let toastTimer = null;

  // Prevent one spoken phrase from activating the same command multiple times
  // as interim recognition gets progressively refined.
  let lastCommandId = '';
  let lastCommandAt = 0;

  // Short enough to feel immediate, long enough to block interim duplicates.
  const COMMAND_COOLDOWN = 850;

  const game = () => window.OLW_GAME;

  function useItem(id) {
    if (!OLW.Arsenal || typeof OLW.Arsenal.useItem !== 'function') {
      return false;
    }

    return OLW.Arsenal.useItem(id);
  }

  function equipWeapon(id) {
    if (!OLW.Arsenal || typeof OLW.Arsenal.equip !== 'function') {
      return false;
    }

    return OLW.Arsenal.equip(id);
  }

  function useVolley() {
    const g = game();

    if (!g || g.state !== 'playing' || typeof g.useVolley !== 'function') {
      return false;
    }

    return g.useVolley();
  }

  /*
    Keep VOICE_COMMANDS short and distinctive.

    Put field-kit VOICE_COMMANDS first so e.g. "weapon supply" is not accidentally
    caught by a generic weapon-related phrase.
  */

  function normalise(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[.,!?;:'"]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ------------------------------------------------------------------------
     TOAST
     ------------------------------------------------------------------------ */

  function ensureToast() {
    if (toastEl) return;

    if (!document.getElementById('voice-css')) {
      const style = document.createElement('style');

      style.id = 'voice-css';

      style.textContent = `
        .olw-voice-toast {
          position: absolute;
          left: 50%;
          top: 92px;
          transform: translateX(-50%);

          z-index: 25;

          display: flex;
          align-items: center;
          gap: 7px;

          max-width: min(420px, 80vw);

          padding: 7px 14px;

          color: #f5c36b;
          background: rgba(10, 13, 18, .91);

          border: 1px solid rgba(232, 161, 58, .42);
          border-radius: 18px;

          box-shadow: 0 8px 26px rgba(0,0,0,.38);

          font-size: 11px;
          font-weight: 900;
          letter-spacing: .3px;

          pointer-events: none;

          opacity: 0;
          transition: opacity .12s ease;

          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .olw-voice-toast.err {
          border-color: rgba(197,84,63,.7);
          color: #f2a295;
        }

        .olw-voice-toast.heard {
          color: #d6c9aa;
          border-color: rgba(255,255,255,.13);
        }
      `;

      document.head.appendChild(style);
    }

    toastEl = document.createElement('div');
    toastEl.className = 'olw-voice-toast';

    (document.getElementById('stage') || document.body)
      .appendChild(toastEl);
  }

  function toast(message, status = 'ok') {
    ensureToast();

    toastEl.textContent = '🎙 ' + message;

    toastEl.className =
      'olw-voice-toast' +
      (status === 'error'
        ? ' err'
        : status === 'heard'
          ? ' heard'
          : '');

    toastEl.style.opacity = '1';

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.style.opacity = '0';
    }, 1100);
  }

  /* ------------------------------------------------------------------------
     COMMAND MATCHING
     ------------------------------------------------------------------------ */

  function commandCanRun(id) {
    const now = performance.now();

    if (
      id === lastCommandId &&
      now - lastCommandAt < COMMAND_COOLDOWN
    ) {
      return false;
    }

    return true;
  }

  function markCommand(id) {
    lastCommandId = id;
    lastCommandAt = performance.now();
  }

  function handleTranscript(transcript, isFinal = false) {
    const text = normalise(transcript);

    if (!text) return false;

    for (const command of VOICE_COMMANDS) {
      if (!command.re.test(text)) continue;

      if (!commandCanRun(command.id)) {
        return true;
      }

      /*
        IMPORTANT:
        reserve the command immediately.

        Otherwise several interim results arriving in one browser callback can
        activate Dragon / Beast / Supply multiple times.
      */
      markCommand(command.id);

      let result = false;

      try {
        result = command.act();
      } catch (error) {
        console.warn(
          '[Voice] command failed:',
          command.id,
          error
        );

        result = false;
      }

      if (result === false) {
        toast(command.label + ' unavailable', 'error');
      } else {
        toast(command.label, 'ok');
      }

      return true;
    }

    /*
      Only show unmatched FINAL speech.
      Showing every interim fragment would flicker constantly.
    */
    if (isFinal && text.length > 2) {
      // Useful during testing; remove this line later if you want silence.
      // toast('Command not recognised', 'heard');
    }

    return false;
  }

  /* ------------------------------------------------------------------------
     SPEECH RECOGNITION
     ------------------------------------------------------------------------ */

  function installGrammar(rec) {
    if (!SpeechGrammarList) return;

    try {
      const words = [
        'dragon',
        'dracarys',
        'war beast',
        'backup team',
        'weapon supply',
        'supply',
        'signal volley',
        'sidearm',
        'repeater',
        'scattergun',
        'shotgun',
        'siege cannon',
        'mortar',
        'tesla coil'
      ];

      const grammar =
        '#JSGF V1.0; grammar commands; public <command> = ' +
        words.join(' | ') +
        ' ;';

      const list = new SpeechGrammarList();
      list.addFromString(grammar, 1);

      rec.grammars = list;
    } catch (error) {
      // Grammar hints are optional and unsupported in some implementations.
    }
  }

  function ensureRecognition() {
    if (recognition || !SpeechRecognition) {
      return recognition;
    }

    recognition = new SpeechRecognition();

    /*
      THIS is the key latency fix.

      Old:
        interimResults = false
        => wait for browser to decide the sentence is complete.

      New:
        interimResults = true
        => react as soon as "dragon", "mortar", etc. appears.
    */
    recognition.interimResults = true;

    recognition.continuous = true;

    /*
      We only need the best candidate.
      Asking for many alternatives can add work and does not help these simple
      VOICE_COMMANDS very much.
    */
    recognition.maxAlternatives = 1;

    recognition.lang = 'en-US';

    installGrammar(recognition);

    recognition.onstart = () => {
      starting = false;
      running = true;
    };

    recognition.onaudiostart = () => {
      // Browser microphone stream is actually alive.
    };

    recognition.onresult = (event) => {
      /*
        Work newest → oldest.

        Newest partial result is normally the one containing the command we
        want, e.g.

        "war"
        "war beast"

        so we don't need to concatenate a long conversation transcript.
      */
      for (
        let i = event.results.length - 1;
        i >= event.resultIndex;
        i -= 1
      ) {
        const result = event.results[i];

        if (!result || !result[0]) continue;

        const transcript = result[0].transcript || '';

        if (
          handleTranscript(
            transcript,
            result.isFinal
          )
        ) {
          break;
        }
      }
    };

    recognition.onerror = (event) => {
      running = false;
      starting = false;

      const error = event?.error || '';

      if (
        error === 'not-allowed' ||
        error === 'service-not-allowed'
      ) {
        wantOn = false;

        toast(
          'Microphone permission blocked',
          'error'
        );

        if (
          OLW.Settings &&
          typeof OLW.Settings.set === 'function'
        ) {
          OLW.Settings.set(
            'voiceHelp',
            false
          );
        }

        return;
      }

      /*
        "no-speech", "aborted" and temporary network recognition errors should
        NOT permanently turn voice off. Chrome frequently emits these during
        continuous recognition.
      */
      scheduleRestart(180);
    };

    recognition.onend = () => {
      running = false;
      starting = false;

      if (wantOn) {
        scheduleRestart(120);
      }
    };

    return recognition;
  }

  function scheduleRestart(delay = 120) {
    clearTimeout(restartTimer);

    if (!wantOn) return;

    restartTimer = setTimeout(() => {
      start();
    }, delay);
  }

  function start() {
    if (
      !SpeechRecognition ||
      !wantOn ||
      running ||
      starting
    ) {
      return;
    }

    const rec = ensureRecognition();

    if (!rec) return;

    starting = true;

    try {
      rec.start();
    } catch (error) {
      /*
        Chrome throws InvalidStateError when start() is requested while its
        internal recognizer is still closing. Retry shortly instead of giving
        up until the next 500ms polling cycle.
      */
      starting = false;
      scheduleRestart(150);
    }
  }

  function stop() {
    wantOn = false;

    clearTimeout(restartTimer);
    restartTimer = null;

    if (!recognition) {
      running = false;
      starting = false;
      return;
    }

    try {
      recognition.abort();
    } catch (error) {
      try {
        recognition.stop();
      } catch (_) {}
    }

    running = false;
    starting = false;
  }

  function evaluate() {
    const enabled =
      !!(
        OLW.Settings &&
        typeof OLW.Settings.get === 'function' &&
        OLW.Settings.get('voiceHelp')
      );

    const g = game();

    const playing =
      !!(
        g &&
        g.state === 'playing'
      );

    const shouldRun =
      !!(
        SpeechRecognition &&
        enabled &&
        playing &&
        !document.hidden
      );

    if (shouldRun === wantOn) {
      if (shouldRun && !running && !starting) {
        start();
      }

      return;
    }

    wantOn = shouldRun;

    if (wantOn) {
      start();
    } else {
      stop();
    }
  }

  /* ------------------------------------------------------------------------
     EVENTS

     Keep the slower polling only as a fallback. The main triggers below make
     state changes effectively immediate.
     ------------------------------------------------------------------------ */

  window.addEventListener(
    'olw:profilesync',
    evaluate
  );

  window.addEventListener(
    'olw:voice-evaluate',
    evaluate
  );

  document.addEventListener(
    'visibilitychange',
    evaluate
  );

  window.addEventListener(
    'focus',
    evaluate
  );

  window.addEventListener(
    'blur',
    evaluate
  );

  // Fallback only — no longer the primary start mechanism.
  setInterval(evaluate, 1200);

  let guideOverlay = null;

function escapeVoiceHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function ensureGuideCss() {
  if (document.getElementById('voice-guide-css')) return;

  const style = document.createElement('style');
  style.id = 'voice-guide-css';

  style.textContent = `
    .voice-guide-overlay {
      position: absolute;
      inset: 0;
      z-index: 96;

      display: grid;
      place-items: center;

      padding: clamp(8px, 2vmin, 22px);

      background: rgba(3,5,8,.90);
      backdrop-filter: blur(9px);
    }

    .voice-guide-panel {
      position: relative;

      width: min(820px, 95vw);
      max-height: min(760px, 94dvh);

      display: flex;
      flex-direction: column;

      overflow: hidden;

      padding: clamp(18px, 3vmin, 30px);

      color: #e9dfcb;

      border: 1px solid rgba(232,161,58,.20);
      border-radius: 7px;

      background:
        linear-gradient(
          155deg,
          rgba(32,32,30,.97),
          rgba(8,10,14,.995)
        );

      box-shadow:
        0 30px 100px rgba(0,0,0,.75);
    }

    .voice-guide-head {
      flex: none;
      padding-right: 48px;
    }

    .voice-guide-head h2 {
      margin: 4px 0;

      font-family: Georgia, serif;
      font-size: clamp(27px, 4vmin, 42px);
    }

    .voice-guide-head p {
      margin: 0;

      color: #9e988b;
      font-size: 12px;
      line-height: 1.5;
    }

    .voice-guide-list {
      flex: 1 1 auto;
      min-height: 0;

      overflow-y: auto;

      display: grid;
      grid-template-columns: repeat(2, minmax(0,1fr));

      gap: 8px;

      margin-top: 18px;
      padding-right: 4px;
    }

    .voice-guide-card {
      padding: 13px;

      border: 1px solid rgba(255,255,255,.07);

      background:
        linear-gradient(
          145deg,
          rgba(255,255,255,.04),
          rgba(255,255,255,.015)
        );
    }

    .voice-guide-category {
      display: block;

      color: #e8a13a;

      font-size: 8px;
      font-weight: 900;
      letter-spacing: 1.7px;

      text-transform: uppercase;
    }

    .voice-guide-card strong {
      display: block;

      margin-top: 3px;

      font-family: Georgia, serif;
      font-size: 17px;
    }

    .voice-guide-callout {
      display: inline-block;

      margin-top: 7px;
      padding: 3px 7px;

      color: #f5c36b;

      border: 1px solid rgba(245,195,107,.18);

      font-size: 9px;
      font-weight: 900;
      letter-spacing: 1px;
    }

    .voice-guide-phrases {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;

      margin-top: 9px;
    }

    .voice-phrase {
      padding: 4px 7px;

      color: #d1c8b7;
      background: rgba(0,0,0,.27);

      border: 1px solid rgba(255,255,255,.065);

      font-size: 10px;
    }

    .voice-guide-actions {
      flex: none;

      display: flex;
      justify-content: center;
      gap: 9px;

      padding-top: 15px;
    }

    .voice-guide-x {
      position: absolute;

      top: 12px;
      right: 12px;

      width: 34px;
      height: 34px;

      display: grid;
      place-items: center;

      color: #d4cbbb;

      cursor: pointer;

      border: 1px solid rgba(255,255,255,.10);
      background: rgba(7,9,12,.76);
    }

    @media (max-width: 640px) {
      .voice-guide-overlay {
        padding: 0;
      }

      .voice-guide-panel {
        width: 100vw;
        height: 100dvh;

        max-height: none;

        border: 0;
        border-radius: 0;

        padding: 50px 14px 14px;
      }

      .voice-guide-list {
        grid-template-columns: 1fr;
      }
    }

    @media (max-height: 520px) and (orientation: landscape) {
      .voice-guide-list {
        grid-template-columns: repeat(3, minmax(0,1fr));
      }

      .voice-guide-card {
        padding: 8px;
      }

      .voice-guide-card strong {
        font-size: 14px;
      }
    }
  `;

  document.head.appendChild(style);
}

function openGuide() {
  ensureGuideCss();

  if (!guideOverlay) {
    guideOverlay = document.createElement('div');
    guideOverlay.className = 'voice-guide-overlay hidden';

    guideOverlay.innerHTML = `
      <div class="voice-guide-panel">

        <button
          type="button"
          class="voice-guide-x"
          aria-label="Close voice command guide"
        >
          ✕
        </button>

        <div class="voice-guide-head">
          <span class="panel-kicker">
            WARDEN VOICE CODEX
          </span>

          <h2>
            Battle Commands
          </h2>

          <p>
            Voice Help controls equipment, weapons and the Signal Volley.
            Aim and firing remain manual.
          </p>
        </div>

        <div class="voice-guide-list">
          ${VOICE_COMMANDS.map((command) => `
            <div class="voice-guide-card">

              <span class="voice-guide-category">
                ${escapeVoiceHtml(command.category)}
              </span>

              <strong>
                ${escapeVoiceHtml(command.title)}
              </strong>

              ${
                command.callout
                  ? `
                    <span class="voice-guide-callout">
                      ${escapeVoiceHtml(command.callout)}
                    </span>
                  `
                  : ''
              }

              <div class="voice-guide-phrases">
                ${command.phrases.map((phrase) => `
                  <span class="voice-phrase">
                    “${escapeVoiceHtml(phrase)}”
                  </span>
                `).join('')}
              </div>

            </div>
          `).join('')}
        </div>

        <div class="voice-guide-actions">

          <button
            type="button"
            class="secondary-btn voice-guide-download"
          >
            Download Commands
          </button>

          <button
            type="button"
            class="primary-btn voice-guide-close"
          >
            Back to Outpost
          </button>

        </div>
      </div>
    `;

    (
      document.getElementById('stage') ||
      document.body
    ).appendChild(guideOverlay);

    guideOverlay
      .querySelector('.voice-guide-close')
      .addEventListener('click', closeGuide);

    guideOverlay
      .querySelector('.voice-guide-x')
      .addEventListener('click', closeGuide);

    guideOverlay
      .querySelector('.voice-guide-download')
      .addEventListener('click', downloadGuide);

    guideOverlay.addEventListener(
      'pointerdown',
      (event) => {
        if (event.target === guideOverlay) {
          closeGuide();
        }
      }
    );
  }

  guideOverlay.classList.remove('hidden');

  OLW.Music?.menu?.();
}

function closeGuide() {
  if (!guideOverlay) return;

  guideOverlay.classList.add('hidden');
}

function downloadGuide() {
  const sections = new Map();

  for (const command of VOICE_COMMANDS) {
    if (!sections.has(command.category)) {
      sections.set(command.category, []);
    }

    sections.get(command.category).push(command);
  }

  const lines = [
    'OUTPOST: LAST WATCH',
    'WARDEN VOICE CODEX',
    '===================',
    '',
    'Enable: Settings > Voice Help during game',
    'Voice commands control weapons, field equipment and Signal Volley.',
    'Aiming and firing remain manual.',
    ''
  ];

  for (const [category, commands] of sections) {
    lines.push(category.toUpperCase());
    lines.push('-'.repeat(category.length));

    for (const command of commands) {
      lines.push('');
      lines.push(command.title);

      if (command.callout) {
        lines.push(`Battle cry: ${command.callout}`);
      }

      lines.push(
        'Accepted phrases: ' +
        command.phrases.join(', ')
      );
    }

    lines.push('');
  }

  const blob = new Blob(
    [lines.join('\r\n')],
    {
      type: 'text/plain;charset=utf-8'
    }
  );

  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');

  link.href = url;
  link.download =
    'outpost-last-watch-voice-codex.txt';

  document.body.appendChild(link);

  link.click();
  link.remove();

  setTimeout(
    () => URL.revokeObjectURL(url),
    1000
  );
}

return {
  supported: !!SpeechRecognition,

  evaluate,

  command(text) {
    return handleTranscript(
      text,
      true
    );
  },

  start,
  stop,

  openGuide,
  closeGuide,
  downloadGuide,

  commands: VOICE_COMMANDS
};
})();