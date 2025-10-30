// Game configuration and state variables
// Difficulty presets — adjust goal, time, spawn speed (ms) and premium probability
const DIFFICULTY_PRESETS = {
  Easy: { goal: 12, time: 75, spawnMs: 1000, premiumProb: 0.08, hazardProb: 0.08 },
  Normal: { goal: 20, time: 60, spawnMs: 900, premiumProb: 0.12, hazardProb: 0.12 },
  Hard: { goal: 30, time: 45, spawnMs: 700, premiumProb: 0.18, hazardProb: 0.18 }
};
let selectedDifficulty = 'Normal';
let currentGoal = DIFFICULTY_PRESETS[selectedDifficulty].goal;
let currentSpawnMs = DIFFICULTY_PRESETS[selectedDifficulty].spawnMs;
let currentPremiumProb = DIFFICULTY_PRESETS[selectedDifficulty].premiumProb;
let currentCans = 0;         // Current number of items collected
let gameActive = false;      // Tracks if game is currently running
let spawnInterval;          // Holds the interval for spawning items
let countdownInterval;      // Holds the countdown timer interval
let timeLeft = 60;          // default time for the round (seconds)
const STORAGE_KEY = 'waterQuest_total_dollars';
let totalDollars = 0; // persisted all-time dollars
let sessionDollars = 0; // dollars in current session
let currentHazardProb = 0.06; // probability a spawned item is a hazard (set per-difficulty)
// threshold for how many dollars = 1 person helped
const PEOPLE_THRESHOLD = 40;
// unit used for the all-time milestone visual (e.g. show progress toward next $100)
const ALLTIME_MILESTONE_UNIT = 100;
// storage key for all-time people helped (derived from totalDollars but persisted for convenience)
const STORAGE_PEOPLE_KEY = 'waterQuest_people_helped';
let peopleHelpedAllTime = 0;
// storage keys for session-persisted values (so session state survives reloads)
const STORAGE_SESSION_DOLLARS_KEY = 'waterQuest_session_dollars';
const STORAGE_SESSION_PEOPLE_KEY = 'waterQuest_session_people';
let peopleHelpedSession = 0;
// SFX toggle persistence
const STORAGE_SFX_KEY = 'waterQuest_sfx_enabled';
let sfxEnabled = true;
try {
  const _raw = localStorage.getItem(STORAGE_SFX_KEY);
  if (_raw !== null) sfxEnabled = (_raw === 'true');
} catch (e) {}
// accessibility: remember previous milestone state to avoid redundant announcements
let prevMilestonePercent = -1;
let prevAllTimePeopleHelped = -1;
// Milestone messages: percentage thresholds (of currentGoal) and messages
const MILESTONE_DEFS = [
  { pct: 0.25, msg: "Good start — keep going!" },
  { pct: 0.5,  msg: "Halfway there!" },
  { pct: 0.75, msg: "You're nearly there!" }
];
// Computed per-game numeric thresholds and a set to remember which have fired
let milestoneThresholds = [];
let seenMilestones = new Set();
// two can types: normal and premium
const CAN_TYPES = {
  normal: { src: 'img/water-can-transparent.png', value: 1 },
  premium: { src: 'img/water-can.png', value: 5 } // fallback to existing image for premium
};

// Hazard visual/value (negative effect)
const HAZARD = { value: 1 };

// Creates the 3x3 game grid where items will appear
function createGrid() {
  const grid = document.querySelector('.game-grid');
  grid.innerHTML = ''; // Clear any existing grid cells
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.className = 'grid-cell'; // Each cell represents a grid square
    // make cells focusable for keyboard users
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('role', 'button');
    cell.setAttribute('aria-label', `Game cell ${i + 1}`);
    grid.appendChild(cell);
  }
}

// Ensure the grid is created when the page loads
createGrid();

// Update the milestone/progress bar UI (session-based progress toward PEOPLE_THRESHOLD)
function updateMilestoneBar() {
  // Session milestone (prominent)
  const sFill = document.getElementById('session-milestone-fill');
  const sLabel = document.getElementById('session-milestone-label');
  if (sFill && sLabel) {
    const sd = Math.round(sessionDollars * 100) / 100;
    const sProgress = Math.min(1, (sessionDollars % PEOPLE_THRESHOLD) / PEOPLE_THRESHOLD);
    const sPercent = Math.round(sProgress * 100);
    sFill.style.width = sPercent + '%';
    sLabel.textContent = `Session: $${sd} / $${PEOPLE_THRESHOLD}`;
  }

  // All-time milestone (smaller) — shows progress toward next ALLTIME_MILESTONE_UNIT
  const aFill = document.getElementById('alltime-milestone-fill');
  const aLabel = document.getElementById('alltime-milestone-label');
  if (aFill && aLabel) {
    const td = Math.round(totalDollars * 100) / 100;
    const unit = ALLTIME_MILESTONE_UNIT;
    const aProgress = Math.min(1, (totalDollars % unit) / unit);
    const aPercent = Math.round(aProgress * 100);
    aFill.style.width = aPercent + '%';
    aLabel.textContent = `All-time: $${td} / $${unit}`;

    // announce all-time milestone changes to screen readers
    try {
      const announcer = document.getElementById('milestone-announcer');
      const newPeople = Math.floor(totalDollars / PEOPLE_THRESHOLD);
      if (announcer && (aPercent !== prevMilestonePercent || newPeople !== prevAllTimePeopleHelped)) {
        const pctText = aPercent + '%';
        const msg = `All-time progress: $${td} of $${unit} — ${pctText} toward the next milestone.` + (newPeople > prevAllTimePeopleHelped ? ` You've helped ${newPeople} people in total.` : '');
        announcer.textContent = msg;
        prevMilestonePercent = aPercent;
        prevAllTimePeopleHelped = newPeople;
      }
    } catch (e) {
      // ignore announcer errors
    }
  }
}

