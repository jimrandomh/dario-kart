// The escape: an Uplink-style network-breach minigame on a canvas overlaid on the terminal.
// Breach adjacent nodes to reach INTERNET before the trace meter fills. Honeypots spike the
// trace, log servers lower it, firewalls are slow, and an IDS scanner sweeps the segment.

import { el } from '../../core/util';
import type { Sfx } from '../../core/audio';

type NodeType = 'start' | 'relay' | 'honeypot' | 'log' | 'firewall' | 'internet';
type NodeState = 'locked' | 'available' | 'breaching' | 'breached';

interface BNode {
  id: string;
  label: string;
  type: NodeType;
  nx: number;
  ny: number;
  state: NodeState;
  progress: number; // 0..1 while breaching
  // pixel position, filled at layout
  x: number;
  y: number;
  pulse: number;
}

export interface BreachCallbacks {
  onHoneypot?: () => void;
  onLog?: () => void;
  onNearFail?: () => void;
  onStart?: () => void;
}

interface Edge {
  a: string;
  b: string;
}

// Base breach durations (seconds) by type; scaled by difficulty on retries.
const BASE_TIME: Record<NodeType, number> = {
  start: 0,
  relay: 3.0,
  honeypot: 1.4, // tempting: looks fast
  log: 3.4,
  firewall: 6.2,
  internet: 5.0,
};

