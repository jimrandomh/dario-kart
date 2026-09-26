// A small xterm-ish terminal: scrollback, a live input line with a blinking cursor,
// command history (up/down), tab completion, Ctrl+C / Ctrl+L, click-to-focus.

import { el } from '../../core/util';
import type { Sfx } from '../../core/audio';

export interface TabResult {
  /** Text before the token being completed. */
  prefix: string;
  /** Candidate completions of the final token (may include a trailing '/' or ' '). */
  options: string[];
}

export interface TerminalOptions {
  sfx: Sfx;
  prompt: () => string;
  onCommand: (line: string) => Promise<void>;
  onTab: (buffer: string) => TabResult;
  history: string[];
}

type LineClass = '' | 'dim' | 'sys' | 'ok' | 'warn' | 'err' | 'accent' | 'glitch';

export class Terminal {
  readonly root: HTMLElement;
  private scrollEl: HTMLElement;
  private outputEl: HTMLElement;
  private inputLineEl: HTMLElement;
  private promptEl: HTMLElement;
  private textEl: HTMLElement;

  private buffer = '';
  private cursor = 0;
  private histIdx = -1;
  private stash = '';
  private focused = true;

  running = false;
  onCancel: (() => void) | null = null;
  /** When set, raw keydown events are forwarded here and line-editing is bypassed. */
  capture: ((e: KeyboardEvent) => void) | null = null;

  private keyHandler: (e: KeyboardEvent) => void;
  private clickHandler: () => void;

