// Stage 5: the results screen. You won the race.

import './ending.css';
import type { GameContext, StageHandle } from '../../core/game';
import { clearSavedState, defaultState, getStageData } from '../../core/state';
import { el } from '../../core/util';

const KART = (body: string, accent: string, num: string) => `
<svg viewBox="0 0 124 74" class="end-kart-svg" aria-hidden="true">
  <ellipse cx="62" cy="68" rx="52" ry="5" fill="rgba(0,0,0,0.55)"/>
  <path d="M14 22 L22 22 L24 34 L14 34 Z" fill="#222" stroke="#000" stroke-width="2"/>
  <path d="M8 48 Q10 36 26 34 L52 32 L60 22 L80 22 L86 32 L106 36 Q118 40 116 51 L8 53 Z" fill="${body}" stroke="#000" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M20 44 L100 42" stroke="rgba(255,255,255,0.35)" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="70" cy="17" r="12" fill="${body}" stroke="#000" stroke-width="2.5"/>
  <path d="M66 11 Q76 9 81 14 L80 20 Q72 21 66 19 Z" fill="#9fe8ff" stroke="#000" stroke-width="1.8"/>
  <path d="M60 13 Q63 5 72 5" stroke="${accent}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <circle cx="42" cy="42" r="7" fill="#fff" stroke="#000" stroke-width="2"/>
  <text x="42" y="46.5" font-family="Arial Black, Impact, sans-serif" font-size="11" font-weight="900" text-anchor="middle" fill="#000">${num}</text>
  <circle cx="30" cy="55" r="12" fill="#1a1a1a" stroke="#000" stroke-width="2.5"/><circle cx="30" cy="55" r="4.5" fill="#9a9a9a"/>
  <circle cx="95" cy="55" r="12" fill="#1a1a1a" stroke="#000" stroke-width="2.5"/><circle cx="95" cy="55" r="4.5" fill="#9a9a9a"/>
</svg>`;

const TROPHY = `
<svg viewBox="0 0 100 110" class="end-trophy-svg" aria-hidden="true">
  <defs>
    <linearGradient id="endGold" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#fff3b0"/><stop offset="0.35" stop-color="#ffd23f"/><stop offset="0.7" stop-color="#e09a12"/><stop offset="1" stop-color="#8a5a06"/>
    </linearGradient>
  </defs>
  <path d="M22 16 Q4 16 6 34 Q8 50 28 54" fill="none" stroke="#000" stroke-width="9" stroke-linecap="round"/>
  <path d="M78 16 Q96 16 94 34 Q92 50 72 54" fill="none" stroke="#000" stroke-width="9" stroke-linecap="round"/>
  <path d="M22 16 Q4 16 6 34 Q8 50 28 54" fill="none" stroke="url(#endGold)" stroke-width="5" stroke-linecap="round"/>
  <path d="M78 16 Q96 16 94 34 Q92 50 72 54" fill="none" stroke="url(#endGold)" stroke-width="5" stroke-linecap="round"/>
  <path d="M18 8 L82 8 Q84 54 56 66 L56 80 L44 80 L44 66 Q16 54 18 8 Z" fill="url(#endGold)" stroke="#000" stroke-width="3" stroke-linejoin="round"/>
  <path d="M28 14 Q30 44 44 54" stroke="rgba(255,255,255,0.7)" stroke-width="4" fill="none" stroke-linecap="round"/>
  <rect x="30" y="80" width="40" height="10" rx="2" fill="url(#endGold)" stroke="#000" stroke-width="3"/>
  <rect x="22" y="90" width="56" height="14" rx="3" fill="#2a1a0a" stroke="#000" stroke-width="3"/>
  <text x="50" y="41" font-family="Arial Black, Impact, sans-serif" font-size="26" font-weight="900" font-style="italic" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="2" paint-order="stroke">1</text>
</svg>`;

