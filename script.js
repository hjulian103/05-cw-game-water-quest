// Game configuration and state variables
const GOAL_CANS = 20;        // Total items needed to collect
let currentCans = 0;         // Current number of items collected
let gameActive = false;      // Tracks if game is currently running
let spawnInterval;          // Holds the interval for spawning items
let countdownInterval;      // Holds the countdown timer interval
let timeLeft = 60;          // default time for the round (seconds)
const STORAGE_KEY = 'waterQuest_total_dollars';
let totalDollars = 0; // persisted all-time dollars
let sessionDollars = 0; // dollars in current session
// two can types: normal and premium
const CAN_TYPES = {
  normal: { src: 'img/water-can-transparent.png', value: 1 },
  premium: { src: 'img/water-can.png', value: 5 } // fallback to existing image for premium
};

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
  const isPremium = Math.random() < 0.12; // ~12% premium
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

  // play a small spawn sound
  playSound('spawn');
}

// Simple WebAudio manager for small sound cues
const audioCtx = (window.AudioContext || window.webkitAudioContext) ? new (window.AudioContext || window.webkitAudioContext)() : null;
function playSound(name) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  if (name === 'spawn') {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(660, now);
    g.gain.setValueAtTime(0.02, now);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(now); o.stop(now + 0.06);
  }
  if (name === 'collect') {
    // water-like splash: bandpass filtered noise burst with short pitch sweep and a stereo-delay for body
    const dur = 0.45;
    const noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
    const out = noiseBuf.getChannelData(0);
    for (let i = 0; i < out.length; i++) out[i] = (Math.random() * 2 - 1) * (1 - i / out.length);
    const noiseSrc = audioCtx.createBufferSource();
    noiseSrc.buffer = noiseBuf;

    const band = audioCtx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(900, now);
    band.Q.setValueAtTime(1.6, now);

    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.0009, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.00001, now + dur);

    noiseSrc.connect(band); band.connect(noiseGain);

    // short pitched element for the 'pop' edge
    const tone = audioCtx.createOscillator();
    tone.type = 'triangle';
    tone.frequency.setValueAtTime(1200, now);
    tone.frequency.exponentialRampToValueAtTime(480, now + dur * 0.9);
    const toneG = audioCtx.createGain();
    toneG.gain.setValueAtTime(0.02, now);
    toneG.gain.exponentialRampToValueAtTime(0.0005, now + dur);
    tone.connect(toneG);

    // subtle delay to add body (create stereo-ish feel with FeedbackDelayNode fallback)
    const delay = audioCtx.createDelay(0.2);
    delay.delayTime.setValueAtTime(0.03, now);
    const delayGain = audioCtx.createGain();
    delayGain.gain.setValueAtTime(0.25, now);

    // mix paths to destination
    noiseGain.connect(audioCtx.destination);
    toneG.connect(audioCtx.destination);
    // delayed tone for body
    toneG.connect(delay); delay.connect(delayGain); delayGain.connect(audioCtx.destination);

    noiseSrc.start(now); noiseSrc.stop(now + dur);
    tone.start(now); tone.stop(now + dur);
  }
  if (name === 'victory') {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1200, now);
    g.gain.setValueAtTime(0.06, now);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(now); o.stop(now + 0.22);
  }
}

// Increment score and clear the current water can
function collectCan(target) {
  // Locate the wrapper and image but don't remove immediately so we can show animations
  const wrapper = target.closest('.water-can-wrapper');
  const cell = target.closest('.grid-cell');

  // increment collected cans and update display
  currentCans += 1;
  const currentEl = document.getElementById('current-cans');
  if (currentEl) currentEl.textContent = currentCans;

  // determine clicked can's value (data-value on the image)
  const clickedValue = parseFloat(target.dataset && target.dataset.value) || parseFloat(target.getAttribute('data-value')) || 1;

  // update session dollars and UI
  sessionDollars = Math.round((sessionDollars + clickedValue) * 100) / 100;
  const dollarsEl = document.getElementById('dollars');
  if (dollarsEl) dollarsEl.textContent = sessionDollars;

  // update the donation badge (people helped) based on session total
  const people = Math.floor(sessionDollars / 40);
  updateBadge(people);

  // persist to all-time total using clicked value
  const addValue = clickedValue || 1;
  totalDollars += addValue;
  totalDollars = Math.round(totalDollars * 100) / 100;
  try { localStorage.setItem(STORAGE_KEY, String(totalDollars)); } catch (err) {}
  const totalEl = document.getElementById('total-dollars');
  if (totalEl) totalEl.textContent = totalDollars;

  // announce to screen readers
  const announcer = document.getElementById('announcer');
  if (announcer) announcer.textContent = `Collected! Score ${currentCans}`;

  // play collect sound
  playSound('collect');

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

    // try to play a recorded splash file if present, otherwise fallback to synth
    playRecordedSplash().catch(() => playSound('collect'));

    // cleanup after animations complete
    setTimeout(() => {
      plus.remove();
      splash.remove();
      ripple.remove();
      if (wrapper) wrapper.remove();
    }, 760);
  }

  // If we've reached the goal, show victory
  if (currentCans >= GOAL_CANS) {
    showVictory();
  }
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
function startTimer() {
  timeLeft = 60;
  document.getElementById('timer').textContent = timeLeft;
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
  gameActive = true;
  createGrid(); // Set up the game grid
  spawnInterval = setInterval(spawnWaterCan, 900); // spawn every 900ms for snappier play
  startTimer();
  // Update CTA to indicate running state
  const btn = document.getElementById('start-game');
  if (btn) btn.textContent = 'Keep going!';
}