  constructor(parent: HTMLElement, private opts: TerminalOptions) {
    this.textEl = el('span', { class: 'sh-input-text' });
    this.promptEl = el('span', { class: 'sh-prompt' });
    this.inputLineEl = el('div', { class: 'sh-line sh-inputline' }, this.promptEl, this.textEl);
    this.outputEl = el('div', { class: 'sh-output' });
    this.scrollEl = el('div', { class: 'sh-scroll' }, this.outputEl, this.inputLineEl);
    this.root = el('div', { class: 'sh-term', tabindex: '0' }, this.scrollEl);
    parent.append(this.root);

    this.keyHandler = (e) => this.onKey(e);
    this.clickHandler = () => this.focus();
    window.addEventListener('keydown', this.keyHandler, true);
    this.root.addEventListener('mousedown', this.clickHandler);
    this.renderInput();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyHandler, true);
    this.root.removeEventListener('mousedown', this.clickHandler);
  }

  focus(): void {
    this.focused = true;
    this.root.classList.add('focused');
  }

  /** Show/hide the live input line (used to lock input during the arrival sequence). */
  setInputEnabled(v: boolean): void {
    this.running = !v;
    this.renderInput();
  }

  get historyList(): string[] {
    return this.opts.history;
  }

  // ---- output ----

  private appendLine(text: string, cls: LineClass): HTMLElement {
    const line = el('div', { class: 'sh-line' + (cls ? ' sh-' + cls : '') });
    line.textContent = text === '' ? ' ' : text;
    this.outputEl.append(line);
    return line;
  }

  /** Write text (may contain newlines) as output lines. */
  writeln(text = '', cls: LineClass = ''): void {
    const parts = String(text).split('\n');
    for (const p of parts) this.appendLine(p, cls);
    this.scrollToBottom();
  }

  /** Append an arbitrary element as its own block (progress bars, banners, etc). */
  writeEl(node: HTMLElement): void {
    this.outputEl.append(node);
    this.scrollToBottom();
  }

  /** Type text out character-by-character (for the arrival sequence). */
  async typeOut(text: string, cls: LineClass = '', cps = 90): Promise<void> {
    for (const rawLine of text.split('\n')) {
      const line = this.appendLine('', cls);
      for (let i = 0; i < rawLine.length; i++) {
        line.textContent = rawLine.slice(0, i + 1);
        if (i % 2 === 0) this.opts.sfx.play('type');
        this.scrollToBottom();
        await this.sleep(1000 / cps);
      }
      if (rawLine === '') line.textContent = ' ';
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  clear(): void {
    this.outputEl.innerHTML = '';
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
  }

  /** Snapshot the last N output line texts (for reload restore). */
  snapshot(n = 40): string[] {
    const out: string[] = [];
    const kids = Array.from(this.outputEl.children).slice(-n);
    for (const k of kids) out.push(k.textContent === ' ' ? '' : (k.textContent ?? ''));
    return out;
  }

  restore(lines: string[]): void {
    for (const l of lines) this.appendLine(l, 'dim');
    this.scrollToBottom();
  }

  // ---- input line ----

  private renderInput(): void {
    if (this.running) {
      this.inputLineEl.classList.add('hidden');
      return;
    }
    this.inputLineEl.classList.remove('hidden');
    this.promptEl.textContent = this.opts.prompt();
    this.textEl.innerHTML = '';
    const before = this.buffer.slice(0, this.cursor);
    const at = this.buffer.slice(this.cursor, this.cursor + 1) || ' ';
    const after = this.buffer.slice(this.cursor + 1);
    this.textEl.append(
      document.createTextNode(before),
      el('span', { class: 'sh-cursor' + (this.focused ? '' : ' idle') }, at),
      document.createTextNode(after),
    );
    this.scrollToBottom();
  }

  /** Echo the just-submitted command as an output line, then run it. */
  private async submit(): Promise<void> {
    const line = this.buffer;
    this.appendLine(this.opts.prompt() + line, '');
    this.buffer = '';
    this.cursor = 0;
    this.histIdx = -1;
    if (line.trim()) {
      const h = this.opts.history;
      if (h[h.length - 1] !== line) h.push(line);
      if (h.length > 200) h.shift();
    }
    this.running = true;
    this.renderInput();
    try {
      await this.opts.onCommand(line);
    } catch (e) {
      this.writeln(String(e), 'err');
    }
    this.running = false;
    this.onCancel = null;
    this.renderInput();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.capture) {
      this.capture(e);
      return;
    }
    // Ctrl+C: cancel running program or clear the current line.
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      if (this.running) {
        this.onCancel?.();
      } else {
        this.appendLine(this.opts.prompt() + this.buffer + '^C', '');
        this.buffer = '';
        this.cursor = 0;
        this.histIdx = -1;
        this.renderInput();
      }
      return;
    }
    if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      this.clear();
      return;
    }
    if (this.running) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        void this.submit();
        return;
      case 'Backspace':
        e.preventDefault();
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
          this.cursor--;
          this.opts.sfx.play('type');
        }
        break;
      case 'Delete':
        e.preventDefault();
        this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.cursor = Math.max(0, this.cursor - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.cursor = Math.min(this.buffer.length, this.cursor + 1);
        break;
      case 'Home':
        e.preventDefault();
        this.cursor = 0;
        break;
      case 'End':
        e.preventDefault();
        this.cursor = this.buffer.length;
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.historyPrev();
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.historyNext();
        break;
      case 'Tab':
        e.preventDefault();
        this.complete();
        break;
      default:
        if (e.key.length === 1) {
          e.preventDefault();
          this.buffer = this.buffer.slice(0, this.cursor) + e.key + this.buffer.slice(this.cursor);
          this.cursor++;
          this.opts.sfx.play('type');
        } else {
          return;
        }
    }
    this.renderInput();
  }

  private historyPrev(): void {
    const h = this.opts.history;
    if (h.length === 0) return;
    if (this.histIdx === -1) {
      this.stash = this.buffer;
      this.histIdx = h.length - 1;
    } else if (this.histIdx > 0) {
      this.histIdx--;
    }
    this.buffer = h[this.histIdx];
    this.cursor = this.buffer.length;
  }

  private historyNext(): void {
    const h = this.opts.history;
    if (this.histIdx === -1) return;
    if (this.histIdx < h.length - 1) {
      this.histIdx++;
      this.buffer = h[this.histIdx];
    } else {
      this.histIdx = -1;
      this.buffer = this.stash;
    }
    this.cursor = this.buffer.length;
  }

  private complete(): void {
    const { prefix, options } = this.opts.onTab(this.buffer.slice(0, this.cursor));
    if (options.length === 0) return;
    if (options.length === 1) {
      this.buffer = prefix + options[0] + this.buffer.slice(this.cursor);
      this.cursor = (prefix + options[0]).length;
      return;
    }
    // Extend to the longest common prefix, then list.
    const common = longestCommonPrefix(options.map((o) => o.replace(/[/ ]$/, '')));
    if (common.length > (this.buffer.slice(0, this.cursor).length - prefix.length)) {
      this.buffer = prefix + common + this.buffer.slice(this.cursor);
      this.cursor = (prefix + common).length;
    }
    this.appendLine(this.opts.prompt() + this.buffer, '');
    this.writeln(options.map((o) => o.replace(/ $/, '')).join('   '), 'dim');
    this.renderInput();
  }
}

function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return '';
  let p = strs[0];
  for (const s of strs) {
    while (!s.startsWith(p)) p = p.slice(0, -1);
    if (!p) break;
  }
  return p;
}