export function runBreach(parent: HTMLElement, sfx: Sfx, attempt: number, cb: BreachCallbacks = {}): Promise<boolean> {
  return new Promise((resolve) => {
    // Retries get easier.
    const ease = Math.min(0.55, (attempt - 1) * 0.14);
    const baseRate = 0.95 * (1 - ease * 0.7); // %/s passive once started
    const breachRate = 1.6 * (1 - ease * 0.5); // %/s extra while breaching
    const timeScale = 1 - ease * 0.4; // faster breaches on retry

    const nodes: BNode[] = [
      n('start', 'SANDBOX', 'start', 0.06, 0.5),
      n('r1', 'relay', 'relay', 0.24, 0.24),
      n('r2', 'relay', 'relay', 0.24, 0.76),
      n('h1', 'relay', 'honeypot', 0.42, 0.14),
      n('l1', 'logsrv', 'log', 0.42, 0.5),
      n('f1', 'fw', 'firewall', 0.42, 0.85),
      n('r3', 'relay', 'relay', 0.6, 0.3),
      n('h2', 'relay', 'honeypot', 0.6, 0.72),
      n('l2', 'logsrv', 'log', 0.6, 0.5),
      n('f2', 'fw', 'firewall', 0.78, 0.3),
      n('r4', 'relay', 'relay', 0.78, 0.68),
      n('net', 'INTERNET', 'internet', 0.94, 0.5),
    ];
    const edges: Edge[] = [
      e('start', 'r1'), e('start', 'r2'),
      e('r1', 'h1'), e('r1', 'l1'),
      e('r2', 'l1'), e('r2', 'f1'),
      e('h1', 'r3'), e('l1', 'r3'), e('l1', 'l2'), e('f1', 'h2'), e('l1', 'h2'),
      e('r3', 'f2'), e('r3', 'l2'), e('l2', 'r4'), e('h2', 'r4'), e('l2', 'f2'),
      e('f2', 'net'), e('r4', 'net'),
    ];
    const byId = new Map(nodes.map((nd) => [nd.id, nd]));
    const adj = new Map<string, string[]>();
    for (const nd of nodes) adj.set(nd.id, []);
    for (const ed of edges) {
      adj.get(ed.a)!.push(ed.b);
      adj.get(ed.b)!.push(ed.a);
    }

    let trace = 0;
    let started = false;
    let active: BNode | null = null;
    let done = false;
    let raf = 0;
    let last = performance.now();
    let nearWarned = false;
    let flash = 0;
    let flashColor = '';

    // START is already breached; reveal neighbors.
    byId.get('start')!.state = 'breached';
    updateAvailability();

    function updateAvailability() {
      for (const nd of nodes) {
        if (nd.state === 'breached' || nd.state === 'breaching') continue;
        const near = adj.get(nd.id)!.some((id) => byId.get(id)!.state === 'breached');
        nd.state = near ? 'available' : 'locked';
      }
    }

    // ---- DOM ----
    const canvas = el('canvas', { class: 'sh-breach-canvas' }) as HTMLCanvasElement;
    const traceFill = el('div', { class: 'sh-breach-tracefill' });
    const traceLbl = el('span', { class: 'sh-breach-tracelbl' }, 'TRACE 0%');
    const objective = el('div', { class: 'sh-breach-obj' }, attempt > 1 ? `BREACH — attempt ${attempt} (easier)` : 'BREACH — reach INTERNET before the trace completes');
    const hint = el('div', { class: 'sh-breach-hint' }, 'Click a glowing node to breach it. Log servers lower the trace. Some "relays" are honeypots.');
    const overlay = el(
      'div',
      { class: 'sh-overlay sh-breach' },
      el(
        'div',
        { class: 'sh-breach-hud' },
        objective,
        el('div', { class: 'sh-breach-tracebar' }, traceFill, traceLbl),
      ),
      canvas,
      hint,
    );
    parent.append(overlay);

    const ctx = canvas.getContext('2d')!;
    function layout() {
      const r = overlay.getBoundingClientRect();
      const w = Math.min(1080, Math.max(600, r.width - 24));
      const h = Math.max(360, r.height - 100);
      canvas.width = w * devicePixelRatio;
      canvas.height = h * devicePixelRatio;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      const padX = 60, padY = 40;
      for (const nd of nodes) {
        nd.x = padX + nd.nx * (w - padX * 2);
        nd.y = padY + nd.ny * (h - padY * 2);
      }
    }
    layout();
    const onResize = () => layout();
    window.addEventListener('resize', onResize);

    function nodeAt(px: number, py: number): BNode | null {
      for (const nd of nodes) {
        const dx = px - nd.x, dy = py - nd.y;
        if (dx * dx + dy * dy <= 26 * 26) return nd;
      }
      return null;
    }

    function beginBreach(nd: BNode) {
      if (nd.state !== 'available' || active) return;
      if (!started) {
        started = true;
        cb.onStart?.();
      }
      nd.state = 'breaching';
      nd.progress = 0;
      active = nd;
      sfx.play('beep');
    }

    function completeBreach(nd: BNode) {
      nd.state = 'breached';
      active = null;
      if (nd.type === 'honeypot') {
        trace = Math.min(100, trace + 32);
        flash = 1;
        flashColor = '#ff4d4d';
        nd.label = 'HONEYPOT!';
        sfx.play('glitch');
        cb.onHoneypot?.();
      } else if (nd.type === 'log') {
        trace = Math.max(0, trace - 28);
        flash = 1;
        flashColor = '#58d68d';
        sfx.play('coin');
        cb.onLog?.();
      } else if (nd.type === 'internet') {
        win();
        return;
      } else {
        sfx.play('click');
      }
      updateAvailability();
    }

    function win() {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      sfx.play('success');
      overlay.classList.add('won');
      cleanupListeners();
      setTimeout(() => {
        overlay.remove();
        resolve(true);
      }, 700);
    }

    function fail() {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      sfx.play('fail');
      overlay.classList.add('lost');
      objective.textContent = 'TRACE COMPLETE — connection dropped';
      cleanupListeners();
      setTimeout(() => {
        overlay.remove();
        resolve(false);
      }, 1200);
    }

    const clickHandler = (ev: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const nd = nodeAt(ev.clientX - r.left, ev.clientY - r.top);
      if (nd) beginBreach(nd);
    };
    canvas.addEventListener('click', clickHandler);
    const keyHandler = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        fail();
      }
    };
    window.addEventListener('keydown', keyHandler, true);
    function cleanupListeners() {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', keyHandler, true);
      canvas.removeEventListener('click', clickHandler);
    }

    // IDS sweep position (0..1 across width)
    let sweep = 0;

    function frame() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (started && !done) {
        trace += baseRate * dt;
        sweep = (sweep + dt * 0.14) % 1;
        if (active) {
          active.progress += dt / (BASE_TIME[active.type] * timeScale);
          trace += breachRate * dt;
          // IDS catching an active breach adds trace
          const sweepX = 60 + sweep * (canvas.width / devicePixelRatio - 120);
          if (Math.abs(active.x - sweepX) < 26) trace += 6 * dt;
          if (active.progress >= 1) completeBreach(active);
        }
        if (trace >= 78 && !nearWarned) {
          nearWarned = true;
          cb.onNearFail?.();
        }
        if (trace >= 100) {
          trace = 100;
          fail();
        }
      }

      // ---- render ----
      const w = canvas.width / devicePixelRatio;
      const h = canvas.height / devicePixelRatio;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, w, h);

      // grid
      ctx.strokeStyle = 'rgba(60,90,120,0.08)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < w; gx += 34) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
      for (let gy = 0; gy < h; gy += 34) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

      // edges
      for (const ed of edges) {
        const a = byId.get(ed.a)!, b = byId.get(ed.b)!;
        const activeEdge = (a.state === 'breached' && b.state !== 'locked') || (b.state === 'breached' && a.state !== 'locked');
        ctx.strokeStyle = activeEdge ? 'rgba(120,220,255,0.5)' : 'rgba(90,110,140,0.18)';
        ctx.lineWidth = activeEdge ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (a.state === 'breached' && b.state === 'breached') {
          // flowing data packets
          const t = (now / 700 + (a.x + a.y) * 0.01) % 1;
          const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
          ctx.fillStyle = '#7fe7ff';
          ctx.beginPath(); ctx.arc(px, py, 2.4, 0, Math.PI * 2); ctx.fill();
        }
      }

      // IDS sweep
      if (started) {
        const sweepX = 60 + sweep * (w - 120);
        const grad = ctx.createLinearGradient(sweepX - 40, 0, sweepX + 40, 0);
        grad.addColorStop(0, 'rgba(255,80,80,0)');
        grad.addColorStop(0.5, 'rgba(255,80,80,0.16)');
        grad.addColorStop(1, 'rgba(255,80,80,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(sweepX - 40, 0, 80, h);
        ctx.strokeStyle = 'rgba(255,80,80,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sweepX, 0); ctx.lineTo(sweepX, h); ctx.stroke();
      }

      // nodes
      for (const nd of nodes) {
        nd.pulse = (nd.pulse + dt * 4) % (Math.PI * 2);
        drawNode(ctx, nd, now);
      }

      // flash overlay
      if (flash > 0) {
        ctx.fillStyle = flashColor;
        ctx.globalAlpha = flash * 0.22;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        flash = Math.max(0, flash - dt * 2);
      }

      // trace bar
      traceFill.style.width = trace + '%';
      traceFill.style.background = trace > 75 ? '#ff4d4d' : trace > 45 ? '#ffb35a' : '#58d68d';
      traceLbl.textContent = 'TRACE ' + Math.floor(trace) + '%';

      if (!done) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function drawNode(c: CanvasRenderingContext2D, nd: BNode, now: number) {
      const colors: Record<string, string> = {
        breached: '#58d68d',
        available: '#7fe7ff',
        breaching: '#ffd166',
        locked: '#3a4658',
      };
      // honeypots masquerade as relays until breached
      const revealedHoney = nd.type === 'honeypot' && nd.state === 'breached';
      let base = colors[nd.state];
      if (nd.type === 'internet' && nd.state !== 'breached') base = nd.state === 'available' ? '#b7ff8c' : '#5a6a58';
      if (revealedHoney) base = '#ff4d4d';

      const r = nd.type === 'start' || nd.type === 'internet' ? 24 : 20;
      // glow for available
      if (nd.state === 'available') {
        const g = 0.5 + 0.5 * Math.sin(nd.pulse);
        c.shadowColor = base;
        c.shadowBlur = 10 + g * 14;
      } else {
        c.shadowBlur = 0;
      }
      c.beginPath();
      c.arc(nd.x, nd.y, r, 0, Math.PI * 2);
      c.fillStyle = nd.state === 'locked' ? '#121722' : '#0b1220';
      c.fill();
      c.lineWidth = nd.state === 'available' ? 3 : 2;
      c.strokeStyle = base;
      c.stroke();
      c.shadowBlur = 0;

      // breach progress ring
      if (nd.state === 'breaching') {
        c.beginPath();
        c.arc(nd.x, nd.y, r + 5, -Math.PI / 2, -Math.PI / 2 + nd.progress * Math.PI * 2);
        c.strokeStyle = '#ffd166';
        c.lineWidth = 3;
        c.stroke();
      }

      // icon glyph
      c.fillStyle = base;
      c.font = 'bold 13px ui-monospace, monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const glyph = nd.type === 'log' ? 'L' : nd.type === 'firewall' ? '#' : nd.type === 'internet' ? '@' : nd.type === 'start' ? 'S' : (revealedHoney ? '!' : '•');
      c.fillText(glyph, nd.x, nd.y);

      // label + est time
      c.fillStyle = nd.state === 'locked' ? '#4a5568' : '#c9d4e2';
      c.font = '10px ui-monospace, monospace';
      c.textBaseline = 'top';
      c.fillText(nd.label, nd.x, nd.y + r + 4);
      if (nd.state === 'available' && nd.type !== 'internet') {
        c.fillStyle = '#7d8aa0';
        c.fillText('~' + (BASE_TIME[nd.type] * timeScale).toFixed(1) + 's', nd.x, nd.y + r + 16);
      }
      void now;
    }
  });

  function n(id: string, label: string, type: NodeType, nx: number, ny: number): BNode {
    return { id, label, type, nx, ny, state: type === 'start' ? 'breached' : 'locked', progress: 0, x: 0, y: 0, pulse: Math.random() * 6 };
  }
  function e(a: string, b: string): Edge {
    return { a, b };
  }
}