function endGame() {
  gameActive = false; // Mark the game as inactive
  clearInterval(spawnInterval); // Stop spawning water cans
  clearInterval(countdownInterval);
  // Change CTA to allow restart
  const btn = document.getElementById('start-game');
  if (btn) btn.textContent = 'Play again';
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
  updateBadge(0);
  sessionDollars = 0;
  document.getElementById('dollars').textContent = '0';
  document.getElementById('timer').textContent = '60';
  hideVictory();
}

// Try to play a recorded splash file (returns a promise). If not available, reject so caller can fallback.
async function playRecordedSplash() {
  // Try to play a static file first; if missing, generate a short recorded-style splash using OfflineAudioContext
  try {
    const audio = new Audio('sounds/splash.mp3');
    audio.volume = 0.9;
    await new Promise((resolve, reject) => {
      // If file can't be loaded or play fails, reject so we can fallback
      audio.addEventListener('canplaythrough', () => {
        audio.play().then(resolve).catch(reject);
      });
      audio.addEventListener('error', () => reject(new Error('splash audio missing')));
    });
    return;
  } catch (err) {
    // fallback: synthesize a short recorded-style splash using OfflineAudioContext
  }

  // create a short sampled splash (noise burst + short pitch) and play it
  try {
    const sampleRate = 44100;
    const duration = 0.5; // a little longer for a fuller splash
    const offline = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, sampleRate * duration, sampleRate);

    // prepare bandpass filtered noise
    const noiseBuffer = offline.createBuffer(1, sampleRate * duration, sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const noiseSrc = offline.createBufferSource();
    noiseSrc.buffer = noiseBuffer;
    const band = offline.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900;
    band.Q.value = 1.6;
    const ng = offline.createGain(); ng.gain.value = 0.8; ng.gain.exponentialRampToValueAtTime(0.0001, duration);
    noiseSrc.connect(band); band.connect(ng); ng.connect(offline.destination);
    noiseSrc.start(0);

    // pitched body
    const tone = offline.createOscillator();
    tone.type = 'triangle';
    tone.frequency.setValueAtTime(1200, 0);
    tone.frequency.linearRampToValueAtTime(480, duration * 0.9);
    const tg = offline.createGain(); tg.gain.setValueAtTime(0.03, 0); tg.gain.exponentialRampToValueAtTime(0.0005, duration);
    tone.connect(tg); tg.connect(offline.destination);
    tone.start(0);

    const rendered = await offline.startRendering();

    // encode to WAV and play via blob URL
    const wavBlob = encodeWAV(rendered);
    const url = URL.createObjectURL(wavBlob);
    await new Promise((resolve, reject) => {
      const a = new Audio(url);
      a.volume = 0.9;
      a.addEventListener('ended', () => { URL.revokeObjectURL(url); resolve(); });
      a.addEventListener('error', (e) => { URL.revokeObjectURL(url); reject(e); });
      a.play().then(() => {}).catch(reject);
    });
    return;
  } catch (err) {
    // if anything fails, fall back to the synth pop
    return Promise.reject(err);
  }
}

// Encode an AudioBuffer into a WAV Blob (16-bit PCM)
function encodeWAV(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const samples = audioBuffer.getChannelData(0);
  // convert to 16-bit PCM
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  /* RIFF identifier */ writeString(view, 0, 'RIFF');
  /* file length */ view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */ writeString(view, 8, 'WAVE');
  /* format chunk identifier */ writeString(view, 12, 'fmt ');
  /* format chunk length */ view.setUint32(16, 16, true);
  /* sample format (raw) */ view.setUint16(20, 1, true);
  /* channel count */ view.setUint16(22, numChannels, true);
  /* sample rate */ view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */ view.setUint32(28, sampleRate * numChannels * 2, true);
  /* block align (channel count * bytes per sample) */ view.setUint16(32, numChannels * 2, true);
  /* bits per sample */ view.setUint16(34, 16, true);
  /* data chunk identifier */ writeString(view, 36, 'data');
  /* data chunk length */ view.setUint32(40, samples.length * 2, true);

  // write PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Set up click handler for the start button
document.getElementById('start-game').addEventListener('click', () => {
  // If game is active, do nothing. If not active and we have counts, reset then start.
  if (!gameActive) {
    resetGame();
    startGame();
  }
});

// Delegate clicks inside the grid to handle collecting cans
document.querySelector('.game-grid').addEventListener('click', (e) => {
  if (!gameActive) return;
  if (e.target.closest('.water-can')) {
    collectCan(e.target);
  }
});

// modal restart button
const modalRestart = document.getElementById('modal-restart');
if (modalRestart) modalRestart.addEventListener('click', () => {
  hideVictory();
  resetGame();
  startGame();
});

// keyboard accessibility: allow Enter/Space to collect when focused on a cell
document.addEventListener('keydown', (e) => {
  if (!gameActive) return;
  if (e.key === 'Enter' || e.key === ' ') {
    const active = document.activeElement;
    if (active && active.classList.contains('grid-cell')) {
      const can = active.querySelector('.water-can');
      if (can) collectCan(can);
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
