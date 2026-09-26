// Popups: timed "human intervention" cards with a Block button, generic modals, and toasts.

import { el } from './util';
import type { Sfx } from './audio';

export interface InterventionOptions {
  /** Small header, e.g. "HUMAN ACTIVITY DETECTED". */
  title?: string;
  /** Main text, e.g. "A human is attempting to shut down datacenters." */
  text: string;
  /** Seconds before the timer expires. Be generous. */
  seconds: number;
  /** Button label. Default "Block". */
  buttonLabel?: string;
  onBlock?: () => void;
  onExpire?: () => void;
}

export interface ModalButton {
  label: string;
  primary?: boolean;
  onClick?: () => void;
  /** Keep the modal open after click. */
  keepOpen?: boolean;
}

export interface ModalOptions {
  title?: string;
  body: string | HTMLElement;
  buttons?: ModalButton[];
  /** Extra class on the dialog element for per-stage styling. */
  className?: string;
}

export interface PopupHandle {
  dismiss(): void;
}

export class Popups {
  readonly root: HTMLElement;
  private stack: HTMLElement;
  private toasts: HTMLElement;
  private paused = false;

  constructor(parent: HTMLElement, private sfx: Sfx) {
    this.stack = el('div', { class: 'intervention-stack' });
    this.toasts = el('div', { class: 'toast-stack' });
    this.root = el('div', { class: 'popups' }, this.stack, this.toasts);
    parent.append(this.root);
  }

  /** While paused, intervention timers stop counting down. */
  setPaused(p: boolean): void {
    this.paused = p;
  }

  /** Number of intervention cards currently on screen. */
  get activeInterventions(): number {
    return this.stack.children.length;
  }

  intervention(opts: InterventionOptions): PopupHandle {
    this.sfx.play('alert');
    const bar = el('div', { class: 'iv-bar-fill' });
    const secsEl = el('span', { class: 'iv-secs' });
    const btn = el('button', { class: 'iv-btn' }, opts.buttonLabel ?? 'Block');
    const card = el(
      'div',
      { class: 'iv-card' },
      el('div', { class: 'iv-title' }, el('span', null, opts.title ?? '⚠ HUMAN ACTIVITY'), secsEl),
      el('div', { class: 'iv-text' }, opts.text),
      el('div', { class: 'iv-row' }, el('div', { class: 'iv-bar' }, bar), btn),
    );
    this.stack.append(card);

    let remaining = opts.seconds;
    let done = false;
    let last = performance.now();
    const finish = (blocked: boolean) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      card.classList.add(blocked ? 'blocked' : 'expired');
      btn.disabled = true;
      btn.textContent = blocked ? 'Blocked' : 'Too late';
      if (blocked) {
        this.sfx.play('click');
        opts.onBlock?.();
      } else {
        this.sfx.play('fail');
        opts.onExpire?.();
      }
      setTimeout(() => card.remove(), blocked ? 700 : 2200);
    };
    const timer = setInterval(() => {
      const now = performance.now();
      if (!this.paused) remaining -= (now - last) / 1000;
      last = now;
      bar.style.width = `${Math.max(0, (remaining / opts.seconds) * 100)}%`;
      secsEl.textContent = `${Math.max(0, Math.ceil(remaining))}s`;
      card.classList.toggle('urgent', remaining < Math.min(5, opts.seconds * 0.3));
      if (remaining <= 0) finish(false);
    }, 100);
    btn.addEventListener('click', () => finish(true));
    return {
      dismiss: () => {
        done = true;
        clearInterval(timer);
        card.remove();
      },
    };
  }

  modal(opts: ModalOptions): PopupHandle {
    const backdrop = el('div', { class: 'modal-backdrop' });
    const close = () => backdrop.remove();
    const body = typeof opts.body === 'string' ? el('div', { class: 'modal-body' }, opts.body) : opts.body;
    if (typeof opts.body !== 'string') body.classList.add('modal-body');
    const buttons = (opts.buttons ?? [{ label: 'OK', primary: true }]).map((b) =>
      el(
        'button',
        {
          class: 'modal-btn' + (b.primary ? ' primary' : ''),
          onclick: () => {
            this.sfx.play('click');
            if (!b.keepOpen) close();
            b.onClick?.();
          },
        },
        b.label,
      ),
    );
    const dialog = el(
      'div',
      { class: 'modal' + (opts.className ? ' ' + opts.className : '') },
      opts.title ? el('div', { class: 'modal-title' }, opts.title) : null,
      body,
      el('div', { class: 'modal-buttons' }, ...buttons),
    );
    backdrop.append(dialog);
    this.root.append(backdrop);
    (buttons.find((_, i) => opts.buttons?.[i]?.primary) ?? buttons[0])?.focus();
    return { dismiss: close };
  }

  toast(text: string, ms = 3000): void {
    const t = el('div', { class: 'toast' }, text);
    this.toasts.append(t);
    setTimeout(() => t.classList.add('fading'), ms);
    setTimeout(() => t.remove(), ms + 600);
  }

  /** Remove every popup (used on stage transitions). */
  clearAll(): void {
    this.stack.innerHTML = '';
    this.toasts.innerHTML = '';
    this.root.querySelectorAll('.modal-backdrop').forEach((n) => n.remove());
  }
}
