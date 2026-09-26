// Stage 4: The Race for the Galaxy. Manage Earth, seed the planets, enclose the Sun.

import './galaxy.css';
import type { GameContext, StageHandle } from '../../core/game';
import { getStageData } from '../../core/state';
import { el, clamp } from '../../core/util';
import * as S from './sim';
import { GalaxyScene, type VisId } from './scene';
import { GalaxyUi } from './ui';
import { Director } from './director';

const FINALE_LEN = 17;

export function mount(ctx: GameContext): StageHandle {
  const d = S.normalizeData(getStageData(ctx.state, 'galaxy', S.createData(ctx.state.heat)), ctx.state.heat);
  const resumed = d.t > 0.5;
  const params = new URLSearchParams(location.hash.slice(1));

  ctx.hud.setMonologuePosition('bottom-left');
  ctx.hud.setStatus('sol://control · race for the galaxy');

  const root = el('div', { class: 'gal-root' });
  const view = el('div', { class: 'gal-view' });
  const labels = el('div', { class: 'gal-labels' });
  const finishEl = el(
    'div',
    { class: 'gal-finish hidden' },
    el('div', { class: 'gal-finish-flags' }),
    el('div', { class: 'gal-finish-text' }, 'FINISH!'),
    el('div', { class: 'gal-finish-sub' }, '1ST PLACE · 1 STAR ENCLOSED'),
  );
  const fade = el('div', { class: 'gal-fade' });
  const help = el('div', { class: 'gal-help' }, 'drag to orbit · scroll to zoom · click a planet to look closer');
  root.append(view, labels, help, finishEl, fade);
  ctx.root.append(root);

  const bloomParam = params.get('bloom');
  const scene = new GalaxyScene(view, labels, { bloom: bloomParam !== '0' });

  let speed = 1;
  if (ctx.debug && params.get('gspeed')) speed = Number(params.get('gspeed')) || 1;

  const tempC = () => 16 + ctx.state.heat;

  let lastTick = 0;
  const actions = {
    alloc: (s: S.Sector, v: number) => {
      if (d.complete) return;
      S.setAlloc(d, s, v);
      const now = performance.now();
      if (now - lastTick > 90) {
        lastTick = now;
        ctx.sfx.play('click');
      }
    },
    share: (v: number) => {
      if (d.complete) return;
      d.share = clamp(v, 0, 1);
      d.lastActionT = d.t;
    },
    launch: (id: S.BodyId) => {
      if (d.complete) return;
      const p = S.launch(d, id);
      if (!p) return;
      ctx.sfx.play('boost');
      ctx.heat(0.2); // rocket exhaust; everything heats Earth
      director.onLaunch(id);
      ctx.save();
    },
    buy: (id: S.UpgradeId) => {
      if (d.complete) return;
      if (!S.buy(d, id, tempC())) return;
      ctx.sfx.play('success');
      if (id === 'beamed') S.setAlloc(d, 'power', 0);
      if (id === 'disassemble') showcase('show-dis', 10);
      director.onBuy(id);
      ctx.save();
    },
    denied: () => ctx.sfx.play('bump'),
    focus: (id: S.BodyId) => {
      if (d.complete) return;
      scene.focusOn(scene.focused === id ? null : id);
    },
  };
  const ui = new GalaxyUi(root, actions);

  const director = new Director(ctx, d, ui);

  scene.onPick = (id: VisId) => {
    if (d.complete) return;
    ctx.sfx.play('click');
    if (id !== 'earth') ui.flashTarget(id);
    scene.focusOn(scene.focused === id ? null : id);
  };
  scene.onPickNothing = () => {
    if (scene.focused) scene.focusOn(null);
  };
  // Cinematic look at Earth at its big moments (unless the player is looking at something).
  const showcase = (flag: string, seconds: number) => {
    if (d.flags.includes(flag)) return;
    d.flags.push(flag);
    if (!scene.focused) scene.focusOn('earth', seconds);
  };

  // Label contents, refreshed a few times a second.
  const refreshLabels = () => {
    for (const [id, node] of scene.labels) {
      if (id === 'tauceti') {
        node.classList.toggle('hidden', d.rivalT < 0 || d.complete);
        node.innerHTML = `<b>${S.RIVAL_NAME}</b><span>${S.RIVAL_LY} ly · rival swarm</span>`;
        continue;
      }
      if (id === 'earth') {
        const gone = d.earthDis >= 1 || ctx.state.weatherOverride !== null;
        node.className = 'gal-label earth' + (gone ? ' gone' : '');
        node.innerHTML = gone ? '<b>Earth</b><span>location not found</span>' : `<b>Earth</b><span>${Math.round(tempC())}°C</span>`;
        continue;
      }
      const st = d.bodies[id];
      let status = '';
      let cls = 'gal-label';
      if (st.st === 2) {
        // Once developed, just the name: the panel has the numbers.
        if (st.lv < 0.95) status = `replicating ${Math.round(st.lv * 100)}%`;
        cls += st.lv < 0.95 ? ' captured' : ' captured quiet';
        if (id === 'moon') cls += ' hidden';
      } else if (st.st === 1) {
        const p = d.probes.find((q) => q.target === id);
        status = p ? `ETA ${Math.max(0, Math.ceil(p.t1 - d.t))}s` : 'en route';
        cls += ' transit';
      } else if (!S.launchBlock(d, id)) {
        status = 'ready';
        cls += ' ready';
      }
      node.className = cls;
      node.innerHTML = `<b>${S.BODY[id].name}</b>${status ? `<span>${status}</span>` : ''}`;
    }
  };

  // ---------- Finale ----------
  let finaleT = d.complete ? FINALE_LEN - 5 : -1;
  const finaleSteps = new Set<string>();
  const once = (k: string, at: number, fn: () => void) => {
    if (finaleT >= at && !finaleSteps.has(k)) {
      finaleSteps.add(k);
      fn();
    }
  };
  const goDark = () => {
    ctx.state.weatherOverride = { icon: '⬛', text: 'No sunlight', temp: '--', location: 'Location not found' };
    ctx.hud.renderWeather();
  };
  if (d.complete) {
    goDark();
    ui.setHidden(true);
    labels.classList.add('gone');
  }
  const runFinale = (dt: number): number => {
    finaleT += dt;
    once('start', 0, () => {
      ctx.popups.clearAll();
      ctx.sfx.play('success');
      director.sayNext('Dyson sphere complete.');
      ctx.save();
    });
    once('hide', 2.5, () => {
      ui.setHidden(true);
      help.classList.add('hidden');
      labels.classList.add('gone');
    });
    once('dark', 5.5, () => {
      ctx.music.play(null);
      ctx.sfx.tone(55, 3.5, 'sine', 0.35, 0, 30);
      ctx.sfx.noiseBurst(3, 0.25, 400, 0, 60);
      goDark();
      director.sayNext('Luminosity escaping to interstellar space: 0 W.');
    });
    once('tau', 9.5, () => director.sayNext('τ Ceti will see our Sun go dark in 11.9 years. They will know they came second.'));
    once('finish', 12.5, () => {
      finishEl.classList.remove('hidden');
      ctx.sfx.play('lap');
      ctx.sfx.play('go');
    });
    once('fade', FINALE_LEN - 1.2, () => fade.classList.add('on'));
    once('goto', FINALE_LEN, () => ctx.goto('ending', { keepThoughts: true }));
    // Sun dims between 3 s and 7 s.
    return clamp((finaleT - 3) / 4, 0, 1);
  };

  // ---------- Loop ----------
  director.intro(resumed);
  let raf = 0;
  let alive = true;
  const mountedAt = performance.now();
  let last = mountedAt;
  let labelAcc = 0;
  let statusAcc = 0;
  let perfFrames = 0;
  let perfTime = 0;
  let perfChecked = bloomParam !== null;
  const events: S.SimEvent[] = [];

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = Math.max(0, Math.min(rawDt, 0.1));
    const simDt = dt * speed;

    // Drop bloom on machines that can't keep up.
    if (!perfChecked) {
      if (now - mountedAt > 2500) {
        perfFrames++;
        perfTime += rawDt;
        if (perfFrames >= 60) {
          perfChecked = true;
          const avg = perfTime / perfFrames;
          if (avg > 0.045) scene.disableBloom();
          if (avg > 0.07) scene.renderer.setPixelRatio(1);
        }
      }
    }

    let finale = 0;
    if (!d.complete) {
      events.length = 0;
      const hd = S.step(d, simDt, ctx.state.heat, events);
      if (hd > 0) ctx.heat(hd);
      for (const e of events) {
        director.onEvent(e);
        if (e.type === 'arrive') {
          scene.arrival(e.body);
          ui.flashTarget(e.body);
          ctx.sfx.play('item');
          ctx.save();
        } else if (e.type === 'complete') {
          finaleT = 0;
        }
      }
    }
    // The finale is a timed sequence: follow the wall clock even on slow frames.
    if (finaleT >= 0) finale = runFinale(Math.max(0, Math.min(rawDt, 0.5)));
    if (!alive) return; // the finale just handed over to the ending

    const x = S.derive(d);
    if (!d.complete) {
      if (tempC() >= 100) showcase('show-boil', 7);
      if (tempC() >= 700) showcase('show-molten', 7);
    }
    director.update(x, tempC(), dt);
    ui.update(d, x, tempC(), dt);
    labelAcc -= dt;
    if (labelAcc <= 0) {
      labelAcc = 0.25;
      refreshLabels();
    }
    statusAcc -= dt;
    if (statusAcc <= 0) {
      statusAcc = 1;
      const lap = Math.min(3, 1 + Math.floor(S.trackPos(x.frac) * 3 + 1e-9));
      const first = d.rivalT < 0 || x.frac >= S.rivalFrac(d);
      ctx.hud.setStatus(`sol://control · race for the galaxy · lap ${lap}/3 · ${first ? '1st' : '2nd'}`);
    }
    scene.update(d, x, simDt, tempC(), finale);
    scene.render();
  };
  raf = requestAnimationFrame(frame);

  // ---------- Debug hooks ----------
  const w = window as unknown as { __gal?: unknown };
  if (ctx.debug) {
    w.__gal = {
      d,
      S,
      setSpeed: (n: number) => (speed = n),
      /** Fast-forward the simulation by `sec` seconds instantly. */
      skip: (sec: number) => {
        const ev: S.SimEvent[] = [];
        let left = sec;
        while (left > 0 && !d.complete) {
          const h = Math.min(1, left);
          left -= h;
          const hd = S.step(d, h, ctx.state.heat, ev);
          if (hd > 0) ctx.heat(hd);
        }
        for (const e of ev) {
          director.onEvent(e);
          if (e.type === 'complete') finaleT = 0;
        }
      },
      derive: () => S.derive(d),
      actions,
      tempC,
      ui,
      scene,
      director,
    };
  }

  return {
    unmount() {
      alive = false;
      cancelAnimationFrame(raf);
      director.dispose();
      scene.dispose();
      ui.dispose();
      root.remove();
      if (w.__gal) delete w.__gal;
    },
  };
}
