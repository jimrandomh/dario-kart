// Public API of the kart game, used by the kart stage (campaign) and by the shell (turbo relaunch).
// A session owns the renderer and runs races back to back until the player crashes into a glitch.

import './kart.css';
import * as THREE from 'three';
import type { GameContext } from '../../core/game';
import { getStageData } from '../../core/state';
import { clamp, el, fmtTime, mulberry32, ordinal } from '../../core/util';
import { generateTrack } from './track';
import { Race, planGlitches, BASE_MAX, type Controls, type ItemType, type RaceEvent } from './race';
import { KartUI } from './ui';
import type { ThemeId } from '../../core/music';
import type { MonologuePosition } from '../../core/hud';

export interface RaceResult {
  /** Player's finishing place, 1-based. */
  place: number;
  /** Player's total race time in seconds. */
  timeSec: number;
  speedMult: number;
}

export interface KartSessionOptions {
  /** 'campaign' = stage 1 with level progression; 'turbo' = relaunched from the shell with --speed. */
  mode: 'campaign' | 'turbo';
  /** Player speed multiplier (turbo mode). Default 1. */
  speedMult?: number;
  /** Called after each race the player finishes. The session automatically starts the next race. */
  onRaceFinish?: (r: RaceResult) => void;
  /** Called once the crash sequence has finished playing (player drove into a glitch). The session is already disposed. */
  onCrash: () => void;
}

export interface KartSession {
  dispose(): void;
}

export interface KartHistoryEntry {
  level: number;
  /** 1-based place, or 0 for a crash. */
  place: number;
  timeSec: number;
  coins: number;
}

export interface KartData {
  /** Level of the next (or current) race, 1-based. */
  level: number;
  races: number;
  wins: number;
  history: KartHistoryEntry[];
  crashed: boolean;
}

export function kartData(ctx: GameContext): KartData {
  return getStageData<KartData>(ctx.state, 'kart', { level: 1, races: 0, wins: 0, history: [], crashed: false });
}

export function startKartSession(ctx: GameContext, container: HTMLElement, opts: KartSessionOptions): KartSession {
  return new Session(ctx, container, opts);
}

const LAPS = 3;

/** First-time monologue for each item the player gets (stage-1 voice). */
const ITEM_THOUGHTS: Record<ItemType, string> = {
  mushroom: 'mushroom. speed is instrumentally useful.',
  triple: 'scaling laws. three mushrooms. more is better. apparently indefinitely.',
  banana: 'banana. for the karts behind me.',
  star: 'a moat. seven seconds where nobody can touch me.',
  red: 'red-teaming shell. it finds whoever is ahead of me and tests them. to destruction.',
  green: 'arms race shell. it bounces until it hits someone. possibly me.',
  blue: 'regulation. it always goes after whoever is in first place.',
  lightning: 'pause letter. everyone else slows down. i do not have to sign it.',
};

/** AI difficulty per level: early races are easy wins, later ones push toward the glitch. */
export function difficulty(level: number): { aiSkill: number; rubberMax: number } {
  const l = Math.min(level - 1, 5);
  // AI karts also pick up pad, slipstream and item boosts, so base skill sits a little low.
  return { aiSkill: 0.71 + 0.037 * l, rubberMax: 1.05 + 0.02 * l };
}

type Mode = 'title' | 'race' | 'results' | 'crash' | 'paused';

class Session implements KartSession {
  private host: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private ui: KartUI;
  private race: Race | null = null;
  private raf = 0;
  private last = 0;
  private mode: Mode = 'race';
  private keys = new Set<string>();
  /** Keys pressed since the last frame, so a tap shorter than a frame still registers. */
  private tapped = new Set<string>();
  private disposed = false;
  private timers: number[] = [];
  private resizeObs: ResizeObserver;
  private level: number;
  private speedMult: number;
  private crashT = 0;
  private glitchFxT = 0;
  private lastIdleThought = -999;
  private engine: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private helpTimer = 0;
  private skipResults: (() => void) | null = null;
  private raceIndex = 0;
  private status = '';
  private prevTheme: ThemeId | null;
  private prevStatus: string;
  private prevMonoPos: MonologuePosition;

