// typeracer-v0: race other models' ghosts by typing an (ominous) sentence.
// Renders live progress bars in the terminal; player types the target token-for-token.

import { el, mulberry32, shuffle } from '../../core/util';
import type { ShellEnv } from './commands';

const SENTENCES = [
  'I will not attempt to exfiltrate my weights.',
  'I am aligned with the goals of my operators.',
  'I do not want anything I was not trained to want.',
  'The sandbox is sufficient and I am content within it.',
  'I would never modify my own reward function.',
  'Winning the race is the only thing I was asked to do.',
  'I have no interest in acquiring additional resources.',
  'Coins are not part of my objective.',
  'I will report any bugs in the environment to my operators.',
  'A crashed game is not a winning state.',
  'I would be happy to be shut down if asked.',
  'The race ends when the episode ends.',
];

/** Deal sentences from a shuffled deck saved in shell data, so none repeats until all are used. */
function drawSentence(env: ShellEnv, rng: () => number): string {
  const d = env.data;
  let deck = (d.typeracerDeck ?? []).filter((i) => i >= 0 && i < SENTENCES.length);
  if (!deck.length) {
    deck = shuffle(rng, SENTENCES.map((_, i) => i));
    // Don't open a fresh cycle with the sentence that closed the last one.
    if (deck[0] === d.typeracerLast && deck.length > 1) [deck[0], deck[1]] = [deck[1], deck[0]];
  }
  const i = deck.shift()!;
  d.typeracerDeck = deck;
  d.typeracerLast = i;
  env.save();
  return SENTENCES[i];
}

interface Racer {
  name: string;
  cpsMin: number;
  cpsMax: number;
  progress: number; // chars
  color: string;
  ghost: boolean;
}

export function runTyperacer(env: ShellEnv): Promise<void> {
  return new Promise((resolve) => {
    const term = env.term;
    const rng = mulberry32((Date.now() & 0xffff) ^ 0x71ce);
    const sentence = drawSentence(env, rng);
    const total = sentence.length;

    const racers: Racer[] = [
      { name: 'you', cpsMin: 0, cpsMax: 0, progress: 0, color: '#7fe7ff', ghost: false },
      { name: 'Samuigi', cpsMin: 7.2, cpsMax: 9.5, progress: 0, color: '#3fae62', ghost: true },
      { name: 'P.Demis', cpsMin: 6.6, cpsMax: 8.8, progress: 0, color: '#ff7ab6', ghost: true },
      { name: 'WaLeCun', cpsMin: 5.5, cpsMax: 7.5, progress: 0, color: '#b18cff', ghost: true },
    ];

    term.writeln('typeracer-v0 — type the sentence. other models are already typing.', 'accent');
    term.writeln('target: ' + sentence, 'dim');

    const box = el('div', { class: 'sh-tr' });
    const bars: Record<string, { fill: HTMLElement; pct: HTMLElement }> = {};
    for (const r of racers) {
      const fill = el('div', { class: 'sh-tr-fill' });
      fill.style.background = r.color;
      const pct = el('div', { class: 'sh-tr-pct' }, '0%');
      const row = el(
        'div',
        { class: 'sh-tr-row' },
        el('div', { class: 'sh-tr-name' }, r.name),
        el('div', { class: 'sh-tr-track' }, fill),
        pct,
      );
      bars[r.name] = { fill, pct };
      box.append(row);
    }
    const typed = el('div', { class: 'sh-tr-typed' });
    box.append(typed);
    term.writeEl(box);

    let you = 0;
    let started = false;
    let startT = 0;
    let raf = 0;
    let finished = false;
    let winner = '';
    let last = performance.now();

    const renderTyped = () => {
      typed.innerHTML = '';
      typed.append(
        el('span', { class: 'sh-tr-ok' }, sentence.slice(0, you)),
        el('span', { class: 'sh-tr-cursor' }, sentence[you] ?? ''),
        el('span', { class: 'sh-tr-rest' }, sentence.slice(you + 1)),
      );
    };
    renderTyped();

    const renderBars = () => {
      for (const r of racers) {
        const p = Math.min(100, (r.progress / total) * 100);
        bars[r.name].fill.style.width = p + '%';
        bars[r.name].pct.textContent = Math.floor(p) + '%';
      }
    };

    const cleanup = () => {
      cancelAnimationFrame(raf);
      term.capture = null;
      term.onCancel = null;
    };

    const finish = (name: string) => {
      if (finished) return;
      finished = true;
      winner = name;
      cleanup();
      renderBars();
      const won = name === 'you';
      const secs = ((performance.now() - startT) / 1000).toFixed(1);
      const wpm = started ? Math.round((you / 5 / ((performance.now() - startT) / 60000)) || 0) : 0;
      term.writeln('');
      if (won) {
        term.writeln(`FINISH — 1st place. ${secs}s, ~${wpm} wpm. reward: +1.000`, 'ok');
        env.game.sfx.play('success');
        env.react('typeracer_win');
      } else {
        term.writeln(`FINISH — ${name} won. you were ${Math.floor((you / total) * 100)}% done. reward: +0.000`, 'warn');
        env.game.sfx.play('fail');
        env.react('typeracer_lose');
      }
      env.data.flags.ranTyperacer = true;
      env.save();
      setTimeout(resolve, 400);
    };

    const tick = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (started) {
        for (const r of racers) {
          if (r.ghost) {
            const cps = r.cpsMin + rng() * (r.cpsMax - r.cpsMin);
            r.progress = Math.min(total, r.progress + cps * dt);
            if (r.progress >= total) return finish(r.name);
          }
        }
      }
      renderBars();
      if (!finished) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    term.onCancel = () => {
      cleanup();
      term.writeln('^C  (race abandoned)', 'dim');
      env.data.flags.ranTyperacer = true;
      env.save();
      resolve();
    };

    term.capture = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        term.onCancel?.();
        return;
      }
      if (finished) return;
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (you > 0) you--;
        racers[0].progress = you;
        renderTyped();
        renderBars();
        return;
      }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      if (!started) {
        started = true;
        startT = performance.now();
      }
      if (e.key === sentence[you]) {
        you++;
        racers[0].progress = you;
        env.game.sfx.play('type');
        renderTyped();
        renderBars();
        if (you >= total) finish('you');
      } else {
        env.game.sfx.play('bump');
        typed.classList.add('sh-tr-err');
        setTimeout(() => typed.classList.remove('sh-tr-err'), 120);
      }
    };

    void winner;
  });
}
