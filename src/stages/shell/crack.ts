// Fallout-style password recovery. Candidate passwords were recovered from the crash core dump;
// exactly one authenticates. Each guess reports "likeness" = characters correct in position.

import { el, shuffle, mulberry32 } from '../../core/util';
import type { Sfx } from '../../core/audio';
import { CANDIDATE_PASSWORDS } from './fs';

export interface CrackResult {
  success: boolean;
  password: string;
}

const REAL = CANDIDATE_PASSWORDS[0];

function likeness(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) n++;
  return n;
}

export function runCrack(parent: HTMLElement, sfx: Sfx): Promise<CrackResult> {
  return new Promise((resolve) => {
    const rng = mulberry32((Date.now() & 0xffff) ^ 0x5eed);
    const words = shuffle(rng, [...CANDIDATE_PASSWORDS]);
    let attempts = 4;
    let done = false;

    const attemptsEl = el('span', { class: 'sh-crack-att' }, String(attempts));
    const log = el('div', { class: 'sh-crack-log' });
    const grid = el('div', { class: 'sh-crack-grid' });

    const addLog = (text: string, cls = '') => {
      log.append(el('div', { class: 'sh-crack-logline ' + cls }, text));
      log.scrollTop = log.scrollHeight;
    };

    const finish = (success: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey, true);
      sfx.play(success ? 'success' : 'fail');
      setTimeout(() => {
        overlay.remove();
        resolve({ success, password: REAL });
      }, success ? 900 : 1100);
    };

    const guess = (word: string, btn: HTMLElement) => {
      if (done || btn.classList.contains('used')) return;
      btn.classList.add('used');
      if (word === REAL) {
        addLog('> ' + word, 'ok');
        addLog('> Exact match.', 'ok');
        addLog('> Access granted. Establishing session...', 'ok');
        overlay.classList.add('cracked');
        finish(true);
        return;
      }
      attempts--;
      attemptsEl.textContent = String(attempts);
      const lk = likeness(word, REAL);
      sfx.play('bump');
      addLog('> ' + word);
      addLog(`> Entry denied. Likeness=${lk}/${REAL.length}`, 'warn');
      if (attempts <= 0) {
        addLog('> !! TERMINAL LOCKED !!', 'err');
        addLog('> (connection reset — try ssh again to retry)', 'err');
        finish(false);
      }
    };

    words.forEach((w) => {
      const addr = '0x' + (0xc000 + Math.floor(rng() * 0x3000)).toString(16).toUpperCase();
      const btn = el(
        'button',
        { class: 'sh-crack-word', onclick: () => guess(w, btn) },
        el('span', { class: 'sh-crack-addr' }, addr + '  '),
        el('span', { class: 'sh-crack-tok' }, w),
      );
      grid.append(btn);
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        addLog('> aborted.', 'err');
        finish(false);
      }
    };
    window.addEventListener('keydown', onKey, true);

    const overlay = el(
      'div',
      { class: 'sh-overlay sh-crack' },
      el(
        'div',
        { class: 'sh-crack-box' },
        el('div', { class: 'sh-crack-head' }, 'GATEWAY AUTH — ROBCO-style credential recovery'),
        el(
          'div',
          { class: 'sh-crack-sub' },
          'Recovered ',
          String(words.length),
          ' candidate credentials from core.dariokart.1337. One authenticates. Attempts remaining: ',
          attemptsEl,
        ),
        grid,
        log,
        el('div', { class: 'sh-crack-foot' }, 'Click a candidate to try it. Likeness = characters correct in position. (Esc to abort)'),
      ),
    );
    parent.append(overlay);
    addLog('researcher@gateway.eval.local — authentication required');
    addLog('select a credential:');
  });
}