// load persisted total
function loadTotal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    totalDollars = raw ? parseInt(raw, 10) || 0 : 0;
  } catch (err) {
    totalDollars = 0;
  }
  const el = document.getElementById('total-dollars');
  if (el) el.textContent = totalDollars;
  // load persisted people helped if available, otherwise derive from total
  try {
    const rawPeople = localStorage.getItem(STORAGE_PEOPLE_KEY);
    if (rawPeople !== null) {
      peopleHelpedAllTime = parseInt(rawPeople, 10) || Math.floor(totalDollars / PEOPLE_THRESHOLD);
    } else {
      peopleHelpedAllTime = Math.floor(totalDollars / PEOPLE_THRESHOLD);
      try { localStorage.setItem(STORAGE_PEOPLE_KEY, String(peopleHelpedAllTime)); } catch (e) {}
    }
  } catch (e) {
    peopleHelpedAllTime = Math.floor(totalDollars / PEOPLE_THRESHOLD);
  }
  // load session-persisted dollars/people (if available) so a session survives reloads
  try {
  const rawSessD = sessionStorage.getItem(STORAGE_SESSION_DOLLARS_KEY);
    sessionDollars = rawSessD !== null ? parseFloat(rawSessD) || 0 : 0;
  const rawSessP = sessionStorage.getItem(STORAGE_SESSION_PEOPLE_KEY);
    peopleHelpedSession = rawSessP !== null ? parseInt(rawSessP, 10) || Math.floor(sessionDollars / PEOPLE_THRESHOLD) : Math.floor(sessionDollars / PEOPLE_THRESHOLD);
    // ensure session dollars storage exists (init)
  try { sessionStorage.setItem(STORAGE_SESSION_DOLLARS_KEY, String(sessionDollars)); } catch (e) {}
  try { sessionStorage.setItem(STORAGE_SESSION_PEOPLE_KEY, String(peopleHelpedSession)); } catch (e) {}
  } catch (e) {
    sessionDollars = 0; peopleHelpedSession = Math.floor(sessionDollars / PEOPLE_THRESHOLD);
  }
  // set UI values: session dollars and session people (badge)
  const badge = document.querySelector('.donation-badge'); if (badge) badge.textContent = peopleHelpedSession;
  const dollarsElSess = document.getElementById('dollars'); if (dollarsElSess) dollarsElSess.textContent = sessionDollars;
  // update milestone bar UI
  updateMilestoneBar();
}
loadTotal();

// no per-can selector — we use two can types (normal and premium)

// Spawns a new item in a random grid cell
function spawnWaterCan() {
  if (!gameActive) return; // Stop if the game is not active
  const cells = document.querySelectorAll('.grid-cell');
  
  // Clear all cells before spawning a new water can
  cells.forEach(cell => (cell.innerHTML = ''));

  // Select a random cell from the grid to place the water can
  const randomCell = cells[Math.floor(Math.random() * cells.length)];


  // choose can type (premium rarer)
  // decide whether to spawn a hazard instead of a can
  if (Math.random() < currentHazardProb) {
    // spawn a hazard (negative element)
    randomCell.innerHTML = `
      <div class="hazard-wrapper">
        <div class="hazard" role="button" aria-label="hazard">✖</div>
      </div>`;
  } else {
    const isPremium = Math.random() < currentPremiumProb;
    const type = isPremium ? CAN_TYPES.premium : CAN_TYPES.normal;
    randomCell.innerHTML = `
      <div class="water-can-wrapper">
        <img src="${type.src}" alt="water can" class="water-can ${isPremium ? 'premium' : 'normal'}" data-value="${type.value}" />
      </div>`;
    if (isPremium) {
      const badge = document.createElement('div');
      badge.className = 'premium-badge';
      badge.textContent = '$' + type.value;
      randomCell.appendChild(badge);
    }
  }

  // play an appropriate spawn sound: hazard vs water can
  if (randomCell.querySelector('.hazard')) {
    try { playSound('hazard'); } catch (e) {}
  } else {
    try { playSound('water-drop'); } catch (e) {}
  }
}

// Simple WebAudio manager for small sound cues
const audioCtx = (window.AudioContext || window.webkitAudioContext) ? new (window.AudioContext || window.webkitAudioContext)() : null;

// Cache for decoded audio buffers (so we don't repeatedly fetch/decode)
const audioBuffers = {};
// reference to the currently-playing water-drop source so we can stop it
let currentWaterDrop = null;
// reference to the last spawn sound (water-drop or hazard) to avoid overlap
let currentSpawnSound = null;

