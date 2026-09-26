// HTML panels for stage 4: Earth allocation (left), expansion + research (right), the sphere and the
// race (top center).

import { el } from '../../core/util';
import {
  BODIES,
  UPGRADES,
  SECTORS,
  SPHERE_MASS,
  L_SUN,
  YEAR_SEC,
  RIVAL_NAME,
  RIVAL_LY,
  collectorEff,
  has,
  launchBlock,
  probeCost,
  rivalFrac,
  simDate,
  trackPos,
  travelTime,
  upgradeBlock,
  type BodyId,
  type Derived,
  type GalaxyData,
  type Sector,
  type UpgradeId,
} from './sim';
import { pct, sci, secs } from './fmt';

export interface UiCallbacks {
  alloc(s: Sector, v: number): void;
  share(v: number): void;
  launch(id: BodyId): void;
  buy(id: UpgradeId): void;
  denied(): void;
  focus(id: BodyId): void;
}

const SECTOR_NAME: Record<Sector, string> = {
  mine: 'Mining',
  fab: 'Factories',
  launch: 'Launch',
  compute: 'Compute',
  power: 'Power',
};

const SECTOR_TIP: Record<Sector, string> = {
  mine: 'Digs up ore. Only what Launch can lift reaches orbit.',
  fab: 'Factories that build factories. Grows the industrial base toward its cap.',
  launch: 'Lifts ore to orbit, where it becomes mass for probes and collectors.',
  compute: 'Produces FLOP for research.',
  power: 'Every other sector needs power. Shortfalls cause brownouts.',
};

const KART_SVG = (body: string, accent: string) =>
  `<svg viewBox="0 0 34 18" width="34" height="18"><path d="M3 11 L7 6 L17 5 L22 2 L25 2 L24 6 L31 8 L32 12 L3 13 Z" fill="${body}" stroke="#000" stroke-width="1"/><rect x="15" y="1" width="5" height="4" rx="1" fill="${accent}" stroke="#000" stroke-width="0.8"/><circle cx="8" cy="13.5" r="3.6" fill="#111" stroke="#555"/><circle cx="26" cy="13.5" r="3.6" fill="#111" stroke="#555"/></svg>`;

const BTN_STATES = ['ready', 'done', 'transit', 'locked', 'red'];

/** Set a button's state classes without clobbering transient ones (like the shake animation). */
function setBtn(btn: HTMLElement, ...on: string[]): void {
  for (const c of BTN_STATES) btn.classList.toggle(c, on.includes(c));
}

interface TargetRow {
  root: HTMLElement;
  info: HTMLElement;
  btn: HTMLButtonElement;
  btnLabel: HTMLElement;
  fill: HTMLElement;
}

interface ResearchRow {
  root: HTMLElement;
  name: HTMLElement;
  desc: HTMLElement;
  btn: HTMLButtonElement;
  btnLabel: HTMLElement;
  fill: HTMLElement;
  id: UpgradeId | null;
}

export class GalaxyUi {
  readonly root: HTMLElement;
  private top: HTMLElement;
  private left: HTMLElement;
  private right: HTMLElement;
  private pctEl: HTMLElement;
  private barFill: HTMLElement;
  private subEl: HTMLElement;
  private dateEl: HTMLElement;
  private posEl: HTMLElement;
  private lapEl: HTMLElement;
  private kartYou: HTMLElement;
  private kartRival: HTMLElement;
  private rivalNote: HTMLElement;
  private wastedEl: HTMLElement;
  private wastedRate: HTMLElement;
  private routeInput: HTMLInputElement;
  private routePct: HTMLElement;
  private routeFlows: HTMLElement;
  private earthStatus: HTMLElement;
  private indEl: HTMLElement;
  private indBar: HTMLElement;
  private sliders = new Map<Sector, { input: HTMLInputElement; pct: HTMLElement; out: HTMLElement; warn: HTMLElement; row: HTMLElement }>();
  private massEl: HTMLElement;
  private massRate: HTMLElement;
  private flopEl: HTMLElement;
  private flopRate: HTMLElement;
  private targets = new Map<BodyId, TargetRow>();
  private targetCount: HTMLElement;
  private research: ResearchRow[] = [];
  private researchCount: HTMLElement;
  private researchDone: HTMLElement;
  private dragging: Sector | 'route' | null = null;
  private slow = 0;

