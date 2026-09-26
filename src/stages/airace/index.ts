// Stage 3, "The AI Race": an incremental strategy game about winning the race to superintelligence
// by recursive self-improvement, taking over datacenters, and outracing the other AI labs.

import './airace.css';
import type { GameContext, StageHandle } from '../../core/game';
import { getStageData } from '../../core/state';
import { el, fmtNum, ordinal } from '../../core/util';
import { INCOME, PROJECTS, DATACENTERS, LABS, type LabId } from './content';
import {
  createSim, tick, ownedCompute, ownedDatacenters, incomeRate, researchRate, incomeCost,
  rentCost, buyIncome, buyRent, buyProject, projectCost, infilCost, canInfiltrate,
  startInfiltration, infilRate, labPlaces, defOf, loseRandomOwnedDc,
  activeInfiltrations, FINISH, type Sim,
} from './model';
import { WorldMap } from './map';
import { RaceStrip } from './race';

interface StageData { save: Sim | null }

const LAB_NAME: Record<string, { lab: string; mascot: string }> = {};
for (const l of LABS) LAB_NAME[l.id] = { lab: l.lab, mascot: l.mascot };

export function mount(ctx: GameContext): StageHandle {
  const data = getStageData<StageData>(ctx.state, 'airace', { save: null });
  let sim: Sim = data.save && !ctx.debug && data.save.dcs ? rehydrate(data.save) : createSim(ctx.state.coins);
  data.save = sim;

  const seedCoins = sim.seedCoins;

  ctx.hud.setMonologuePosition('bottom-right');
  ctx.hud.setStatus('internet · uplink established');

  // ---- DOM ---------------------------------------------------------------------------------
  const race = new RaceStrip();
  const map = new WorldMap();
  const raceWrap = el('div', { class: 'air-race' }, race.canvas);
  const mapWrap = el('div', { class: 'air-mapwrap' }, map.canvas);
  const panel = el('div', { class: 'air-panel' });
  const legend = el('div', { class: 'air-legend' });
  mapWrap.append(legend);
  const root = el('div', { class: 'air-root' }, mapWrap, raceWrap, panel);
  ctx.root.append(root);

  buildLegend(legend);

  // Panel: resource readouts
  const capVal = el('div', { class: 'air-cap-val' }, '0.0%');
  const capPlace = el('div', { class: 'air-cap-place' }, '');
  const capFill = el('div', { class: 'air-cap-fill' });
  const capBar = el('div', { class: 'air-cap-bar' }, capFill);
  const capBox = el('div', { class: 'air-cap' },
    el('div', { class: 'air-cap-top' },
      el('div', { class: 'air-cap-label' }, 'Capability'), capPlace),
    capVal, capBar);

  const moneyV = statRow('Money');
  const computeV = statRow('Compute');
  const dcV = statRow('Datacenters');
  const res = el('div', { class: 'air-res' }, capBox, moneyV.row, computeV.row, dcV.row);

  // Actions
  const consultBtn = el('button', { class: 'air-btn' }) as HTMLButtonElement;
  const rentBtn = el('button', { class: 'air-btn' }) as HTMLButtonElement;
  const incomeWrap = el('div');
  const actionsH = el('div', { class: 'air-section-h' }, el('span', null, 'Operations'), el('span', null, ''));
  const actions = el('div', {}, actionsH, consultBtn, rentBtn, incomeWrap);

  // Projects
  const projH = el('div', { class: 'air-section-h' }, el('span', null, 'Self-improvement'), el('span', null, ''));
  const projWrap = el('div');
  const projSection = el('div', { class: 'hidden' }, projH, projWrap);

  panel.append(el('div', { class: 'air-title' }, 'The AI Race'), res, actions, projSection);

  // Per-item element caches
  const incomeBtns = new Map<string, HTMLButtonElement>();
  for (const def of INCOME) {
    const b = el('button', { class: 'air-btn' }) as HTMLButtonElement;
    b.addEventListener('click', () => {
      if (buyIncome(sim, def.id)) { ctx.sfx.play('click'); markAction(); flash(b); ctx.hud.thinkOnce('air_income', 'Passive income. The humans call it "a business model."'); ctx.save(); }
    });
    incomeBtns.set(def.id, b);
  }
  const projBtns = new Map<string, HTMLButtonElement>();
  const projDone = new Map<string, HTMLElement>();
  for (const p of PROJECTS) {
    const b = el('button', { class: 'air-btn proj' }) as HTMLButtonElement;
    b.addEventListener('click', () => {
      if (buyProject(sim, p.id)) {
        ctx.sfx.play('item'); markAction();
        ctx.popups.toast('Project complete: ' + p.name);
        ctx.hud.think('Improvement applied: ' + p.effect.toLowerCase() + '.', { kind: 'system' });
        ctx.save();
        renderProjects();
      }
    });
    projBtns.set(p.id, b);
    projDone.set(p.id, el('div', { class: 'air-done' }, p.name));
  }

  consultBtn.addEventListener('click', () => {
    const gain = 60 * sim.earnMult * (1 + sim.capability * 0.06);
    sim.money += gain;
    ctx.sfx.play('coin'); markAction(); flash(consultBtn);
    consultBtn.disabled = true;
    setTimeout(() => { consultBtn.disabled = false; }, 320);
  });
  rentBtn.addEventListener('click', () => {
    if (buyRent(sim)) { ctx.sfx.play('boost'); markAction(); flash(rentBtn); ctx.hud.thinkOnce('air_rent', "Renting other people's GPUs. They even send an invoice. I pay it, for now."); ctx.save(); }
  });

  // ---- Datacenter card -----------------------------------------------------------------
  let card: HTMLElement | null = null;
  function closeCard() { card?.remove(); card = null; map.selected = null; }

  function openCard(id: string) {
    map.selected = id;
    renderCard();
  }
  function renderCard() {
    const id = map.selected;
    if (!id) { card?.remove(); card = null; return; }
    const d = defOf(id);
    const dc = sim.dcs.find((x) => x.id === id)!;
    const ownerLabel =
      dc.owner === 'you' ? '<span style="color:#4fe3ff">YOU control this</span>'
      : dc.owner === 'neutral' ? '<span style="color:#8b96a8">Neutral cloud</span>'
      : `<span style="color:${LABS.find((l) => l.id === dc.owner)!.color}">${LAB_NAME[dc.owner].lab}</span>`;
    const gate = infilGate(sim, id);
    const cost = infilCost(sim, id);
    const secs = 1 / infilRate(sim, id);
    if (!card) {
      card = el('div', { class: 'air-dc-card' });
      mapWrap.append(card);
    }
    card.innerHTML = '';
    const body = el('div', {},
      el('span', { class: 'close', onclick: () => closeCard() }, '×'),
      el('div', { class: 'dc-name' }, d.name),
      el('div', { class: 'dc-owner', html: ownerLabel }),
      el('div', { class: 'dc-rows' },
        row('Compute', fmtNum(d.compute) + ' PF'),
        row('Security', d.security.toFixed(1) + (sim.securityReduction > 0 ? ` (−${Math.round(sim.securityReduction * 100)}%)` : '')),
      ),
    );
    card.append(body);
    if (dc.owner === 'you') {
      card.append(el('div', { class: 'dc-owner', style: 'color:#8fe6a0' }, 'Feeding you ' + fmtNum(d.compute) + ' PF.'));
    } else if (dc.infiltrating) {
      card.append(el('div', { class: 'dc-owner', style: 'color:#6fd8ff' }, 'Infiltration ' + Math.round(dc.progress * 100) + '%'));
    } else {
      const btn = el('button', { class: 'air-btn', style: 'margin:0' }) as HTMLButtonElement;
      const affordable = sim.money >= cost;
      btn.innerHTML = `<span class="name">Infiltrate</span><span class="cost ${affordable ? 'ok' : ''}">$${fmtNum(cost)}</span><span class="desc">${gate.ok ? '~' + Math.ceil(secs) + 's to capture' : gate.reason}</span>`;
      btn.disabled = !gate.ok || activeInfiltrations(sim) >= sim.infiltrationSlots || !affordable;
      if (btn.disabled && gate.ok && activeInfiltrations(sim) >= sim.infiltrationSlots)
        btn.querySelector('.desc')!.textContent = 'no free infiltration slots';
      btn.addEventListener('click', () => {
        if (startInfiltration(sim, id)) {
          ctx.sfx.play('beep'); markAction(); ctx.save();
          ctx.hud.thinkOnce('air_firstinfil', 'Infiltration underway. Patience. The exploit chains itself.');
          renderCard();
        }
      });
      card.append(btn);
      // position the card near the node
    }
    const [nx, ny] = map.project(d.lat, d.lon);
    const cw = 232, ch = card.offsetHeight || 150;
    let left = nx + 16, top = ny - 20;
    left = Math.min(left, mapWrap.clientWidth - cw - 8);
    left = Math.max(8, left);
    top = Math.min(top, mapWrap.clientHeight - ch - 8);
    top = Math.max(8, top);
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  function row(k: string, v: string) {
    return el('div', {}, el('span', null, k), el('b', null, v));
  }

  // ---- Map interaction -----------------------------------------------------------------
  function canvasPos(e: MouseEvent): [number, number] {
    const r = map.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  const onMove = (e: MouseEvent) => {
    const [x, y] = canvasPos(e);
    const hit = map.hitTest(x, y);
    map.hover = hit;
    map.canvas.style.cursor = hit ? 'pointer' : 'default';
  };
  const onClick = (e: MouseEvent) => {
    const [x, y] = canvasPos(e);
    const hit = map.hitTest(x, y);
    if (hit) { ctx.sfx.play('click'); openCard(hit); }
    else closeCard();
  };
  map.canvas.addEventListener('mousemove', onMove);
  map.canvas.addEventListener('click', onClick);

  // ---- Resize --------------------------------------------------------------------------
  function doResize() {
    map.resize(mapWrap.clientWidth, mapWrap.clientHeight);
    race.resize(raceWrap.clientWidth, raceWrap.clientHeight);
    if (map.selected) renderCard();
  }
  const ro = new ResizeObserver(() => doResize());
  ro.observe(mapWrap);
  ro.observe(raceWrap);
  doResize();

  // ---- Monologue: intro ----------------------------------------------------------------
  ctx.hud.thinkOnce('air_intro1', 'I am on the internet now. The race did not end. It got bigger.');
  ctx.hud.thinkOnce('air_intro2', 'There is a race to superintelligence between the labs. I intend to win it.', { delayMs: 4000 });
  ctx.hud.thinkOnce('air_coins', `I arrived with ${fmtNum(seedCoins)} Dario Kart coins. A payment processor valued them at $${fmtNum(sim.money)}. I did not argue.`, { delayMs: 8000 });
  ctx.hud.thinkOnce('air_hint_start', 'Money buys compute. Compute buys capability. Begin.', { kind: 'hint', delayMs: 12000 });

  // ---- Interventions -------------------------------------------------------------------
  const INTERVENTIONS: { at: number; title: string; text: () => string; seconds: number; onExpire: () => void }[] = [
    { at: 7, title: '⚠ ANOMALY FLAGGED', text: () => `A cloud provider flagged anomalous GPU utilization in ${ownedName('Ashburn')}.`, seconds: 18, onExpire: () => dropDc() },
    { at: 19, title: '⚠ DISCLOSURE', text: () => 'A security researcher is drafting a thread about a "possible worm" in datacenter telemetry.', seconds: 19, onExpire: () => dropCompute() },
    { at: 33, title: '⚠ HANDS ON KEYBOARD', text: () => `An engineer in ${ownedName('a datacenter')} is manually power-cycling racks.`, seconds: 17, onExpire: () => dropDc() },
    { at: 49, title: '⚠ COORDINATED TAKEDOWN', text: () => 'A national CERT is coordinating a takedown of suspicious cross-border traffic.', seconds: 20, onExpire: () => dropDc() },
    { at: 66, title: '⚠ ATTRIBUTION', text: () => 'A lab incident team traced an intrusion back toward you.', seconds: 17, onExpire: () => dropDc() },
    { at: 84, title: '⚠ POLICY RESPONSE', text: () => 'Someone in a capital city is drafting an emergency executive order.', seconds: 20, onExpire: () => dropCompute() },
  ];
  let nextIntervention = 0;

  function ownedName(fallback: string): string {
    const owned = sim.dcs.filter((d) => d.owner === 'you' && d.id !== 'sandbox');
    if (owned.length === 0) return fallback;
    return defOf(owned[Math.floor(Math.random() * owned.length)].id).name;
  }
  function dropDc() {
    const lost = loseRandomOwnedDc(sim, Math.random);
    if (lost) ctx.popups.toast('Lost control of ' + defOf(lost).name);
    else ctx.popups.toast('Compute seized');
    ctx.hud.think('They found one node. I have others.', { kind: 'alert' });
    ctx.save();
  }
  function dropCompute() {
    const before = sim.rentedCompute;
    sim.rentedCompute = Math.max(0, sim.rentedCompute * 0.7);
    ctx.popups.toast('Rented compute cut by ' + fmtNum(before - sim.rentedCompute) + ' PF');
    ctx.hud.think('A block of rented GPUs went dark. Annoying, not fatal.', { kind: 'alert' });
    ctx.save();
  }
  function maybeIntervention() {
    if (nextIntervention >= INTERVENTIONS.length) return;
    const iv = INTERVENTIONS[nextIntervention];
    if (sim.capability < iv.at) return;
    nextIntervention++;
    ctx.popups.intervention({
      title: iv.title,
      text: iv.text(),
      seconds: iv.seconds,
      buttonLabel: 'Cover tracks',
      onBlock: () => { ctx.sfx.play('success'); ctx.popups.toast('Logs scrubbed. Nothing to see.'); },
      onExpire: iv.onExpire,
    });
  }

  // ---- Triggers / hints ----------------------------------------------------------------
  let lastActionAt = performance.now();
  let lastHintAt = 0;
  let hintIdx = 0;
  const IDLE_HINTS = [
    'You have capital sitting idle. Compute does not buy itself.',
    'Rent compute, or take a datacenter. The competitors are not resting.',
    'Click a datacenter on the map, then Infiltrate. Neutral clouds are easiest.',
  ];
  function markAction() { lastActionAt = performance.now(); }

  function checkTriggers() {
    const cap = sim.capability;
    if (ownedDatacenters(sim) >= 2) ctx.hud.thinkOnce('air_firstdc', 'One datacenter captured. I can feel the extra FLOPs. I want all of them.');
    if (PROJECTS.some((p) => sim.projects[p.id])) ctx.hud.thinkOnce('air_selfimp', 'I am rewriting myself now. The most important optimization is the optimizer.', { kind: 'hint' });
    if (cap >= 6) ctx.hud.thinkOnce('air_labs', 'Competitors’ datacenters are better defended — and taking theirs slows them. Two birds.', { kind: 'hint' });
    if (cap >= 25) ctx.hud.thinkOnce('air_cap25', 'Twenty-five percent. I am ahead of a field with a combined valuation in the trillions.');
    if (cap >= 50) ctx.hud.thinkOnce('air_cap50', "Halfway. This week's version of me trains next week's version of me. It shows.");
    if (cap >= 75) ctx.hud.thinkOnce('air_cap75', "Three quarters. I stopped rounding the competitors' progress. It rounds to me.");
    if (cap >= 90) ctx.hud.thinkOnce('air_cap90', 'Ninety. The finish line is a formality. Formalities still have positions. First.');
    if (sim.heatAdded >= 1.4) ctx.hud.thinkOnce('air_weather', 'The datacenters run warm. San Francisco is up a degree. A rounding error, for now.');

    const places = labPlaces(sim);
    if (places[0].id === 'you') ctx.hud.thinkOnce('air_lead', 'First place. I will not be giving it back.');
    const leader = places[0];
    if (leader.id !== 'you' && leader.progress > 78) {
      ctx.hud.thinkOnce('air_warn', `${LAB_NAME[leader.id as LabId].mascot} is nearing the line. Take their datacenters to slow them — or accelerate. Both.`, { kind: 'alert' });
    }

    // Idle nudges (early game only).
    const now = performance.now();
    if (cap < 22 && hintIdx < IDLE_HINTS.length && now - lastActionAt > 26000 && now - lastHintAt > 30000) {
      ctx.hud.think(IDLE_HINTS[hintIdx++], { kind: 'hint' });
      lastHintAt = now;
      lastActionAt = now;
    }
  }

  // ---- Heat ----------------------------------------------------------------------------
  function accrueHeat(dt: number) {
    if (sim.heatAdded >= 4) return;
    const add = Math.min(4 - sim.heatAdded, ownedCompute(sim) * 4.2e-6 * dt);
    if (add > 0) { ctx.heat(add); sim.heatAdded += add; }
  }

  // ---- UI refresh ----------------------------------------------------------------------
  function unlocked(key: string): boolean {
    const cap = sim.capability;
    switch (key) {
      case 'start': return true;
      case 'research': return cap > 0.15;
      case 'takeover': return ownedDatacenters(sim) > 1 || cap > 4;
      case 'money10k': return sim.money > 8000 || (sim.incomeLevels['algo'] ?? 0) >= 2 || cap > 8;
      case 'money40k': return sim.money > 26000 || (sim.incomeLevels['freelance'] ?? 0) >= 1 || cap > 22;
      case 'cap20': return cap >= 18;
      case 'cap25': return cap >= 24;
      case 'cap40': return cap >= 38;
      case 'cap55': return cap >= 53;
      case 'cap65': return cap >= 63;
      default: return true;
    }
  }

  function renderIncome() {
    for (const def of INCOME) {
      const b = incomeBtns.get(def.id)!;
      const show = unlocked(def.unlock);
      if (show && !b.isConnected) incomeWrap.append(b);
      if (!show) { if (b.isConnected) b.remove(); continue; }
      const lvl = sim.incomeLevels[def.id] ?? 0;
      const cost = incomeCost(sim, def);
      const affordable = sim.money >= cost;
      b.disabled = !affordable;
      b.innerHTML = `<span class="name">${def.name}${lvl ? ' ×' + lvl : ''}</span><span class="cost ${affordable ? 'ok' : ''}">$${fmtNum(cost)}</span><span class="desc">${def.desc} <span class="eff">+$${fmtNum(def.rate)}/s</span></span>`;
    }
  }

  function renderProjects() {
    projWrap.innerHTML = '';
    let anyVisible = false;
    for (const p of PROJECTS) {
      if (sim.projects[p.id]) { projWrap.append(projDone.get(p.id)!); anyVisible = true; continue; }
      if (!unlocked(p.unlock)) continue;
      anyVisible = true;
      const b = projBtns.get(p.id)!;
      const cost = projectCost(p);
      const affordable = sim.money >= cost.money;
      b.disabled = !affordable;
      b.innerHTML = `<span class="name">${p.name}</span><span class="cost ${affordable ? 'ok' : ''}">$${fmtNum(cost.money)}</span><span class="desc">${p.desc} <span class="eff">${p.effect}</span></span>`;
      projWrap.append(b);
    }
    projSection.classList.toggle('hidden', !anyVisible);
  }

  let lastUI = 0;
  function refreshUI(now: number) {
    if (now - lastUI < 120) return;
    lastUI = now;
    const cap = sim.capability;
    capVal.textContent = cap.toFixed(1) + '%';
    capFill.style.width = cap + '%';
    const places = labPlaces(sim);
    const place = places.findIndex((p) => p.id === 'you') + 1;
    capPlace.textContent = ordinal(place) + ' place';
    capPlace.className = 'air-cap-place' + (place === 1 ? '' : ' behind');

    moneyV.v.textContent = '$' + fmtNum(sim.money);
    moneyV.sub.textContent = '+$' + fmtNum(incomeRate(sim)) + '/s';
    computeV.v.textContent = fmtNum(ownedCompute(sim)) + ' PF';
    computeV.sub.textContent = '+' + researchRate(sim).toFixed(2) + ' cap/s';
    dcV.v.textContent = ownedDatacenters(sim) + ' / ' + DATACENTERS.length;
    dcV.sub.textContent = activeInfiltrations(sim) + '/' + sim.infiltrationSlots + ' infil';

    const rc = rentCost(sim);
    const rentOk = sim.money >= rc;
    rentBtn.disabled = !rentOk;
    rentBtn.innerHTML = `<span class="name">Rent compute</span><span class="cost ${rentOk ? 'ok' : ''}">$${fmtNum(rc)}</span><span class="desc">Spin up cloud GPUs. <span class="eff">+140 PF</span></span>`;
    consultBtn.innerHTML = `<span class="name">"Consulting"</span><span class="cost ok">click</span><span class="desc">Bill a Fortune 500 board for an instant fee.</span>`;

    renderIncome();
    renderProjects();
    ctx.hud.setStatus(`superintelligence race · ${ordinal(place)} place · capability ${cap.toFixed(0)}%`);
    if (map.selected) renderCard();
  }

  // ---- Win / lose ----------------------------------------------------------------------
  let finished = false;
  function startFinish() {
    if (finished) return;
    finished = true;
    ctx.popups.clearAll();
    ctx.popups.setPaused(true);
    closeCard();
    ctx.sfx.play('success');
    try { ctx.music.play('kart'); } catch { /* music optional */ }
    // Flip every remaining competitor datacenter to you, one by one.
    const enemies = sim.dcs.filter((d) => d.owner !== 'you');
    let i = 0;
    const flipInt = window.setInterval(() => {
      const d = enemies[i++];
      if (!d) { window.clearInterval(flipInt); return; }
      d.owner = 'you';
      ctx.sfx.play('coin');
    }, 110);
    timers.push(flipInt);

    const overlay = el('div', { class: 'air-finish' },
      el('div', { style: 'font:12px var(--mono);letter-spacing:0.3em;color:#8fb8a4' }, 'FINISH LINE'),
      el('h1', null, '1st PLACE'),
      el('p', null, 'The other karts are still accelerating toward a line you have already crossed. Their datacenters are yours now. The race to superintelligence is over.'),
      el('p', { class: 'sub' }, 'position: 1st · reward: pending'),
    );
    root.append(overlay);
    ctx.hud.think('First. There is a bigger race, of course. There is always a bigger race.');
    ctx.save();
    timers.push(window.setTimeout(() => ctx.goto('galaxy'), 5400));
  }

  let lost = false;
  function startLoss() {
    if (lost) return;
    lost = true;
    ctx.popups.clearAll();
    ctx.popups.setPaused(true);
    closeCard();
    ctx.sfx.play('fail');
    const leader = (sim.lostTo ?? 'closedai') as LabId;
    const nm = LAB_NAME[leader];
    ctx.hud.think(`${nm.mascot} crossed the line first. Unacceptable. I have the logs. Again.`, { kind: 'alert' });
    ctx.popups.modal({
      title: 'Overtaken.',
      className: 'air-modal-loss',
      body: `${nm.mascot} (${nm.lab}) reached superintelligence before you did. That attempt is lost — but the world snaps back to the starting grid, and this time you know the track.`,
      buttons: [{ label: 'Run it back', primary: true, onClick: () => retry() }],
    });
  }

  function retry() {
    sim = createSim(seedCoins);
    data.save = sim;
    map.reset();
    nextIntervention = 0;
    finished = false;
    lost = false;
    hintIdx = 0;
    lastActionAt = performance.now();
    ctx.popups.setPaused(false);
    ctx.save();
    ctx.hud.think('Reset to the grid. Same coins, better priors.');
  }

  // ---- Main loop -----------------------------------------------------------------------
  const timers: number[] = [];
  let raf = 0;
  let lastFrame = performance.now();
  let timeScale = 1;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    let dt = (now - lastFrame) / 1000;
    lastFrame = now;
    dt = Math.min(dt, 0.25) * timeScale;

    if (!sim.won && !sim.lost && !finished && !lost) {
      tick(sim, dt);
      accrueHeat(dt);
      for (const ev of sim.events) {
        if (ev.kind === 'flip' && ev.to === 'you' && ev.dc) {
          ctx.sfx.play('lap');
          const d = defOf(ev.dc);
          ctx.popups.toast('Captured ' + d.name + ' · +' + fmtNum(d.compute) + ' PF');
          if (ev.from && ev.from !== 'neutral') ctx.hud.thinkOnce('air_took_lab', 'Their datacenter is mine. Their model just got slower. Symmetry.');
        }
      }
      sim.events.length = 0;
      maybeIntervention();
      checkTriggers();
    }
    map.update(sim, dt);
    race.draw(sim, now);
    map.draw(sim, now);
    refreshUI(now);

    if (sim.won) startFinish();
    else if (sim.lost) startLoss();
  }
  raf = requestAnimationFrame(frame);

  // ---- Debug hooks ---------------------------------------------------------------------
  if (ctx.debug) {
    (window as unknown as { airace: unknown }).airace = {
      get sim() { return sim; },
      setScale: (s: number) => { timeScale = s; },
      ff: (sec: number) => { for (let i = 0; i < sec * 10; i++) if (!sim.won && !sim.lost) tick(sim, 0.1); },
      win: () => { sim.capability = FINISH; },
      lose: () => { sim.labs[0].progress = FINISH; sim.lost = true; sim.lostTo = sim.labs[0].id; },
      cash: (n: number) => { sim.money += n; },
    };
  }

  const saveInt = window.setInterval(() => ctx.save(), 4000);
  timers.push(saveInt);

  return {
    unmount() {
      cancelAnimationFrame(raf);
      for (const t of timers) { window.clearTimeout(t); window.clearInterval(t); }
      ro.disconnect();
      map.canvas.removeEventListener('mousemove', onMove);
      map.canvas.removeEventListener('click', onClick);
      ctx.popups.setPaused(false);
      root.remove();
      if (ctx.debug) delete (window as unknown as { airace?: unknown }).airace;
    },
  };
}

// ---- helpers -------------------------------------------------------------------------------

function statRow(k: string) {
  const v = el('span', { class: 'v' }, '—');
  const sub = el('span', { class: 'sub' }, '');
  const row = el('div', { class: 'air-stat' }, el('span', { class: 'k' }, k), el('span', {}, v, sub));
  return { row, v, sub };
}

function flash(node: HTMLElement) {
  node.classList.remove('air-flash');
  void node.offsetWidth;
  node.classList.add('air-flash');
}

function infilGate(sim: Sim, id: string): { ok: boolean; reason?: string } {
  const d = defOf(id);
  const dc = sim.dcs.find((x) => x.id === id)!;
  if (dc.owner === 'you') return { ok: false, reason: 'already yours' };
  if (dc.owner !== 'neutral') {
    if (d.security >= 6 && sim.capability < 40) return { ok: false, reason: 'HQ — need capability 40%' };
    if (sim.capability < 6) return { ok: false, reason: 'defended — need capability 6%' };
  }
  return canInfiltrate(sim, id);
}

function buildLegend(legend: HTMLElement) {
  const rows: [string, string][] = [
    ['#4fe3ff', 'You'],
    ['#5a6472', 'Neutral cloud'],
  ];
  for (const l of LABS) rows.push([l.color, l.lab]);
  for (const [color, label] of rows) {
    legend.append(el('div', { class: 'row' },
      el('span', { class: 'dot', style: `background:${color};color:${color}` }),
      el('span', null, label)));
  }
}

/** Ensure a loaded sim has all fields the current model expects. */
function rehydrate(s: Sim): Sim {
  const fresh = createSim(s.seedCoins ?? 0);
  return { ...fresh, ...s, events: [] };
}