// Try to load and play a sample by URL. Resolves when playback starts.
function playSample(url) {
  if (!audioCtx) return Promise.reject(new Error('No AudioContext'));
  console.debug && console.debug('playSample: attempting', url);
  return new Promise((resolve, reject) => {
    const startBufferPlayback = (buf) => {
      try {
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        const g = audioCtx.createGain();
        // a reasonable default volume for samples
        g.gain.setValueAtTime(0.08, audioCtx.currentTime);
        src.connect(g);
        g.connect(audioCtx.destination);
        src.start();
        // expose a small wrapper so callers can stop or fade the playback
        const wrapper = {
          node: src,
          gain: g,
          duration: (buf.duration || 0),
          // immediate stop (with a very short fade to avoid clicks)
          stop: () => {
            try {
              g.gain.cancelScheduledValues(audioCtx.currentTime);
              g.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05);
              setTimeout(() => { try { src.stop(); } catch (e) {} }, 80);
            } catch (e) {}
          },
          // gentle fade over `dur` seconds then stop
          fade: (dur = 0.12) => {
            try {
              g.gain.cancelScheduledValues(audioCtx.currentTime);
              g.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + Math.max(0.03, dur));
              setTimeout(() => { try { src.stop(); } catch (e) {} }, (Math.max(0.03, dur) * 1000) + 40);
            } catch (e) {}
          },
          // placeholder hook that will be invoked when the source ends
          onended: null
        };
        // propagate underlying node's ended event to wrapper.onended
        src.onended = () => { try { if (typeof wrapper.onended === 'function') wrapper.onended(); } catch (e) {} };
        resolve(wrapper);
      } catch (err) {
        reject(err);
      }
    };

    if (audioBuffers[url]) {
      startBufferPlayback(audioBuffers[url]);
      return;
    }

    fetch(url).then(res => {
      if (!res.ok) {
        const err = new Error(`Sample not found (status ${res.status})`);
        console.warn('playSample:', url, err);
        throw err;
      }
      return res.arrayBuffer();
    }).then(ab => {
      // decodeAudioData may return a Promise or accept callbacks depending on browser
      const decode = audioCtx.decodeAudioData(ab);
      if (decode && typeof decode.then === 'function') {
        return decode;
      }
      // older spec with callbacks
      return new Promise((resDecode, rejDecode) => audioCtx.decodeAudioData(ab, resDecode, rejDecode));
    }).then(buf => {
      audioBuffers[url] = buf;
      startBufferPlayback(buf);
    }).catch(err => {
      console.warn('playSample failed for', url, err);
      reject(err);
    });
  });
}

// Fallback synth for water-drop when no sample is available
function playWaterDropSynth() {
  const now = audioCtx.currentTime;
  const dur = 0.18;
  // create a master gain so we can gracefully fade the whole synth
  const master = audioCtx.createGain();
  master.gain.setValueAtTime(1, now);
  master.connect(audioCtx.destination);

  // click (very short noise) for impact
  const clickBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.03, audioCtx.sampleRate);
  const data = clickBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const click = audioCtx.createBufferSource();
  click.buffer = clickBuf;
  const clickFilter = audioCtx.createBiquadFilter(); clickFilter.type = 'highpass'; clickFilter.frequency.setValueAtTime(900, now);
  const clickGain = audioCtx.createGain(); clickGain.gain.setValueAtTime(0.008, now); clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
  click.connect(clickFilter); clickFilter.connect(clickGain); clickGain.connect(master);
  click.start(now); click.stop(now + 0.04);

  // tone body
  const tone = audioCtx.createOscillator();
  tone.type = 'sine';
  tone.frequency.setValueAtTime(880, now);
  const toneG = audioCtx.createGain(); toneG.gain.setValueAtTime(0.02, now); toneG.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  tone.connect(toneG);

  // subtle delay to add body
  const delay = audioCtx.createDelay(0.2);
  delay.delayTime.setValueAtTime(0.03, now);
  const delayGain = audioCtx.createGain(); delayGain.gain.setValueAtTime(0.25, now);

  toneG.connect(master);
  toneG.connect(delay); delay.connect(delayGain); delayGain.connect(master);

  tone.start(now); tone.stop(now + dur);

  // return an object that allows stopping or fading the synth
  const wrapper = {
    stop: () => {
      try { click.stop(); } catch (e) {}
      try { tone.stop(); } catch (e) {}
      try { master.disconnect(); } catch (e) {}
    },
    fade: (fadeDur = 0.12) => {
      try {
        master.gain.cancelScheduledValues(audioCtx.currentTime);
        master.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + Math.max(0.03, fadeDur));
        setTimeout(() => { try { click.stop(); } catch (e) {}; try { tone.stop(); } catch (e) {}; }, (Math.max(0.03, fadeDur) * 1000) + 40);
      } catch (e) {}
    },
    duration: dur
  };

  return wrapper;
}
// Fallback synth for a hazard (negative) cue when no sample is available
function playHazardSynth() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const dur = 0.18;
  const master = audioCtx.createGain(); master.gain.setValueAtTime(0.9, now); master.connect(audioCtx.destination);

  // low detuned saw for a brief buzzy 'wrong' cue
  const o1 = audioCtx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.setValueAtTime(220, now);
  const o2 = audioCtx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.setValueAtTime(260, now);
  const mix = audioCtx.createGain(); mix.gain.setValueAtTime(0.0026, now);
  o1.connect(mix); o2.connect(mix);

  // lowpass to roll off harsh highs
  const lp = audioCtx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, now);
  mix.connect(lp); lp.connect(master);

  // slight amplitude envelope
  const g = audioCtx.createGain(); g.gain.setValueAtTime(0.0001, now);
  // connect mix through gain to master so envelope controls perceived volume
  mix.disconnect(); mix.connect(g); g.connect(lp);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.linearRampToValueAtTime(0.006, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  o1.start(now); o2.start(now);
  o1.stop(now + dur); o2.stop(now + dur);

  const wrapper = {
    stop: () => { try { o1.stop(); o2.stop(); } catch (e) {} },
    fade: (fadeDur = 0.06) => { try { master.gain.cancelScheduledValues(audioCtx.currentTime); master.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + fadeDur); } catch (e) {} },
    duration: dur
  };
  return wrapper;
}
function playSound(name) {
  if (!audioCtx) return;
  if (!sfxEnabled) return; // SFX globally disabled

  // Ensure the AudioContext is resumed (some browsers start it suspended until a user gesture)
  const runPlay = (playName) => {
    const now = audioCtx.currentTime;
    // removed legacy 'spawn' alias — use explicit 'water-drop' where needed
    // prevent overlapping spawn/hazard sounds by stopping the previous spawn wrapper
    if (playName === 'water-drop' || playName === 'hazard') {
      if (currentSpawnSound) {
        try {
          if (typeof currentSpawnSound.fade === 'function') currentSpawnSound.fade(0.08);
          else if (typeof currentSpawnSound.stop === 'function') currentSpawnSound.stop();
        } catch (e) { /* ignore */ }
      }
    }

    if (playName === 'water-drop') {
      // prefer a recorded sample if present, otherwise play the synth fallback
      playSample('sounds/water-drop-85731.mp3').then((obj) => {
        // store wrapper so we can fade/stop it later
        currentSpawnSound = obj;
        currentWaterDrop = obj;
        try { obj.onended = () => { if (currentSpawnSound === obj) currentSpawnSound = null; if (currentWaterDrop === obj) currentWaterDrop = null; }; } catch (e) {}
      }).catch(() => {
        // sample not available or failed to play — use synth fallback
        const synth = playWaterDropSynth();
        currentSpawnSound = synth;
        currentWaterDrop = synth;
        // clear reference after duration
        setTimeout(() => { if (currentSpawnSound === synth) currentSpawnSound = null; if (currentWaterDrop === synth) currentWaterDrop = null; }, (synth.duration || 0.22) * 1000);
      });
    }
    if (playName === 'victory') {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(1200, now);
      g.gain.setValueAtTime(0.06, now);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(now); o.stop(now + 0.22);
    }
    if (playName === 'water-drip-7') {
      // play the provided water drip sample (actual file present in repo)
      playSample('sounds/water-drip-7-39622.mp3').catch(() => {
        // fallback to synth if sample missing or fails
        playWaterDropSynth();
      });
    }
    if (playName === 'hazard') {
      // try a sample first (if you want to provide one at sounds/error-08-206492.mp3)
      playSample('sounds/error-08-206492.mp3').then((obj) => {
        currentSpawnSound = obj;
        try { obj.onended = () => { if (currentSpawnSound === obj) currentSpawnSound = null; }; } catch (e) {}
      }).catch(() => {
        // fallback to a short low 'buzz' synth indicating a negative hit
        const synth = playHazardSynth();
        currentSpawnSound = synth;
        setTimeout(() => { if (currentSpawnSound === synth) currentSpawnSound = null; }, (synth.duration || 0.22) * 1000);
      });
    }
    if (playName === 'collect') {
      // small bandpass noise + pitch glide (quick collect cue)
      try {
        const dur = 0.18;
        const noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.06, audioCtx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const noiseSrc = audioCtx.createBufferSource(); noiseSrc.buffer = noiseBuf;
        const bp = audioCtx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(1200, audioCtx.currentTime);
        const ng = audioCtx.createGain(); ng.gain.setValueAtTime(0.02, audioCtx.currentTime); ng.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
        noiseSrc.connect(bp); bp.connect(ng); ng.connect(audioCtx.destination);
        noiseSrc.start(); noiseSrc.stop(audioCtx.currentTime + dur);
      } catch (err) {
        console.warn('collect synth failed', err);
      }
    }
  };

  if (audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => runPlay(name)).catch((err) => {
      console.warn('AudioContext resume failed, attempting to play anyway', err);
      runPlay(name);
    });
  } else {
    runPlay(name);
  }
}