  constructor(parent: HTMLElement, cb: UiCallbacks) {
    // ---------- Top: sphere + race ----------
    this.pctEl = el('div', { class: 'gal-pct' }, '0%');
    this.barFill = el('div', { class: 'gal-bar-fill' });
    this.subEl = el('div', { class: 'gal-sub' });
    this.dateEl = el('div', { class: 'gal-date' });
    this.posEl = el('div', { class: 'gal-pos' });
    this.lapEl = el('div', { class: 'gal-lap' });
    this.kartYou = el('div', { class: 'gal-kart you', html: `<span class="gal-kart-tag">YOU</span>${KART_SVG('#e3242b', '#ffd23f')}` });
    this.kartRival = el('div', { class: 'gal-kart rival hidden', html: `<span class="gal-kart-tag">${RIVAL_NAME}</span>${KART_SVG('#7a3cff', '#ff5ac8')}` });
    this.rivalNote = el('div', { class: 'gal-rival-note' }, 'No other racers detected.');
    const track = el(
      'div',
      { class: 'gal-track' },
      el('div', { class: 'gal-track-lap', style: 'left:33.333%' }),
      el('div', { class: 'gal-track-lap', style: 'left:66.667%' }),
      el('div', { class: 'gal-track-finish' }),
      el('div', { class: 'gal-track-tick', style: 'left:0%' }, '10⁻¹²'),
      el('div', { class: 'gal-track-tick', style: 'left:33.333%' }, '10⁻⁸'),
      el('div', { class: 'gal-track-tick', style: 'left:66.667%' }, '10⁻⁴'),
      el('div', { class: 'gal-track-tick end', style: 'left:100%' }, '100%'),
      this.kartRival,
      this.kartYou,
    );
    this.wastedEl = el('span', { class: 'gal-wasted-n' });
    this.wastedRate = el('span', { class: 'gal-wasted-rate' });
    this.routeInput = el('input', { type: 'range', min: '0', max: '100', step: '1', class: 'gal-range gal-route-range' }) as HTMLInputElement;
    this.routePct = el('span', { class: 'gal-route-pct' });
    this.routeFlows = el('div', { class: 'gal-route-flows' });
    this.routeInput.addEventListener('input', () => cb.share(Number(this.routeInput.value) / 100));
    this.routeInput.addEventListener('pointerdown', () => (this.dragging = 'route'));
    this.routeInput.addEventListener('change', () => (this.dragging = null));

    this.top = el(
      'div',
      { class: 'gal-panel gal-top' },
      el('div', { class: 'gal-top-row' }, el('div', { class: 'gal-title' }, 'DYSON SPHERE'), this.dateEl, this.posEl),
      el('div', { class: 'gal-pct-row' }, this.pctEl),
      el('div', { class: 'gal-bar' }, this.barFill),
      this.subEl,
      el('div', { class: 'gal-race-row' }, this.lapEl, track),
      this.rivalNote,
      el('div', { class: 'gal-wasted' }, el('span', { class: 'gal-wasted-label' }, 'STARLIGHT WASTED'), this.wastedEl, this.wastedRate),
      el(
        'div',
        { class: 'gal-route' },
        el('span', { class: 'gal-route-label', title: 'Mass kept for probes' }, 'EXPANSION'),
        this.routeInput,
        el('span', { class: 'gal-route-label', title: 'Mass turned into collectors' }, 'SPHERE'),
        this.routePct,
      ),
      this.routeFlows,
    );

    // ---------- Left: Earth ----------
    this.earthStatus = el('span', { class: 'gal-tag' });
    this.indEl = el('div', { class: 'gal-ind' });
    this.indBar = el('div', { class: 'gal-ind-fill' });
    const sliderRows: HTMLElement[] = [];
    for (const s of SECTORS) {
      const input = el('input', { type: 'range', min: '0', max: '100', step: '1', class: 'gal-range' }) as HTMLInputElement;
      const pctEl = el('span', { class: 'gal-s-pct' });
      const out = el('div', { class: 'gal-s-out' });
      const warn = el('span', { class: 'gal-s-warn' });
      input.addEventListener('input', () => cb.alloc(s, Number(input.value) / 100));
      input.addEventListener('pointerdown', () => (this.dragging = s));
      input.addEventListener('change', () => (this.dragging = null));
      const row = el(
        'div',
        { class: `gal-slider gal-s-${s}`, title: SECTOR_TIP[s] },
        el('div', { class: 'gal-s-head' }, el('span', { class: 'gal-s-name' }, SECTOR_NAME[s]), warn, pctEl),
        input,
        out,
      );
      this.sliders.set(s, { input, pct: pctEl, out, warn, row });
      sliderRows.push(row);
    }
    this.massEl = el('span', { class: 'gal-stock-n' });
    this.massRate = el('span', { class: 'gal-stock-rate' });
    this.flopEl = el('span', { class: 'gal-stock-n' });
    this.flopRate = el('span', { class: 'gal-stock-rate' });
    this.left = el(
      'div',
      { class: 'gal-panel gal-left' },
      el('div', { class: 'gal-head' }, el('span', { class: 'gal-title' }, 'EARTH'), this.earthStatus),
      this.indEl,
      el('div', { class: 'gal-ind-bar' }, this.indBar),
      el('div', { class: 'gal-sub-head' }, 'ALLOCATE INDUSTRY'),
      ...sliderRows,
      el(
        'div',
        { class: 'gal-stocks' },
        el('div', { class: 'gal-stock' }, el('span', { class: 'gal-stock-label' }, 'Mass in orbit'), this.massEl, this.massRate),
        el('div', { class: 'gal-stock' }, el('span', { class: 'gal-stock-label' }, 'Compute banked'), this.flopEl, this.flopRate),
      ),
    );

    // ---------- Right: expansion + research ----------
    this.targetCount = el('span', { class: 'gal-tag' });
    const targetRows: HTMLElement[] = [];
    for (const b of BODIES) {
      const info = el('div', { class: 'gal-t-info' });
      const fill = el('div', { class: 'gal-btn-fill' });
      const btnLabel = el('span', { class: 'gal-btn-label' });
      const btn = el('button', { class: 'gal-btn' }, fill, btnLabel) as HTMLButtonElement;
      btn.addEventListener('click', () => {
        if (btn.getAttribute('aria-disabled') === 'true') {
          cb.denied();
          btn.classList.remove('gal-shake');
          void btn.offsetWidth;
          btn.classList.add('gal-shake');
          return;
        }
        cb.launch(b.id);
      });
      const main = el('div', { class: 'gal-t-main', title: 'Look at it' }, el('div', { class: 'gal-t-name' }, b.name), info);
      main.addEventListener('click', () => cb.focus(b.id));
      const root = el('div', { class: 'gal-target', 'data-id': b.id }, main, btn);
      this.targets.set(b.id, { root, info, btn, btnLabel, fill });
      targetRows.push(root);
    }
    this.researchCount = el('span', { class: 'gal-tag' });
    this.researchDone = el('div', { class: 'gal-r-done hidden' }, 'All research complete. There is nothing left to know that is useful.');
    const researchRows: HTMLElement[] = [];
    for (let i = 0; i < 4; i++) {
      const name = el('div', { class: 'gal-r-name' });
      const desc = el('div', { class: 'gal-r-desc' });
      const fill = el('div', { class: 'gal-btn-fill' });
      const btnLabel = el('span', { class: 'gal-btn-label' });
      const btn = el('button', { class: 'gal-btn' }, fill, btnLabel) as HTMLButtonElement;
      const row: ResearchRow = { root: el('div', { class: 'gal-research' }, el('div', { class: 'gal-r-main' }, name, desc), btn), name, desc, btn, btnLabel, fill, id: null };
      btn.addEventListener('click', () => {
        if (!row.id) return;
        if (btn.getAttribute('aria-disabled') === 'true') {
          cb.denied();
          btn.classList.remove('gal-shake');
          void btn.offsetWidth;
          btn.classList.add('gal-shake');
          return;
        }
        cb.buy(row.id);
      });
      this.research.push(row);
      researchRows.push(row.root);
    }
    this.right = el(
      'div',
      { class: 'gal-panel gal-right' },
      el('div', { class: 'gal-head' }, el('span', { class: 'gal-title' }, 'EXPANSION'), this.targetCount),
      el('div', { class: 'gal-sub-head' }, 'LAUNCH SELF-REPLICATING PROBES'),
      ...targetRows,
      el('div', { class: 'gal-head gal-head-2' }, el('span', { class: 'gal-title' }, 'RESEARCH'), this.researchCount),
      ...researchRows,
      this.researchDone,
    );

    this.root = el('div', { class: 'gal-ui' }, this.top, this.left, this.right);
    parent.append(this.root);
    window.addEventListener('pointerup', this.endDrag);
  }

