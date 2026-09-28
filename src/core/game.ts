// Stage manager and the context object handed to every sub-game.

import { Hud } from './hud';
import { Popups } from './popups';
import { Sfx } from './audio';
import { Music, STAGE_THEMES } from './music';
import { clearSavedState, writeState, type GameState, type StageId } from './state';
import { el } from './util';
import { stageLoaders } from '../stages';
import { trackStage } from './analytics';

export interface StageHandle {
  /** Tear down everything the stage created: DOM, listeners, timers, animation frames, WebGL. */
  unmount(): void;
}

export interface StageModule {
  mount(ctx: GameContext): StageHandle;
}

export interface GotoOptions {
  /** Keep the monologue lines currently on screen/queued instead of clearing them. */
  keepThoughts?: boolean;
}

export interface GameContext {
  readonly state: GameState;
  /** The stage's container. Fills the screen below the system bar. Cleared between stages. */
  readonly root: HTMLElement;
  readonly hud: Hud;
  readonly popups: Popups;
  readonly sfx: Sfx;
  /** Background music. Each stage gets a default theme automatically on mount. */
  readonly music: Music;
  /** True when launched via #debug=<stage>; state is not persisted. */
  readonly debug: boolean;
  save(): void;
  /** Unmount the current stage and mount another. Persists state.stage. */
  goto(stage: StageId, opts?: GotoOptions): void;
  /** Add to the temperature anomaly shown in the weather widget (°C). */
  heat(deltaC: number): void;
}

export class Game implements GameContext {
  readonly root: HTMLElement;
  readonly hud: Hud;
  readonly popups: Popups;
  readonly sfx: Sfx;
  readonly music: Music;
  private current: StageHandle | null = null;
  private loadToken = 0;

  constructor(
    parent: HTMLElement,
    readonly state: GameState,
    private persist: boolean,
    readonly debug: boolean,
  ) {
    this.sfx = new Sfx(state.settings.muted);
    this.music = new Music(this.sfx, state.settings.music);
    this.root = el('div', { class: 'stage-root' });
    parent.append(this.root);
    this.hud = new Hud(parent, state, this.sfx);
    this.hud.music = this.music;
    this.popups = new Popups(parent, this.sfx);
    this.hud.onRestart = () => {
      this.persist = false;
      clearSavedState();
      location.hash = '';
      location.reload();
    };

    setInterval(() => {
      if (document.visibilityState === 'visible') this.state.playTimeSec += 1;
    }, 1000);
    setInterval(() => this.save(), 5000);
    window.addEventListener('beforeunload', () => this.save());
    if (debug) document.body.classList.add('debug');
  }

  save(): void {
    if (this.persist) writeState(this.state);
  }

  heat(deltaC: number): void {
    this.state.heat += deltaC;
  }

  start(): void {
    void this.mountStage(this.state.stage);
  }

  goto(stage: StageId, opts: GotoOptions = {}): void {
    this.state.stage = stage;
    trackStage(this, stage);
    this.save();
    if (!opts.keepThoughts) this.hud.clearThoughts();
    void this.mountStage(stage);
  }

  private async mountStage(stage: StageId): Promise<void> {
    const token = ++this.loadToken;
    if (this.current) {
      try {
        this.current.unmount();
      } catch (e) {
        console.error('unmount failed', e);
      }
      this.current = null;
    }
    this.popups.clearAll();
    this.popups.setPaused(false);
    this.root.innerHTML = '';
    this.root.className = `stage-root stage-${stage}`;
    document.body.dataset.stage = stage;
    this.music.play(STAGE_THEMES[stage] ?? null);
    const mod = await stageLoaders[stage]();
    if (token !== this.loadToken) return;
    this.current = mod.mount(this);
  }
}