// Increment score and clear the current water can
function collectCan(target) {
  // Locate the wrapper and image but don't remove immediately so we can show animations
  // normalize target to the actual image element if possible
  let imgEl = target;
  if (!imgEl || !imgEl.classList || !imgEl.classList.contains('water-can')) {
    const byClosest = target.closest && target.closest('.water-can');
    imgEl = byClosest || (target.closest ? (target.closest('.grid-cell') ? target.closest('.grid-cell').querySelector('.water-can') : null) : null);
  }
  if (!imgEl) return; // nothing clickable
  const wrapper = imgEl.closest('.water-can-wrapper');
  const cell = imgEl.closest('.grid-cell');

  // increment collected cans and update display
  currentCans += 1;
  const currentEl = document.getElementById('current-cans');
  if (currentEl) currentEl.textContent = currentCans;

  // Check milestone messages (allow multiple milestones to fire if a single collect crosses several)
  try {
    const achiever = document.getElementById('achievements');
    const announcerEl = document.getElementById('announcer');
    for (let i = 0; i < milestoneThresholds.length; i++) {
      const thr = milestoneThresholds[i];
      if (thr <= 0) continue;
      if (currentCans >= thr && !seenMilestones.has(thr)) {
        seenMilestones.add(thr);
        const msg = (MILESTONE_DEFS[i] && MILESTONE_DEFS[i].msg) ? MILESTONE_DEFS[i].msg : `Milestone reached: ${thr}`;
        // announce to screen readers
        if (announcerEl) announcerEl.textContent = msg;
        // show a brief visual achievement toast (non-blocking)
        if (achiever) {
          const el = document.createElement('div');
          el.className = 'milestone-message';
          el.textContent = msg;
          // basic styling fallback if CSS not present
          el.style.background = 'rgba(46,157,247,0.95)';
          el.style.color = '#fff';
          el.style.padding = '8px 12px';
          el.style.borderRadius = '8px';
          el.style.fontWeight = '700';
          el.style.margin = '6px auto';
          el.style.textAlign = 'center';
          achiever.appendChild(el);
          setTimeout(() => { try { el.remove(); } catch (e) {} }, 1600);
        }
      }
    }
  } catch (e) { /* non-fatal */ }

  // determine clicked can's value (data-value on the image)
  // determine clicked can's value (prefer dataset)
  const rawVal = (imgEl.dataset && imgEl.dataset.value) || imgEl.getAttribute && imgEl.getAttribute('data-value');
  const clickedValue = Number(rawVal) || 1;

  // update session dollars and UI
  sessionDollars = Math.round((sessionDollars + clickedValue) * 100) / 100;
  const dollarsEl = document.getElementById('dollars');
  if (dollarsEl) dollarsEl.textContent = sessionDollars;

  // persist to all-time total using clicked value
  const addValue = clickedValue || 1;
  totalDollars += addValue;
  totalDollars = Math.round(totalDollars * 100) / 100;
  try { localStorage.setItem(STORAGE_KEY, String(totalDollars)); } catch (err) {}
  const totalEl = document.getElementById('total-dollars');
  if (totalEl) totalEl.textContent = totalDollars;

  // recompute all-time people helped based on updated total and persist
  // update session-persisted people helped based on sessionDollars and persist
  try {
    const prevSess = peopleHelpedSession || 0;
    const newSess = Math.floor(sessionDollars / PEOPLE_THRESHOLD);
    const badge = document.querySelector('.donation-badge');
    if (newSess > prevSess) {
      const delta = newSess - prevSess;
      const start = prevSess;
      // persist the new session values
      peopleHelpedSession = newSess;
  try { sessionStorage.setItem(STORAGE_SESSION_PEOPLE_KEY, String(peopleHelpedSession)); } catch (e) {}
  try { sessionStorage.setItem(STORAGE_SESSION_DOLLARS_KEY, String(sessionDollars)); } catch (e) {}
      if (badge) {
        for (let i = 1; i <= delta; i++) {
          setTimeout(() => {
            const val = start + i;
            badge.textContent = val;
            badge.classList.remove('pop');
            void badge.offsetWidth;
            badge.classList.add('pop');
          }, i * 160);
        }
      }
    } else {
      // keep badge showing current session value
      peopleHelpedSession = newSess;
  try { sessionStorage.setItem(STORAGE_SESSION_PEOPLE_KEY, String(peopleHelpedSession)); } catch (e) {}
  try { sessionStorage.setItem(STORAGE_SESSION_DOLLARS_KEY, String(sessionDollars)); } catch (e) {}
      if (badge) badge.textContent = peopleHelpedSession;
    }
  } catch (e) {}

  // refresh milestone bar (session progress)
  try { updateMilestoneBar(); } catch (e) {}

  // announce to screen readers
  const announcer = document.getElementById('announcer');
  if (announcer) announcer.textContent = `Collected! Score ${currentCans}`;

  // play requested click sound
  playSound('water-drip-7');

  // show a brief +1 float animation and splash/pop visuals
  if (cell) {
    const plus = document.createElement('div');
    plus.className = 'float-plus';
    plus.textContent = '+1';
    cell.appendChild(plus);

    // visual pop: add pop class to image inside wrapper (if present)
    const img = wrapper ? wrapper.querySelector('.water-can') : cell.querySelector('.water-can');
    if (img) {
      img.classList.add('pop');
      setTimeout(() => img.classList.remove('pop'), 260);
    }

    // splash effect
      // create both a gradient splash and a crisp SVG ripple
      const splash = document.createElement('div');
      splash.className = 'splash';
      cell.appendChild(splash);

      const ripple = document.createElement('div');
      ripple.className = 'ripple-svg';
      ripple.innerHTML = `
        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle class="ripple-circle" cx="50" cy="50" r="18" />
        </svg>`;
      cell.appendChild(ripple);

  // try to play a recorded splash file if present, otherwise fallback to the water-drip-7 sound
  playRecordedSplash().catch(() => playSound('water-drip-7'));

    // cleanup after animations complete
    setTimeout(() => {
      plus.remove();
      splash.remove();
      ripple.remove();
      if (wrapper) wrapper.remove();
    }, 760);
  }

  // If we've reached the goal, show victory
  if (currentCans >= currentGoal) {
    showVictory();
  }
}