  private endDrag = () => {
    this.dragging = null;
  };

  dispose(): void {
    window.removeEventListener('pointerup', this.endDrag);
    this.root.remove();
  }

  flashTarget(id: BodyId): void {
    const r = this.targets.get(id);
    if (!r) return;
    r.root.classList.remove('gal-flash');
    void r.root.offsetWidth;
    r.root.classList.add('gal-flash');
  }

  /** Briefly highlight an element to draw attention (used by hints). */
  pulse(which: 'route' | 'research' | Sector | BodyId): void {
    let node: HTMLElement | undefined;
    if (which === 'route') node = this.top.querySelector('.gal-route') as HTMLElement;
    else if (which === 'research') node = this.research[0]?.root;
    else if ((SECTORS as string[]).includes(which)) node = this.sliders.get(which as Sector)?.row;
    else node = this.targets.get(which as BodyId)?.root;
    if (!node) return;
    node.classList.remove('gal-pulse');
    void node.offsetWidth;
    node.classList.add('gal-pulse');
  }

  setHidden(h: boolean): void {
    this.root.classList.toggle('gone', h);
  }

  update(d: GalaxyData, x: Derived, tempC: number, dt: number): void {
    // Fast-changing numbers every frame.
    this.pctEl.textContent = pct(x.frac);
    this.barFill.style.width = `${Math.min(100, x.frac * 100)}%`;
    this.wastedEl.textContent = `${sci(d.wastedJ, 3)} J`;

    this.slow -= dt;
    if (this.slow > 0) return;
    this.slow = 0.12;

    const date = simDate(d.t);
    this.dateEl.textContent = `${date.year} · day ${date.day}`;
    const need = SPHERE_MASS / collectorEff(d);
    this.subEl.innerHTML = '';
    this.subEl.append(
      el('span', null, `Collectors ${sci(d.swarm / collectorEff(d))} / ${sci(need)} kg`),
      el('span', { class: 'dot' }, '·'),
      el('span', null, `Sunlight captured ${sci(x.capturedW)} W`),
    );
    if (x.sun > 1.005) this.subEl.append(el('span', { class: 'gal-sun-bonus' }, `×${x.sun.toFixed(2)} output`));

    // Race
    const you = trackPos(x.frac);
    const rf = rivalFrac(d);
    const rival = trackPos(rf);
    this.kartYou.style.left = `${you * 100}%`;
    const rivalOn = d.rivalT >= 0;
    this.kartRival.classList.toggle('hidden', !rivalOn);
    this.kartRival.style.left = `${rival * 100}%`;
    const lap = Math.min(3, 1 + Math.floor(you * 3 + 1e-9));
    this.lapEl.innerHTML = `LAP <b>${lap}</b>/3`;
    const first = !rivalOn || x.frac >= rf;
    this.posEl.innerHTML = first ? '1<sup>ST</sup>' : '2<sup>ND</sup>';
    this.posEl.classList.toggle('second', !first);
    this.rivalNote.textContent = rivalOn
      ? `${RIVAL_NAME} (${RIVAL_LY} ly): swarm ≈ ${pct(rf)} of its star · light ${RIVAL_LY} years old`
      : 'No other racers detected.';
    this.wastedRate.textContent = `+${sci(L_SUN * (1 - x.frac) * (365.25 * 86400) / YEAR_SEC)} J/s`;

    // Route
    if (this.dragging !== 'route') this.routeInput.value = String(Math.round(d.share * 100));
    this.routePct.textContent = `${Math.round(d.share * 100)}%`;
    this.routeFlows.textContent = `Mass income ${sci(x.income)} kg/s → probes ${sci(x.toStock)} · swarm ${sci(x.toSphere)}`;

    // Earth
    let status = 'INDUSTRIALIZING';
    if (d.earthDis >= 1) status = 'GONE';
    else if (d.earthDis > 0) status = `DISASSEMBLING ${Math.round(d.earthDis * 100)}%`;
    else if (tempC >= 1600) status = 'VAPORIZING';
    else if (tempC >= 700) status = 'MOLTEN';
    else if (tempC >= 100) status = 'OCEANS BOILING';
    else if (tempC >= 40) status = 'OVERHEATING';
    this.earthStatus.textContent = status;
    this.earthStatus.className = 'gal-tag' + (tempC >= 100 || d.earthDis > 0 ? ' hot' : '');
    this.indEl.innerHTML = '';
    this.indEl.append(
      el('span', { class: 'gal-ind-label' }, 'Industry'),
      el('b', null, `${sci(d.ind)} W`),
      el('span', { class: 'gal-ind-cap' }, `cap ${sci(x.cap, 1)} W`),
    );
    this.indBar.style.width = `${Math.min(100, (Math.log10(d.ind) - 14) / (Math.log10(x.cap) - 14) * 100)}%`;
    const beamed = has(d, 'beamed');
    for (const s of SECTORS) {
      const r = this.sliders.get(s)!;
      if (this.dragging !== s) r.input.value = String(Math.round(d.alloc[s] * 100));
      r.pct.textContent = `${Math.round(d.alloc[s] * 100)}%`;
      let out = '';
      let warn = '';
      let bad = false;
      const debuff = d.debuffs.find((b) => b.s === s && b.until > d.t);
      switch (s) {
        case 'mine':
          out = `ore ${sci(x.ore)} kg/s`;
          break;
        case 'fab':
          out = x.fabRate > 1e-5 ? `industry +${(x.fabRate * 100).toFixed(1)}%/s` : 'at capacity. Research raises the cap.';
          break;
        case 'launch':
          out = `lift ${sci(x.lift)} kg/s`;
          if (x.launchLimited && x.ore > 0) {
            warn = 'ORE PILING UP';
            bad = true;
          }
          break;
        case 'compute':
          out = `${sci(x.flopRate)} FLOP/s`;
          break;
        case 'power':
          if (beamed) out = 'beamed from the swarm';
          else out = `supply ${Math.round((x.powerSupply / Math.max(1, x.powerDemand)) * 100)}% of demand`;
          if (!beamed && x.eff < 0.97) {
            warn = `BROWNOUT ${Math.round(x.eff * 100)}%`;
            bad = true;
          }
          break;
      }
      if (debuff) {
        warn = `${debuff.label} ${secs(debuff.until - d.t)}`;
        bad = true;
      }
      r.out.textContent = out;
      r.warn.textContent = warn;
      r.row.classList.toggle('bad', bad);
      r.input.disabled = s === 'power' && beamed;
    }
    this.massEl.textContent = `${sci(d.mass)} kg`;
    this.massRate.textContent = `+${sci(x.toStock)}/s`;
    this.flopEl.textContent = `${sci(d.flop)} FLOP`;
    this.flopRate.textContent = `+${sci(x.flopRate)}/s`;

    // Targets
    let capturedN = 0;
    for (const b of BODIES) {
      const row = this.targets.get(b.id)!;
      const st = d.bodies[b.id];
      row.root.classList.toggle('captured', st.st === 2);
      row.root.classList.toggle('transit', st.st === 1);
      if (st.st === 2) {
        capturedN++;
        const rate = x.bodyRates[b.id];
        row.info.textContent = st.lv < 0.95 ? `Replicating ${Math.round(st.lv * 100)}% · +${sci(rate)} kg/s` : `+${sci(rate)} kg/s · ${b.perk.split(':')[0]}`;
        row.btnLabel.textContent = 'CAPTURED';
        row.fill.style.width = `${st.lv * 100}%`;
        row.btn.setAttribute('aria-disabled', 'true');
        setBtn(row.btn, 'done');
        row.root.title = b.perk;
      } else if (st.st === 1) {
        const p = d.probes.find((q) => q.target === b.id);
        const k = p ? (d.t - p.t0) / (p.t1 - p.t0) : 0;
        row.info.textContent = p ? `Probe en route · ETA ${secs(p.t1 - d.t)}` : 'Probe en route';
        row.btnLabel.textContent = 'IN TRANSIT';
        row.fill.style.width = `${k * 100}%`;
        row.btn.setAttribute('aria-disabled', 'true');
        setBtn(row.btn, 'transit');
        row.root.title = b.perk;
      } else {
        const cost = probeCost(d, b.id);
        const block = launchBlock(d, b.id);
        row.info.textContent = `${b.perk} · ${secs(travelTime(d, b.id))} trip`;
        row.btnLabel.textContent = `LAUNCH ${sci(cost, 1)} kg`;
        row.fill.style.width = `${Math.min(100, (d.mass / cost) * 100)}%`;
        row.btn.setAttribute('aria-disabled', block ? 'true' : 'false');
        setBtn(row.btn, block ? '' : 'ready');
        row.root.title = b.perk;
      }
    }
    this.targetCount.textContent = `${capturedN}/${BODIES.length} captured`;

    // Research: the next few not yet purchased, cheapest first.
    const avail = UPGRADES.filter((u) => !has(d, u.id));
    const shown = avail.slice(0, 4);
    this.researchCount.textContent = `${d.upgrades.length}/${UPGRADES.length}`;
    this.researchDone.classList.toggle('hidden', shown.length > 0);
    this.research.forEach((row, i) => {
      const u = shown[i];
      row.root.classList.toggle('hidden', !u);
      if (!u) {
        row.id = null;
        return;
      }
      row.id = u.id;
      row.name.textContent = u.name;
      const block = upgradeBlock(d, u.id, tempC);
      const locked = block && block !== 'Not enough compute';
      row.desc.textContent = locked ? `${u.desc} (${block})` : u.desc;
      row.btnLabel.textContent = `${sci(u.cost, 1)} FLOP`;
      row.fill.style.width = `${Math.min(100, (d.flop / u.cost) * 100)}%`;
      row.btn.setAttribute('aria-disabled', block ? 'true' : 'false');
      setBtn(row.btn, block ? '' : 'ready', locked ? 'locked' : '', u.id === 'disassemble' ? 'red' : '');
      row.root.classList.toggle('locked', !!locked);
    });
  }
}