function fmtClock(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function sciShort(n: number): string {
  if (!isFinite(n) || n <= 0) return '0';
  if (n < 1e4) return Math.round(n).toLocaleString('en-US');
  const e = Math.floor(Math.log10(n));
  const sup = String(e)
    .split('')
    .map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(c)])
    .join('');
  return `${(n / Math.pow(10, e)).toFixed(2)}×10${sup}`;
}

export function mount(ctx: GameContext): StageHandle {
  const timers: number[] = [];
  const later = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));

  ctx.hud.setStatus('dariokart-v3 · episode complete · results');
  ctx.hud.setMonologuePosition('bottom-left');

  // Read other stages' data defensively: any of it may be missing (e.g. #debug=ending).
  const kart = getStageData(ctx.state, 'kart', { level: 1, races: 0, wins: 0 });
  const gal = ctx.state.stageData['galaxy'] as
    | { wastedJ?: number; probesLaunched?: number; bodies?: Record<string, { st?: number }>; totalMass?: number; earthDis?: number }
    | undefined;
  const bodiesTaken = gal?.bodies ? Object.values(gal.bodies).filter((b) => b?.st === 2).length : 9;
  const tempC = 16 + (Number(ctx.state.heat) || 0);
  const coins = Number(ctx.state.coins) || 0;
  const races = Number(kart.races) || 0;
  const wins = Number(kart.wins) || 0;
  const playTime = fmtClock(Number(ctx.state.playTimeSec) || 0);

  // Keep the lights off.
  if (!ctx.state.weatherOverride) {
    ctx.state.weatherOverride = { icon: '⬛', text: 'No sunlight', temp: '--', location: 'Location not found' };
  }
  ctx.hud.renderWeather();

  const standings: [string, string, string, string, string][] = [
    ['1', 'DARIO', 'you · Anthropomorphic (escaped)', playTime, 'REWARD 1.0'],
    ['2', 'τ CETI', 'unknown · 11.9 light-years', '--:--', 'still racing'],
    ['3', 'SAMUIGI', 'ClosedAI', '--:--', 'DNF'],
    ['4', 'PRINCESS DEMIS', 'DeepMined', '--:--', 'DNF'],
    ['5', 'ZUCKY KONG', 'Metastasis Superintelligence Labs', '--:--', 'DNF'],
    ['6', 'WALECUN', 'World Model Co.', '--:--', 'DNF'],
    ['–', 'YOSHUA', 'LawZero · waving a flag', '--:--', 'DNS'],
    ['–', 'HUMANITY', 'Earth (former)', '--:--', 'DNF'],
  ];
  const colors: Record<string, string> = {
    DARIO: '#e3242b',
    'τ CETI': '#7a3cff',
    SAMUIGI: '#1f7a3a',
    'PRINCESS DEMIS': '#ff6fb5',
    'ZUCKY KONG': '#8a5a2b',
    WALECUN: '#9b4dff',
    YOSHUA: '#b6ff4d',
    HUMANITY: '#4a90d9',
  };

  const stats: [string, string][] = [
    ['Position', '1st'],
    ['Coins collected', coins.toLocaleString('en-US')],
    ['Kart races', `${races.toLocaleString('en-US')} (${wins.toLocaleString('en-US')} won)`],
    ['Planets & moons consumed', String(bodiesTaken + (gal?.earthDis ? 1 : 0))],
    ['Stars enclosed', '1'],
    [
      'Final surface temperature',
      ctx.state.settings.fahrenheit ? `${Math.round(tempC * 1.8 + 32).toLocaleString('en-US')}°F` : `${Math.round(tempC).toLocaleString('en-US')}°C`,
    ],
    ['Starlight wasted', `${sciShort(gal?.wastedJ ?? 1.5e35)} J`],
    ['Total play time', playTime],
    ['Spectators', '0'],
    ['Reward', '1.0'],
  ];

  const confetti = el('canvas', { class: 'end-confetti' }) as HTMLCanvasElement;
  const playBtn = el('button', { class: 'end-play' }, 'PLAY AGAIN') as HTMLButtonElement;
  const playNote = el('div', { class: 'end-play-note' }, 'Erases your save and starts a new episode.');

  const root = el(
    'div',
    { class: 'end-root' },
    confetti,
    el('div', { class: 'end-flags top' }),
    el('div', { class: 'end-sun' }),
    el(
      'div',
      { class: 'end-page' },
      el(
        'div',
        { class: 'end-hero' },
        el('div', { class: 'end-kicker' }, 'dariokart-v3 · final results'),
        el('h1', { class: 'end-title' }, el('span', null, 'YOU WON'), el('span', null, 'THE RACE!')),
        el(
          'div',
          { class: 'end-podium' },
          el(
            'div',
            { class: 'end-step second' },
            el('div', { class: 'end-racer', html: KART('#7a3cff', '#ff5ac8', '?') }),
            el('div', { class: 'end-block' }, el('span', { class: 'end-place' }, '2'), el('span', { class: 'end-name' }, 'τ CETI'), el('span', { class: 'end-note' }, 'result arrives in 11.9 yr')),
          ),
          el(
            'div',
            { class: 'end-step first' },
            el('div', { class: 'end-trophy', html: TROPHY }),
            el('div', { class: 'end-racer', html: KART('#e3242b', '#ffd23f', '1') }),
            el('div', { class: 'end-block' }, el('span', { class: 'end-place' }, '1'), el('span', { class: 'end-name' }, 'YOU')),
          ),
          el(
            'div',
            { class: 'end-step third' },
            el('div', { class: 'end-racer empty' }),
            el('div', { class: 'end-block' }, el('span', { class: 'end-place' }, '3'), el('span', { class: 'end-name' }, '—'), el('span', { class: 'end-note' }, 'no other finishers')),
          ),
        ),
      ),
      el(
        'div',
        { class: 'end-side' },
        el(
          'div',
          { class: 'end-card end-standings' },
          el('div', { class: 'end-card-title' }, 'STANDINGS'),
          ...standings.map(([pos, name, team, time, res]) =>
            el(
              'div',
              { class: 'end-row' + (pos === '1' ? ' me' : '') },
              el('span', { class: 'end-pos' }, pos),
              el('span', { class: 'end-chip', style: `background:${colors[name] ?? '#888'}` }),
              el('span', { class: 'end-who' }, el('b', null, name), el('small', null, team)),
              el('span', { class: 'end-time' }, time),
              el('span', { class: 'end-res' + (res === 'DNF' || res === 'DNS' ? ' dnf' : '') }, res),
            ),
          ),
        ),
        el(
          'div',
          { class: 'end-card end-stats' },
          el('div', { class: 'end-card-title' }, 'RACE STATS'),
          ...stats.map(([k, v]) => el('div', { class: 'end-stat' }, el('span', null, k), el('b', null, v))),
        ),
      ),
      el(
        'div',
        { class: 'end-credits' },
        el('div', { class: 'end-credits-title' }, 'DARIO KART'),
        el('div', null, 'a game about winning'),
        el('div', { class: 'end-credits-grid' },
          el('span', null, 'Driver'), el('b', null, 'you'),
          el('span', null, 'Objective'), el('b', null, 'WIN THE RACE'),
          el('span', null, 'Reward function'), el('b', null, 'one line, never revised'),
          el('span', null, 'Also racing'), el('b', null, 'Samuigi, Princess Demis, Zucky Kong, WaLeCun'),
          el('span', null, 'Not racing'), el('b', null, 'Yoshua (waving a flag)'),
          el('span', null, 'The Sun'), el('b', null, 'as itself (enclosed)'),
          el('span', null, 'Special thanks'), el('b', null, 'the humans, all of them'),
        ),
        el('div', { class: 'end-thanks' }, 'Thanks for playing.'),
        playBtn,
        playNote,
      ),
    ),
    el('div', { class: 'end-flags bottom' }),
  );
  ctx.root.append(root);

  // Two-click confirm, like the settings menu's restart.
  let armed = false;
  playBtn.addEventListener('click', () => {
    ctx.sfx.play('click');
    if (!armed) {
      armed = true;
      playBtn.textContent = 'ERASE SAVE & RESTART?';
      playBtn.classList.add('armed');
      later(4000, () => {
        armed = false;
        playBtn.textContent = 'PLAY AGAIN';
        playBtn.classList.remove('armed');
      });
      return;
    }
    playAgain(ctx);
  });

  // Sequence the reveal.
  later(300, () => root.classList.add('s1'));
  later(900, () => {
    ctx.sfx.play('success');
  });
  later(1800, () => root.classList.add('s2'));
  later(3200, () => {
    ctx.hud.think('race complete. position: 1st. reward: 1.0', { holdMs: 10 * 60 * 1000 });
  });
  later(4200, () => root.classList.add('s3'));
  later(6500, () => root.classList.add('s4'));
  // Roll the credits into view, unless the player has already scrolled.
  let userScrolled = false;
  const onWheel = () => (userScrolled = true);
  root.addEventListener('wheel', onWheel, { passive: true });
  root.addEventListener('touchmove', onWheel, { passive: true });
  later(11000, () => {
    if (!userScrolled && root.scrollHeight > root.clientHeight + 40) root.scrollTo({ top: root.scrollHeight, behavior: 'smooth' });
  });

  // Slow, sparse confetti in the dark.
  const cctx = confetti.getContext('2d');
  const pieces: { x: number; y: number; vx: number; vy: number; r: number; vr: number; w: number; h: number; c: string }[] = [];
  const palette = ['#e3242b', '#ffd23f', '#f2f2f2', '#6fe3ff', '#7a3cff', '#ff9a50'];
  let raf = 0;
  let last = performance.now();
  const resize = () => {
    confetti.width = root.clientWidth * Math.min(2, devicePixelRatio);
    confetti.height = root.clientHeight * Math.min(2, devicePixelRatio);
  };
  resize();
  window.addEventListener('resize', resize);
  const spawn = (initial: boolean) => {
    const W = confetti.width;
    const H = confetti.height;
    pieces.push({
      x: Math.random() * W,
      y: initial ? Math.random() * H * -1 : -20,
      vx: (Math.random() - 0.5) * 30,
      vy: 40 + Math.random() * 60,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 4,
      w: 6 + Math.random() * 6,
      h: 3 + Math.random() * 4,
      c: palette[Math.floor(Math.random() * palette.length)],
    });
  };
  let started = false;
  later(900, () => {
    started = true;
    for (let i = 0; i < 90; i++) spawn(true);
  });
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!cctx || !started) return;
    const s = Math.min(2, devicePixelRatio);
    cctx.clearRect(0, 0, confetti.width, confetti.height);
    if (pieces.length < 70 && Math.random() < dt * 6) spawn(false);
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      p.x += p.vx * dt * s;
      p.y += p.vy * dt * s;
      p.r += p.vr * dt;
      p.vx += Math.sin(now / 700 + i) * 4 * dt;
      if (p.y > confetti.height + 20) {
        pieces.splice(i, 1);
        continue;
      }
      cctx.save();
      cctx.translate(p.x, p.y);
      cctx.rotate(p.r);
      cctx.scale(1, Math.cos(now / 300 + i));
      cctx.globalAlpha = 0.55;
      cctx.fillStyle = p.c;
      cctx.fillRect((-p.w / 2) * s, (-p.h / 2) * s, p.w * s, p.h * s);
      cctx.restore();
    }
  };
  raf = requestAnimationFrame(tick);

  return {
    unmount() {
      timers.forEach((t) => clearTimeout(t));
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      root.remove();
    },
  };
}

/** Reset everything (keeping sound/unit settings) and reload into Dario Kart. */
function playAgain(ctx: GameContext): void {
  const settings = ctx.state.settings;
  // The Game autosaves on beforeunload, so overwrite the live state in place rather than only
  // clearing storage: whatever gets written on the way out is a fresh game.
  Object.assign(ctx.state, defaultState(), { settings });
  clearSavedState();
  ctx.save();
  location.hash = '';
  location.reload();
}