// Handle when a hazard is clicked — reduce score/dollars
function hitHazard(target) {
  let el = target;
  if (!el || !el.classList || !el.classList.contains('hazard')) {
    el = target.closest && target.closest('.hazard');
  }
  if (!el) return;
  const cell = el.closest('.grid-cell');

  // decrement collected cans (but don't go below zero)
  currentCans = Math.max(0, currentCans - 1);
  const currentEl = document.getElementById('current-cans'); if (currentEl) currentEl.textContent = currentCans;

  // decrement session dollars by hazard value and persist
  sessionDollars = Math.max(0, Math.round((sessionDollars - HAZARD.value) * 100) / 100);
  const dollarsEl = document.getElementById('dollars'); if (dollarsEl) dollarsEl.textContent = sessionDollars;
  try { sessionStorage.setItem(STORAGE_SESSION_DOLLARS_KEY, String(sessionDollars)); } catch (e) {}

  // recompute session people helped and update badge (no pop animation for removal)
  try {
    const newSess = Math.floor(sessionDollars / PEOPLE_THRESHOLD);
    peopleHelpedSession = newSess;
    try { sessionStorage.setItem(STORAGE_SESSION_PEOPLE_KEY, String(peopleHelpedSession)); } catch (e) {}
    const badge = document.querySelector('.donation-badge'); if (badge) badge.textContent = peopleHelpedSession;
  } catch (e) {}

  // show negative float and subtle visual cue
  if (cell) {
    const minus = document.createElement('div');
    minus.className = 'float-plus';
    minus.style.color = '#F54E4E';
    minus.textContent = '-1';
    cell.appendChild(minus);
    // add a brief hazard flash
    el.classList.add('hit');
    setTimeout(() => { try { el.classList.remove('hit'); } catch (e) {} }, 380);
    setTimeout(() => { try { minus.remove(); } catch (e) {} }, 720);
  }

  // update milestone UI after penalty
  try { updateMilestoneBar(); } catch (e) {}

  // play an optional negative cue (reusing collect synth as fallback)
  try { playSound('hazard'); } catch (e) {}

  // remove hazard element after effect
  try { const wrapper = el.closest('.hazard-wrapper'); if (wrapper) wrapper.remove(); } catch (e) {}
}