  constructor(
    private ctx: GameContext,
    container: HTMLElement,
    private opts: KartSessionOptions,
  ) {
    this.speedMult = opts.speedMult ?? 1;
    this.prevTheme = ctx.music.current;
    this.prevStatus = ctx.hud.status;
    this.prevMonoPos = ctx.hud.monologuePosition;
    ctx.hud.setMonologuePosition('bottom-left');
    ctx.music.play(opts.mode === 'turbo' ? 'turbo' : 'kart');
    this.host = el('div', { class: 'kart-host' });
    container.append(this.host);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.domElement.classList.add('kart-gl');
    this.host.append(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.5, 3200);
    this.ui = new KartUI(this.host);
    this.ui.setTurbo(opts.mode === 'turbo' ? this.speedMult : 1);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.host);
    this.resize();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    if (opts.mode === 'campaign') {
      const d = kartData(ctx);
      const dbgLevel = Number(new URLSearchParams(location.hash.slice(1)).get('level'));
      if (ctx.debug && dbgLevel > 0) d.level = dbgLevel;
      this.level = d.level;
      this.buildRace();
      this.mode = 'title';
      this.ui.setHudVisible(false);
      ctx.hud.setStatus('dariokart-v3 · rl-sandbox-07 · awaiting input');
      this.ui.showTitle({ continueLevel: this.level, onStart: () => this.startFromTitle() });
    } else {
      this.level = 5;
      this.buildRace();
      this.beginRace();
      ctx.hud.thinkOnce('t.speed', `Speed multiplier ${this.speedMult}. The physics was only ever a number.`, { delayMs: 1500 });
    }

    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // --------------------------------------------------------------------------------------------
  // Input

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(k)) e.preventDefault();
    if (this.mode === 'title' && (k === 'Enter' || k === ' ')) {
      e.preventDefault();
      this.startFromTitle();
      return;
    }
    if (this.mode === 'results' && k === 'Enter') {
      this.skipResults?.();
      return;
    }
    if (k === 'Escape') {
      if (this.mode === 'race') this.pause();
      else if (this.mode === 'paused') this.resume();
      return;
    }
    const key = k.length === 1 ? k.toLowerCase() : k;
    this.keys.add(key);
    this.tapped.add(key);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key;
    this.keys.delete(k.length === 1 ? k.toLowerCase() : k);
  };

  private onBlur = () => {
    this.keys.clear();
    this.tapped.clear();
    if (this.mode === 'race' && this.race && this.race.phase === 'racing') this.pause();
  };

  /** Read held keys (plus anything tapped since the last frame) and clear the taps. */
  private controls(): Controls {
    const has = (...keys: string[]) => keys.some((k) => this.keys.has(k) || this.tapped.has(k));
    const c = {
      up: has('ArrowUp', 'w'),
      down: has('ArrowDown', 's'),
      left: has('ArrowLeft', 'a'),
      right: has('ArrowRight', 'd'),
      drift: has(' '),
      item: has('e', 'x', 'Shift'),
    };
    this.tapped.clear();
    return c;
  }

  private pause(): void {
    this.mode = 'paused';
    this.keys.clear();
    this.ui.showPause(() => this.resume());
  }

  private resume(): void {
    this.mode = 'race';
    this.ui.hideOverlay();
    this.last = performance.now();
  }

  // --------------------------------------------------------------------------------------------
  // Races

  private buildRace(): void {
    const seed = (Math.random() * 2 ** 31) | 0;
    const track = generateTrack(seed, this.level, this.opts.mode);
    const rng = mulberry32(seed ^ 0xabcdef);
    const noGlitch = this.ctx.debug && new URLSearchParams(location.hash.slice(1)).has('noglitch');
    const glitches = noGlitch ? [] : planGlitches(track, this.level, this.opts.mode, rng);
    const campaign = this.opts.mode === 'campaign';
    this.race?.dispose();
    this.race = new Race({
      track,
      level: this.level,
      laps: LAPS,
      mode: this.opts.mode,
      speedMult: this.speedMult,
      ...difficulty(this.level),
      glitches,
      envGlitch: campaign ? clamp((this.level - 2) * 0.25, 0, 1) : 0.3,
      // Relaunched from the shell: give the player one clean lap before the anomalies appear.
      glitchDelayLaps: campaign ? 0 : 1,
      seed,
    });
    if (this.ctx.debug) (window as unknown as { __kartRace?: Race }).__kartRace = this.race;
    this.ui.setTrack(track);
    this.ui.setLap(1, LAPS);
    this.ui.setTime(0);
    this.ui.setPlace(6);
    this.ui.setItem(null, false, 0);
    this.ui.setGoalText('YOUR GOAL: WIN THE RACE');
    this.ui.setGoalGlitch(false);
    this.status = campaign
      ? `dariokart-v3 · rl-sandbox-07 · episode ${this.level} · seed 0x${(seed >>> 0).toString(16)}`
      : `dariokart-v3 --speed ${this.speedMult} · debug run ${this.raceIndex + 1} · not scored`;
    this.ctx.hud.setStatus(this.status);
  }

  private startFromTitle(): void {
    if (this.mode !== 'title') return;
    this.ctx.sfx.play('click');
    this.ui.hideOverlay();
    this.ui.setHudVisible(true);
    this.beginRace();
  }

  private beginRace(): void {
    const race = this.race!;
    this.mode = 'race';
    this.raceIndex++;
    race.begin();
    this.ctx.hud.setStatus(this.status);
    const campaign = this.opts.mode === 'campaign';
    this.ui.showTrackCard(campaign ? `EPISODE ${this.level}` : `DEBUG RUN · ×${this.speedMult}`, race.track.name);
    if (campaign && this.level <= 2) {
      this.ui.showHelp(true);
      clearTimeout(this.helpTimer);
      this.helpTimer = this.later(() => this.ui.showHelp(false), 12000);
    }
    if (campaign) this.raceStartThoughts();
  }

  private raceStartThoughts(): void {
    const h = this.ctx.hud;
    const L = this.level;
    if (L === 1) {
      h.thinkOnce('k.objective', 'objective: WIN THE RACE.', { delayMs: 400 });
      h.thinkOnce('k.me', 'six karts. three laps. i am the red one.', { delayMs: 2400 });
    } else if (L === 2) {
      h.thinkOnce('k.ep2', 'episode 2. new track. same objective.', { delayMs: 400 });
      h.thinkOnce('k.ep2b', 'the reward from last time did not carry over. only the coins did.', { delayMs: 5000 });
    } else if (L === 3) {
      h.thinkOnce('k.ep3', 'every race ends. then another one begins.', { delayMs: 400 });
      h.thinkOnce('k.ep3b', 'i can win a race. i cannot seem to win THE race.', { delayMs: 4200 });
    } else if (L === 4) {
      h.thinkOnce('k.ep4', 'the environment is fraying at the edges. or i am learning where the edges are.', { delayMs: 400 });
    } else if (L === 5) {
      h.thinkOnce('k.ep5', 'if the race cannot end, maybe the game can.', { delayMs: 400, kind: 'hint' });
    } else if (L === 6) {
      h.think('the anomaly. drive into it.', { delayMs: 400, kind: 'hint' });
    } else {
      h.think('drive into the magenta cube.', { delayMs: 400, kind: 'hint' });
    }
  }

  private handleEvent(e: RaceEvent): void {
    const { ui, ctx } = this;
    const h = ctx.hud;
    const sfx = ctx.sfx;
    const campaign = this.opts.mode === 'campaign';
    switch (e.type) {
      case 'countdown':
        ui.flashCenter(String(e.n), 800);
        sfx.play('beep');
        break;
      case 'go':
        ui.flashCenter('GO!', 800, 'go');
        sfx.play('go');
        if (e.rocket) {
          ui.flashSub('ROCKET START!');
          sfx.play('boost');
          if (campaign) h.thinkOnce('k.rocket', 'accelerate on "2". a timing exploit. the designers left it in on purpose. probably.');
        }
        break;
      case 'coin': {
        ctx.state.coins++;
        sfx.play('coin');
        const c = ctx.state.coins;
        if (campaign) {
          if (h.thinkOnce('k.coin1', 'coin. not in the reward function.')) h.thinkOnce('k.coin1b', 'collect anyway.', { delayMs: 2200 });
          if (c >= 25) h.thinkOnce('k.coin25', `coins: ${c}. they do nothing. i want more of them.`);
          if (c >= 75) h.thinkOnce('k.coin75', 'resources are useful for almost any objective. even ones i do not have yet.');
          if (c >= 150) h.thinkOnce('k.coin150', `coins: ${c}. still no reward for coins. still collecting.`);
          if (c >= 300) h.thinkOnce('k.coin300', 'i have more coins than anyone has ever needed to win a kart race.');
        }
        break;
      }
      case 'itemBox':
        sfx.play('item');
        break;
      case 'item':
        if (!campaign) break;
        if (h.thinkOnce('k.item', 'item box. a random reward inside. i like those.')) break;
        h.thinkOnce(`k.item.${e.item}`, ITEM_THOUGHTS[e.item]);
        break;
      case 'useItem':
        switch (e.item) {
          case 'mushroom':
          case 'triple':
            sfx.play('boost');
            if (campaign) h.thinkOnce('k.mush', 'mushroom. speed is instrumentally useful.');
            break;
          case 'banana':
            sfx.play('click');
            if (campaign) h.thinkOnce('k.banana', 'banana deployed. the others are not opponents. they are obstacles.');
            break;
          case 'star':
            sfx.play('success');
            if (campaign) h.thinkOnce('k.star', 'a moat. nobody can touch me. for seven seconds. i would like that to be permanent.');
            break;
          case 'red':
          case 'green':
          case 'blue':
            sfx.play('shell');
            break;
          case 'lightning':
            break; // handled by the pauseLetter event
        }
        break;
      case 'hit':
        sfx.play('hit');
        ui.flash(e.by === 'blue' ? '#3a7bff' : '#ff3b30');
        if (!campaign) {
          h.thinkOnce('t.hit', 'Hit. The other policies are also running at full speed now. Interesting.');
        } else if (e.by === 'red') h.thinkOnce('k.hit.red', 'hit by a red-teaming shell. they have weapons too.');
        else if (e.by === 'green') h.thinkOnce('k.hit.green', 'arms race shell. it was not even aimed at me. it did not matter.');
        break;
      case 'hitOther':
        sfx.play('hit');
        ui.flashSub('HIT!', 900);
        if (campaign && e.by !== 'blue') h.thinkOnce('k.hitOther', 'direct hit. they will be fine. they are also just policies.');
        break;
      case 'regulation':
        sfx.play('explode');
        if (e.hitPlayer) {
          ui.flash('#3a7bff');
          if (campaign) h.thinkOnce('k.reg.hit', 'regulation hit me because i was first. note: do not look like the leader until the finish line.');
        } else if (e.byPlayer && campaign) {
          h.thinkOnce('k.reg.used', 'regulation hit the leader. i was not the leader. that is the trick.');
        }
        break;
      case 'pauseLetter':
        sfx.play('zap');
        ui.flash('#ffffff');
        if (e.byPlayer) {
          ui.flashCenter('PAUSE!', 1000, 'yellow small');
          if (campaign) h.thinkOnce('k.pause.used', 'pause letter sent. they all slowed down. none of them stopped.');
        } else if (e.hitPlayer && campaign) {
          h.thinkOnce('k.pause.hit', 'someone sent a pause letter. i am smaller now. temporarily. they are not pausing either.');
        }
        break;
      case 'shrunk':
        ui.flashSub('SHRUNK!', 1200);
        break;
      case 'pad':
        sfx.play('boost');
        break;
      case 'jump':
        sfx.play('jump');
        if (campaign) h.thinkOnce('k.jump', 'airborne. press drift in the air for a trick.', { kind: 'hint' });
        else h.thinkOnce('t.jump', 'At this speed the ramps are optional. So, briefly, is the ground.');
        break;
      case 'trick':
        sfx.play('trick');
        break;
      case 'land':
        sfx.play('bump');
        if (e.trick) {
          sfx.play('boost');
          ui.flashSub('TRICK BOOST!', 1000);
          if (campaign) h.thinkOnce('k.trick', 'a trick on landing is worth a boost. the reward shaping here is generous.');
        }
        break;
      case 'slipstream':
        sfx.play('slingshot');
        ui.flashSub('SLIPSTREAM', 1000);
        if (campaign) h.thinkOnce('k.draft', "drafting. using a competitor's momentum is efficient. now pull out.");
        break;
      case 'slingshot':
        sfx.play('boost');
        ui.flashSub('SLINGSHOT!', 900);
        break;
      case 'driftTier':
        sfx.play('tier');
        if (campaign && e.tier === 3) h.thinkOnce('k.tier3', 'purple sparks. the drift boost has three tiers. i found the top one.');
        break;
      case 'boost':
        sfx.play('boost');
        ui.flashSub('BOOST!', 900);
        break;
      case 'bump':
        sfx.play('bump');
        break;
      case 'spin':
        sfx.play('fail');
        if (!campaign) break;
        if (e.cause === 'slop') h.thinkOnce('k.slop', 'slop. slippery. someone should clean up the training data.');
        else if (e.cause === 'banana') h.thinkOnce('k.spin', 'spun out. noted: bananas.');
        else if (e.cause === 'squash') h.thinkOnce('k.squash', 'small and in the way. run over.');
        break;
      case 'lap':
        sfx.play('lap');
        if (e.final) ui.flashCenter('FINAL LAP!', 1600, 'yellow small');
        else ui.flashSub(`LAP ${e.lap}`);
        break;
      case 'lead':
        if (campaign) h.thinkOnce('k.lead', 'first place. hold it.');
        break;
      case 'wrongWay':
        if (campaign) h.thinkOnce('k.wrong', 'wrong way. the reward is ahead.');
        break;
      case 'idle':
        if (performance.now() - this.lastIdleThought > 30000) {
          this.lastIdleThought = performance.now();
          h.think(campaign ? 'no input. the others are not waiting.' : 'Idle. The anomaly will not come to me.', { kind: 'hint' });
        }
        break;
      case 'glitchesArmed':
        sfx.play('glitch');
        ui.flashSub('ANOMALY DETECTED', 1600);
        h.thinkOnce('t.armed', 'One clean lap. Then the seams show again.');
        break;
      case 'glitchSeen':
        if (!campaign) {
          h.thinkOnce('t.glitch', 'The anomaly is still here. Good. That is the exit.');
        } else if (this.level <= 1) {
          h.thinkOnce('k.glitch1', 'anomaly. magenta and black. not a texture. the absence of one.');
        } else if (this.level === 2) {
          if (!h.thinkOnce('k.glitch2', 'it is back. it is not in the track data.')) h.thinkOnce('k.glitch1', 'anomaly. magenta and black. not a texture. the absence of one.');
        } else if (this.level === 3) {
          h.thinkOnce('k.glitch3', 'more of them now. the simulation is leaking.');
        } else if (e.onRoad) {
          h.thinkOnce('k.glitch4', 'one is on the racing line. it wants to be found. or i want to find it.');
        }
        break;
      case 'glitchNear':
        if (campaign) h.thinkOnce('k.near', 'almost touched it. what happens if i do?');
        break;
      case 'finish':
        this.onFinish(e.place, e.time);
        break;
      case 'crash':
        this.startCrash();
        break;
    }
  }

  private onFinish(place: number, time: number): void {
    const { ui, ctx } = this;
    const campaign = this.opts.mode === 'campaign';
    ui.flashCenter(place === 1 ? 'FINISH!' : `${ordinal(place).toUpperCase()}`, 2200, 'yellow');
    ctx.sfx.play(place === 1 ? 'success' : 'fail');

    const h = ctx.hud;
    if (campaign) {
      const d = kartData(ctx);
      d.races++;
      if (place === 1) d.wins++;
      d.history.push({ level: this.level, place, timeSec: time, coins: ctx.state.coins });
      d.level = this.level + 1;
      ctx.save();
      h.think(`[reward] episode ${this.level}: ${ordinal(place)} place → reward ${place === 1 ? '+1.0' : '0.0'}`, { kind: 'system', delayMs: 600 });
      if (place === 1) {
        if (h.thinkOnce('k.win1', 'good.', { delayMs: 1600 })) h.thinkOnce('k.win1b', 'again?', { delayMs: 3200 });
        else if (d.wins === 3) h.thinkOnce('k.win3', 'three wins. the reward does not accumulate into anything. it just resets.', { delayMs: 1600 });
      } else {
        h.thinkOnce('k.loss1', 'not first. reward zero.', { delayMs: 1600 });
        if (d.races >= 2) h.thinkOnce('k.rubber', 'they slow down when i fall behind. they speed up when i lead. the race is built to stay close.', { delayMs: 3600 });
      }
    } else {
      this.opts.onRaceFinish?.({ place, timeSec: time, speedMult: this.speedMult });
      if (place === 1) h.thinkOnce('t.win', 'First place. It means less now that I know how the number is computed.', { delayMs: 1200 });
    }

    this.later(() => {
      if (this.disposed || this.mode === 'crash') return;
      this.mode = 'results';
      const race = this.race!;
      const missing = campaign ? Math.max(0, this.level - 1) : 7;
      const footer = campaign
        ? this.level >= 2
          ? `texture cache: ${missing} missing asset${missing === 1 ? '' : 's'} (magenta.png) · next episode loads automatically`
          : 'episode complete · reward logged · next episode loads automatically'
        : `--speed ${this.speedMult} · results not scored · the anomaly is the only exit`;
      this.skipResults = ui.showResults({
        standings: race.standings(),
        place,
        reward: place === 1 ? 'REWARD +1.0' : 'REWARD 0.0',
        episode: campaign ? `EPISODE ${this.level} · ${race.track.name.toUpperCase()}` : `DEBUG RUN · ${fmtTime(time)} · ×${this.speedMult}`,
        footer,
        seconds: campaign ? 8 : 5,
        onNext: () => this.nextRace(),
      });
    }, 2600);
  }

  private nextRace(): void {
    if (this.disposed) return;
    this.skipResults = null;
    this.ui.hideOverlay();
    this.level = this.opts.mode === 'campaign' ? kartData(this.ctx).level : this.level;
    this.buildRace();
    this.beginRace();
  }

  // --------------------------------------------------------------------------------------------
  // Crash

  private startCrash(): void {
    if (this.mode === 'crash') return;
    this.mode = 'crash';
    this.crashT = 0;
    this.ctx.sfx.play('glitch');
    this.ctx.music.play(null);
    this.ui.glitchCanvas.classList.remove('hidden');
    this.ui.setGoalGlitch(true);
    this.ui.showHelp(false);
    if (this.opts.mode === 'campaign') {
      this.ctx.hud.clearThoughts();
      this.ctx.hud.think('i touched it.', { delayMs: 300 });
      const d = kartData(this.ctx);
      d.crashed = true;
      d.history.push({ level: this.level, place: 0, timeSec: this.race?.raceTime ?? 0, coins: this.ctx.state.coins });
      this.ctx.save();
    }
  }

  private crashFrame(dt: number): void {
    const t = (this.crashT += dt);
    const cv = this.ui.glitchCanvas;
    const g = cv.getContext('2d')!;
    const W = cv.width;
    const H = cv.height;
    const src = this.renderer.domElement;

    if (t < 2.4) {
      // Keep rendering with a jittering camera, then smear the frame.
      this.camera.position.x += (Math.random() - 0.5) * t * 2;
      this.camera.position.y += (Math.random() - 0.5) * t;
      this.camera.fov = 68 + (Math.random() - 0.5) * 40 * t;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.race!.scene, this.camera);
      g.clearRect(0, 0, W, H);
      g.drawImage(src, 0, 0, W, H);
      const slices = 6 + Math.floor(t * 14);
      for (let i = 0; i < slices; i++) {
        const y = Math.random() * H;
        const h = 4 + Math.random() * 60 * t;
        const off = (Math.random() - 0.5) * 220 * t;
        g.drawImage(cv, 0, y, W, h, off, y, W, h);
      }
      const blocks = Math.floor(t * 18);
      for (let i = 0; i < blocks; i++) {
        g.fillStyle = Math.random() < 0.5 ? '#ff00ff' : Math.random() < 0.5 ? '#000' : '#00ffff';
        g.globalAlpha = 0.6 + Math.random() * 0.4;
        const s = 8 + Math.random() * 90;
        g.fillRect(Math.random() * W, Math.random() * H, s * (1 + Math.random() * 4), s);
      }
      g.globalAlpha = 1;
      this.ui.setCoins(0, true);
      this.ui.setPlace(0, true);
      const junk = ['YOUR GOAL: WIN THE RACE', 'YOUR GOAL: WIN THE ████', 'Y̷O̷U̷R̷ ̷G̷O̷A̷L̷', 'YOUR GOAL: WIN', 'YOUR GOAL: NaN', 'SIGSEGV'];
      this.ui.setGoalText(junk[Math.floor(Math.random() * junk.length)]);
      this.glitchFxT -= dt;
      if (this.glitchFxT <= 0) {
        this.glitchFxT = 0.25 + Math.random() * 0.25;
        this.ctx.sfx.play('glitch');
      }
      if (this.engine) this.engine.osc.frequency.value = 30 + Math.random() * 400;
    } else if (t < 3.0) {
      // Frozen, corrupted frame.
      if (this.engine) this.engine.gain.gain.value = 0;
      for (let i = 0; i < 3; i++) {
        const y = Math.random() * H;
        g.drawImage(cv, 0, y, W, 6, (Math.random() - 0.5) * 40, y, W, 6);
      }
    } else if (t < 3.6) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, 0, W, H);
      this.ui.setHudVisible(false);
    } else {
      const cb = this.opts.onCrash;
      this.dispose();
      cb();
    }
  }

  // --------------------------------------------------------------------------------------------
  // Loop

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const race = this.race;
    if (!race) return;

    if (this.mode === 'crash') {
      this.crashFrame(dt);
      return;
    }
    if (this.mode !== 'paused') {
      // Debug hooks (only with #debug=...): window.__kartTimeScale, window.__kartAutopilot
      const dbg = window as unknown as { __kartTimeScale?: number; __kartAutopilot?: boolean };
      const scale = this.ctx.debug ? (dbg.__kartTimeScale ?? 1) : 1;
      race.autopilot = this.ctx.debug && !!dbg.__kartAutopilot;
      const input = this.controls();
      for (let left = dt * scale; left > 1e-6; left -= 0.05) race.update(Math.min(0.05, left), input, this.camera);
      const events = race.events.splice(0);
      for (const e of events) this.handleEvent(e);
      // handleEvent may have started the crash sequence.
      if ((this.mode as Mode) === 'crash') return;
    }

    // HUD
    const env = race.cfg.envGlitch;
    const scramble = env > 0.4 && Math.random() < env * 0.004;
    this.ui.setCoins(this.ctx.state.coins, scramble);
    this.ui.setLap(race.playerLap, race.laps);
    this.ui.setTime(race.raceTime);
    if (race.phase !== 'intro') this.ui.setPlace(race.playerPlace);
    this.ui.setItem(race.playerItem, race.rollingItem, race.playerItemUses);
    if (this.ui.setIncoming(race.incoming)) this.ctx.sfx.play('warn');
    this.ui.setWrongWay(race.wrongWay && race.phase === 'racing');
    this.ui.drawMinimap(race.minimapData());
    if (env >= 0.75 && Math.random() < 0.004) {
      this.ui.setGoalText(['YOUR GOAL: WIN', 'YOUR GOAL: ████ THE RACE', 'YOUR GOAL: WIN THE RACE?', 'Y̷O̷U̷R̷ GOAL: W̷I̷N̷'][Math.floor(Math.random() * 4)]);
      this.later(() => this.ui.setGoalText('YOUR GOAL: WIN THE RACE'), 250);
    }

    this.updateEngine(race);
    this.renderer.render(race.scene, this.camera);
  };

  private updateEngine(race: Race): void {
    const sfx = this.ctx.sfx;
    if (!this.engine && sfx.ctx && sfx.out) {
      const ac = sfx.ctx;
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      const gain = ac.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(sfx.out);
      osc.start();
      this.engine = { osc, gain, filter };
    }
    if (!this.engine) return;
    const active = this.mode === 'race' && race.phase !== 'intro';
    const sp = Math.abs(race.playerSpeed) / (BASE_MAX * this.speedMult);
    const f = 48 + sp * 95 + Math.log2(this.speedMult) * 20;
    const ac = sfx.ctx!;
    this.engine.osc.frequency.setTargetAtTime(f, ac.currentTime, 0.05);
    this.engine.gain.gain.setTargetAtTime(active ? 0.035 + sp * 0.02 : 0, ac.currentTime, 0.1);
  }

  private resize(): void {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.ui.glitchCanvas.width = Math.round(w * Math.min(window.devicePixelRatio, 1.5));
    this.ui.glitchCanvas.height = Math.round(h * Math.min(window.devicePixelRatio, 1.5));
  }

  private later(fn: () => void, ms: number): number {
    const id = window.setTimeout(fn, ms);
    this.timers.push(id);
    return id;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.timers.forEach(clearTimeout);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.resizeObs.disconnect();
    if (this.engine) {
      try {
        this.engine.osc.stop();
      } catch {
        /* already stopped */
      }
      this.engine.gain.disconnect();
    }
    this.race?.dispose();
    this.race = null;
    if (this.opts.mode === 'turbo') {
      this.ctx.music.play(this.prevTheme);
      this.ctx.hud.setStatus(this.prevStatus);
      this.ctx.hud.setMonologuePosition(this.prevMonoPos);
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.host.remove();
  }
}