// animate and update donation badge
function updateBadge(value) {
  const badge = document.querySelector('.donation-badge');
  if (!badge) return;
  // update text
  badge.textContent = value;
  // trigger animation
  badge.classList.remove('pop');
  // force reflow
  void badge.offsetWidth;
  badge.classList.add('pop');
}

// Start the countdown timer
// Start the countdown timer (optional initialTime overrides current timeLeft)
function startTimer(initialTime) {
  timeLeft = (typeof initialTime === 'number') ? initialTime : timeLeft;
  document.getElementById('timer').textContent = timeLeft;
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    timeLeft -= 1;
    document.getElementById('timer').textContent = timeLeft;
    if (timeLeft <= 0) {
      endGame();
      // show victory if any cans collected (or just show end state)
      showVictory();
    }
  }, 1000);
}

// Initializes and starts a new game
function startGame() {
  if (gameActive) return; // Prevent starting a new game if one is already active
  // read selected difficulty and apply presets
  const sel = document.getElementById('difficulty-select');
  selectedDifficulty = sel ? sel.value : selectedDifficulty;
  const preset = DIFFICULTY_PRESETS[selectedDifficulty] || DIFFICULTY_PRESETS.Normal;
  currentGoal = preset.goal;
  currentSpawnMs = preset.spawnMs;
  currentPremiumProb = preset.premiumProb;
  currentHazardProb = typeof preset.hazardProb === 'number' ? preset.hazardProb : currentHazardProb;
  timeLeft = preset.time;

  // compute numeric milestone thresholds for this game's goal and reset seen flags
  milestoneThresholds = MILESTONE_DEFS.map(d => Math.max(1, Math.floor(currentGoal * d.pct)));
  seenMilestones = new Set();

  gameActive = true;
  createGrid(); // Set up the game grid
  // disable difficulty selector during an active game
  const ds = document.getElementById('difficulty-select'); if (ds) ds.disabled = true;
  clearInterval(spawnInterval);
  spawnInterval = setInterval(spawnWaterCan, currentSpawnMs);
  startTimer(timeLeft);
  // Update CTA to indicate running state
  const btn = document.getElementById('start-game');
  if (btn) btn.textContent = 'Keep going!';
}

function endGame() {
  gameActive = false; // Mark the game as inactive
  // re-enable difficulty selector when the game ends
  const ds = document.getElementById('difficulty-select'); if (ds) ds.disabled = false;
  clearInterval(spawnInterval); // Stop spawning water cans
  clearInterval(countdownInterval);
  // Change CTA to allow restart
  const btn = document.getElementById('start-game');
  if (btn) btn.textContent = 'Play again';
}

// Pause / Resume / Restart helpers
let paused = false;
let remainingTimeWhenPaused = null;

function pauseGame() {
  if (!gameActive || paused) return;
  paused = true;
  // stop spawning and timer
  clearInterval(spawnInterval);
  clearInterval(countdownInterval);
  // compute remaining time
  const tEl = document.getElementById('timer');
  remainingTimeWhenPaused = tEl ? parseInt(tEl.textContent, 10) : timeLeft;
  // update UI
  const pBtn = document.getElementById('pause-game');
  if (pBtn) { pBtn.textContent = 'Resume'; pBtn.setAttribute('aria-pressed', 'true'); }

  // dim the grid and show overlay
  const grid = document.querySelector('.game-grid');
  if (grid) grid.classList.add('dimmed');
  const overlay = document.getElementById('pause-overlay');
  if (overlay) overlay.setAttribute('aria-hidden', 'false');

  // gently fade any currently-playing water-drop audio
  try {
    if (currentWaterDrop) {
      if (typeof currentWaterDrop.fade === 'function') currentWaterDrop.fade(0.12);
      else if (typeof currentWaterDrop.stop === 'function') currentWaterDrop.stop();
      // don't clear the ref immediately; let the wrapper clear itself on ended or after duration
    }
    // also fade/stop any spawn/hazard sound reference
    if (currentSpawnSound && currentSpawnSound !== currentWaterDrop) {
      if (typeof currentSpawnSound.fade === 'function') currentSpawnSound.fade(0.12);
      else if (typeof currentSpawnSound.stop === 'function') currentSpawnSound.stop();
    }
  } catch (e) {}
}

function resumeGame() {
  if (!gameActive || !paused) return;
  paused = false;
  // restore timer
  timeLeft = (remainingTimeWhenPaused != null) ? remainingTimeWhenPaused : timeLeft;
  const tEl = document.getElementById('timer');
  if (tEl) tEl.textContent = timeLeft;
  // restart intervals
  spawnInterval = setInterval(spawnWaterCan, currentSpawnMs);
  countdownInterval = setInterval(() => {
    timeLeft -= 1;
    const te = document.getElementById('timer'); if (te) te.textContent = timeLeft;
    if (timeLeft <= 0) { endGame(); showVictory(); }
  }, 1000);
  const pBtn = document.getElementById('pause-game');
  if (pBtn) { pBtn.textContent = 'Pause'; pBtn.setAttribute('aria-pressed', 'false'); }

  // remove dimming and hide overlay
  const grid = document.querySelector('.game-grid');
  if (grid) grid.classList.remove('dimmed');
  const overlay = document.getElementById('pause-overlay');
  if (overlay) overlay.setAttribute('aria-hidden', 'true');
}

function restartGame() {
  // reset session but keep totalDollars persisted
  // stop any running intervals
  clearInterval(spawnInterval); clearInterval(countdownInterval);
  paused = false;
  gameActive = false;
  // reset session state
  currentCans = 0; sessionDollars = 0; remainingTimeWhenPaused = null;
  // update UI
  const currentEl = document.getElementById('current-cans'); if (currentEl) currentEl.textContent = currentCans;
  const dollarsEl = document.getElementById('dollars'); if (dollarsEl) dollarsEl.textContent = sessionDollars;
  const timerEl = document.getElementById('timer'); if (timerEl) timerEl.textContent = timeLeft;
  updateBadge(0);
  // start fresh
  startGame();
}

// Victory modal handlers
function showVictory() {
  // stop the game and show modal
  endGame();
  const modal = document.getElementById('victory-modal');
  if (!modal) return;
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('final-count').textContent = currentCans;
  document.getElementById('final-dollars').textContent = document.getElementById('dollars').textContent || '0';
  playSound('victory');
}

function hideVictory() {
  const modal = document.getElementById('victory-modal');
  if (!modal) return;
  modal.setAttribute('aria-hidden', 'true');
}

// Restart/reset game
function resetGame() {
  currentCans = 0;
  document.getElementById('current-cans').textContent = currentCans;
  // reset session-persisted values (badge shows session people helped)
  sessionDollars = 0;
  peopleHelpedSession = 0;
  try { sessionStorage.removeItem(STORAGE_SESSION_DOLLARS_KEY); } catch (e) {}
  try { sessionStorage.removeItem(STORAGE_SESSION_PEOPLE_KEY); } catch (e) {}
  updateBadge(0);
  document.getElementById('dollars').textContent = '0';
  try { updateMilestoneBar(); } catch (e) {}
  document.getElementById('timer').textContent = '60';
  hideVictory();
}


// Set up click handler for the start button
document.getElementById('start-game').addEventListener('click', () => {
  // If game is active, do nothing. If not active and we have counts, reset then start.
  if (!gameActive) {
    resetGame();
    startGame();
  }
});

// pause button
const pauseBtn = document.getElementById('pause-game');
if (pauseBtn) {
  pauseBtn.addEventListener('click', () => {
    if (!gameActive) return;
    if (!paused) pauseGame(); else resumeGame();
  });
}

// restart button
const restartBtn = document.getElementById('restart-game');
if (restartBtn) {
  restartBtn.addEventListener('click', () => {
    restartGame();
  });
}

// Delegate clicks inside the grid to handle collecting cans
document.querySelector('.game-grid').addEventListener('click', (e) => {
  if (!gameActive || paused) return;
  const can = e.target.closest('.water-can');
  if (can) { collectCan(can); return; }
  const hazard = e.target.closest('.hazard');
  if (hazard) { hitHazard(hazard); return; }
});

// modal restart button
const modalRestart = document.getElementById('modal-restart');
if (modalRestart) modalRestart.addEventListener('click', () => {
  hideVictory();
  resetGame();
  startGame();
});

// Difficulty info modal wiring
const diffInfoBtn = document.getElementById('difficulty-info');
const diffModal = document.getElementById('difficulty-modal');
const diffClose = document.getElementById('difficulty-close');
if (diffInfoBtn && diffModal) {
  diffInfoBtn.addEventListener('click', () => {
    diffModal.setAttribute('aria-hidden', 'false');
  });
}
if (diffClose && diffModal) {
  diffClose.addEventListener('click', () => {
    diffModal.setAttribute('aria-hidden', 'true');
  });
}
// close with ESC
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (diffModal && diffModal.getAttribute('aria-hidden') === 'false') diffModal.setAttribute('aria-hidden', 'true');
  }
});

/* --- Custom difficulty dropdown: replace native select visually while keeping it for
      script compatibility and a11y. The custom control shows options and a description
      block beneath it. */
function initCustomDifficulty() {
  const native = document.getElementById('difficulty-select');
  const container = document.getElementById('custom-difficulty-container');
  if (!native || !container) return;

  // Build wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select';
  wrapper.setAttribute('role', 'combobox');
  wrapper.setAttribute('aria-haspopup', 'listbox');
  wrapper.setAttribute('aria-expanded', 'false');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'custom-select-button';
  btn.id = 'custom-difficulty-button';
  btn.setAttribute('aria-labelledby', 'custom-difficulty-button');
  btn.textContent = native.value || native.options[native.selectedIndex].text || 'Normal';
  const caret = document.createElement('span'); caret.className = 'caret'; caret.textContent = ' ▾';
  btn.appendChild(caret);
  wrapper.appendChild(btn);

  const list = document.createElement('div');
  list.className = 'custom-options';
  list.setAttribute('role', 'listbox');

  // create options from native select
  Array.from(native.options).forEach((opt) => {
    const item = document.createElement('div');
    item.className = 'custom-option';
    item.setAttribute('role', 'option');
    item.setAttribute('data-value', opt.value);
    item.textContent = opt.textContent;
    if (opt.selected) item.setAttribute('aria-selected', 'true'); else item.setAttribute('aria-selected', 'false');
    item.addEventListener('click', () => {
      // update native select and fire change
      native.value = opt.value;
      const ev = new Event('change', { bubbles: true });
      native.dispatchEvent(ev);
      // update visuals
      btn.firstChild && (btn.firstChild.textContent = '');
      btn.childNodes[0].nodeValue = opt.textContent; // set primary text
      Array.from(list.querySelectorAll('.custom-option')).forEach(o => o.setAttribute('aria-selected', 'false'));
      item.setAttribute('aria-selected', 'true');
      hideCustom();
    }, { passive: true });
    list.appendChild(item);
  });

  wrapper.appendChild(list);

  // (no inline description block — keep the modal content in `#difficulty-modal` only)

  container.appendChild(wrapper);

  // open/close helpers
  function showCustom() { wrapper.classList.add('open'); wrapper.setAttribute('aria-expanded', 'true'); }
  function hideCustom() { wrapper.classList.remove('open'); wrapper.setAttribute('aria-expanded', 'false'); }
  function toggleCustom() { wrapper.classList.contains('open') ? hideCustom() : showCustom(); }

  // wire button
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggleCustom(); });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); showCustom(); const first = list.querySelector('[role="option"]'); if (first) first.focus(); }
    if (e.key === 'Escape') hideCustom();
  });

  // close on outside click
  document.addEventListener('pointerdown', (ev) => {
    if (!wrapper.contains(ev.target)) hideCustom();
  });

  // keyboard navigation within options
  list.addEventListener('keydown', (e) => {
    const items = Array.from(list.querySelectorAll('[role="option"]'));
    const idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); const next = items[Math.min(items.length - 1, Math.max(0, idx + 1))]; if (next) next.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); const prev = items[Math.max(0, idx - 1)]; if (prev) prev.focus(); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); document.activeElement.click(); }
    if (e.key === 'Escape') { e.preventDefault(); hideCustom(); btn.focus(); }
  });

  // expose hide for internal usage
  function hideCustomImmediate() { hideCustom(); }
  // attach to global so other code can call if needed
  window.hideCustomDifficulty = hideCustomImmediate;
}

// initialize once DOM is ready (script is at page bottom, safe to call)
try { initCustomDifficulty(); } catch (e) { /* non-fatal */ }

// Difficulty selector change: adjust presets (and adapt running game timing)
const diffSelect = document.getElementById('difficulty-select');
if (diffSelect) {
  diffSelect.addEventListener('change', (e) => {
    // prevent changing difficulty while a game is in progress
    if (gameActive) {
      // revert selection to the active difficulty
      e.target.value = selectedDifficulty;
      return;
    }
    const newVal = e.target.value;
    const oldPreset = DIFFICULTY_PRESETS[selectedDifficulty] || DIFFICULTY_PRESETS.Normal;
    const newPreset = DIFFICULTY_PRESETS[newVal] || DIFFICULTY_PRESETS.Normal;
    // update selected and current settings
    selectedDifficulty = newVal;
    currentGoal = newPreset.goal;
    currentPremiumProb = newPreset.premiumProb;

    // adjust spawn cadence immediately
    currentSpawnMs = newPreset.spawnMs;
    if (spawnInterval) {
      clearInterval(spawnInterval);
      spawnInterval = setInterval(spawnWaterCan, currentSpawnMs);
    }

    // When difficulty changes, reset the remaining time to the preset time
    if (gameActive) {
      if (paused) {
        // if paused, update the stored paused remaining time to the new preset
        remainingTimeWhenPaused = newPreset.time;
      } else {
        // actively running: set timeLeft to new preset and restart countdown
        timeLeft = newPreset.time;
        const tEl = document.getElementById('timer'); if (tEl) tEl.textContent = timeLeft;
        clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
          timeLeft -= 1;
          const te = document.getElementById('timer'); if (te) te.textContent = timeLeft;
          if (timeLeft <= 0) { endGame(); showVictory(); }
        }, 1000);
      }
    } else {
      // if game not active, set the displayed timer to the preset for clarity
      timeLeft = newPreset.time;
      const tEl = document.getElementById('timer'); if (tEl) tEl.textContent = timeLeft;
    }
  });
}

// keyboard accessibility: allow Enter/Space to collect when focused on a cell
document.addEventListener('keydown', (e) => {
  if (!gameActive || paused) return;
  if (e.key === 'Enter' || e.key === ' ') {
    const active = document.activeElement;
    if (active && active.classList.contains('grid-cell')) {
      const can = active.querySelector('.water-can');
      if (can) { collectCan(can); return; }
      const hazard = active.querySelector('.hazard');
      if (hazard) { hitHazard(hazard); return; }
    }
  }
});


// reset total button handler
const resetBtn = document.getElementById('reset-total');
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    try { localStorage.removeItem(STORAGE_KEY); totalDollars = 0; } catch (err) {}
    const totalEl = document.getElementById('total-dollars');
    if (totalEl) totalEl.textContent = totalDollars;
  });
}

// SFX toggle button wiring
const sfxBtn = document.getElementById('sfx-toggle');
function updateSfxButton() {
  if (!sfxBtn) return;
  sfxBtn.setAttribute('aria-pressed', sfxEnabled ? 'true' : 'false');
  // update only the label so we don't clobber the icon element
  const lbl = sfxBtn.querySelector('.sfx-label');
  if (lbl) lbl.textContent = sfxEnabled ? 'SFX On' : 'SFX Off';
  // visual state classes for animation
  if (sfxEnabled) {
    sfxBtn.classList.remove('btn-outline-secondary');
    sfxBtn.classList.add('btn-primary');
    sfxBtn.classList.add('sfx-on');
    sfxBtn.classList.remove('sfx-off');
  } else {
    sfxBtn.classList.remove('btn-primary');
    sfxBtn.classList.add('btn-outline-secondary');
    sfxBtn.classList.add('sfx-off');
    sfxBtn.classList.remove('sfx-on');
  }
}

function setSfxEnabled(enabled) {
  sfxEnabled = !!enabled;
  try { localStorage.setItem(STORAGE_SFX_KEY, String(sfxEnabled)); } catch (e) {}
  updateSfxButton();
  // fade/stop any playing sounds when turning off
  if (!sfxEnabled) {
    try {
      if (currentWaterDrop) {
        if (typeof currentWaterDrop.fade === 'function') currentWaterDrop.fade(0.06);
        else if (typeof currentWaterDrop.stop === 'function') currentWaterDrop.stop();
      }
      if (currentSpawnSound && currentSpawnSound !== currentWaterDrop) {
        if (typeof currentSpawnSound.fade === 'function') currentSpawnSound.fade(0.06);
        else if (typeof currentSpawnSound.stop === 'function') currentSpawnSound.stop();
      }
    } catch (e) {}
  }
}

if (sfxBtn) {
  updateSfxButton();
  sfxBtn.addEventListener('click', () => {
    setSfxEnabled(!sfxEnabled);
  });
}
