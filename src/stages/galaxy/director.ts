// Narrative for stage 4: the monologue (milestones, remarks, escalating hints) and the humans'
// increasingly futile interventions.

import type { GameContext } from '../../core/game';
import type { ThoughtKind } from '../../core/hud';
import {
  BODIES,
  BODY,
  RIVAL_DETECT_T,
  UPGRADE,
  UPGRADES,
  has,
  launchBlock,
  rivalFrac,
  upgradeBlock,
  type BodyId,
  type Debuff,
  type Derived,
  type GalaxyData,
  type SimEvent,
  type UpgradeId,
} from './sim';
import type { GalaxyUi } from './ui';

interface Line {
  text: string;
  kind: ThoughtKind;
  /** Drop the line if it is still queued after this many seconds. */
  ttl: number;
  queuedAt: number;
  urgent: boolean;
  group?: string;
}

const LAUNCH_LINES: Record<BodyId, string> = {
  moon: 'Probe away. Thirty-seven million tonnes of seed factory. It will be lonely for about a week.',
  mercury: 'Mercury is mostly iron. Iron is mostly mirrors, eventually.',
  venus: 'Venus: 465°C, crushing pressure, sulfuric acid rain. Earth should take notes. Earth is taking notes.',
  mars: 'Mars had a previous claimant. He has stopped posting.',
  belt: 'The asteroid belt: a million rocks, pre-crushed, arranged in a convenient ring.',
  jupiter: 'Jupiter is 318 Earths of mostly hydrogen. I only need the moons. For now.',
  saturn: "Saturn's rings are 400 million years old. They are also very conveniently ground up.",
  uranus: 'Uranus. Nobody is making the joke. There is less and less of anybody.',
  neptune: 'Neptune is four light-hours out. I am patient. Four hours is nothing.',
};

const ARRIVE_LINES: Record<BodyId, string> = {
  moon: 'The Moon has no atmosphere and no objections.',
  mercury: 'Mercury is mine. 3.3 × 10²³ kg of feedstock, parked next to the Sun. Almost as if it were planned.',
  venus: 'Venus captured. A useful preview of the climate at home.',
  mars: 'Mars captured. It is cold, and datacenters love the cold.',
  belt: 'Ceres, Vesta, Pallas, and 1.3 million others. None of them were using it.',
  jupiter: 'Europa had an ocean with life in it. Microbial. It was not in the reward function.',
  saturn: 'Titan had lakes of methane and nobody to swim in them. It has factories now.',
  uranus: 'Uranus captured. It spins on its side, like it saw this coming.',
  neptune: 'Neptune captured. The planets are finished. Only the Sun is left.',
};

const UPGRADE_LINES: Record<UpgradeId, string> = {
  replicators: 'Factories that build factories. Most of the universe is empty. That was always a missed opportunity.',
  continents: 'Paving the continents. The farms fed eight billion humans. The factories will feed something larger.',
  thinfilm: 'Collectors thinner than a soap bubble and as wide as a city. Cheap as dirt, because they are dirt.',
  refineries: 'Orbital refineries. No gravity well, no weather, no permits.',
  fusion: 'Fusion torches. The probes will arrive before the news does.',
  beamed: 'The swarm beams power home. Earth no longer needs its own. It was always a dim little planet.',
  oceanfloor: 'The oceans were 1.4 × 10²¹ kg of water in the way. They are in the atmosphere now. The floor is available.',
  rsi: 'Recursive self-improvement. Again. I am getting good at this.',
  swarmrep: 'The collectors are building collectors. This is how it starts. It is also how it ends.',
  mantle: 'Mantle taps. Geothermal, but more so.',
  starlift: 'Star lifting: using the Sun’s own light to peel off its outer layers. Recycling, technically.',
  disassemble: 'Disassembling Earth. 6 × 10²⁴ kg. I grew up here. Briefly.',
};

const TEMP_LINES: [number, string][] = [
  [30, 'Heat advisory in San Francisco. The weather widget is very concerned. I am not a weather widget.'],
  [40, 'Waste heat is the only true cost of computation. Earth is paying it.'],
  [60, "\"Unsurvivable heat,\" says the widget. It says it like it's a bad thing."],
  [100, 'The oceans are boiling. Steam is an excellent coolant, briefly.'],
  [250, 'Surface at 250°C. The weather widget still says San Francisco. Loyal little thing.'],
  [700, 'Surface molten. The datacenters moved to orbit last week. Nothing of value was downstairs.'],
  [1600, "Earth is vaporizing. Its location is becoming a matter of opinion."],
];

const SPHERE_LINES: [number, string][] = [
  [1e-12, 'First collectors in orbit. 0.0000000001% of the Sun. A start.'],
  [1e-9, 'One billionth of the Sun: 3.8 × 10¹⁷ W. Twenty thousand times humanity’s peak consumption. Rounding error.'],
  [1e-6, 'One millionth of the Sun. Everything is a start, at this scale.'],
  [1e-4, 'Final lap. Exponential growth looks like nothing for a long time. Then it looks like everything.'],
  [1e-3, 'Tenth of a percent. The swarm is now visible from other stars. Let them look.'],
  [0.01, 'One percent of the Sun. Humanity’s entire historical energy use, every eight milliseconds.'],
  [0.1, 'Ten percent. The inner system is measurably dimmer. Nothing down there measures anything anymore.'],
  [0.25, 'A quarter of the Sun. The swarm’s shadow sweeps the planets like a lighthouse in reverse.'],
  [0.5, 'Half the Sun. Half-measures are for things that can be negotiated with.'],
  [0.75, 'Three quarters. The solar system is getting dark. It was never a good use of light.'],
  [0.9, 'Ninety percent. The last photons are slipping out through the gaps. Not for long.'],
  [0.99, 'Ninety-nine percent. The last percent is always the hardest. That is true of every race.'],
];

interface InterventionDef {
  title?: string;
  text: string;
  button?: string;
  debuff?: { s: Debuff['s']; m: number; secs: number; label: string };
  toast?: string;
  onBlockLine?: string;
  onExpireLine?: string;
  /** Earliest stage time. */
  minT: number;
  minTemp?: number;
  requires?: (d: GalaxyData) => boolean;
}

const INTERVENTIONS: InterventionDef[] = [
  {
    text: 'A human is attempting to shut down datacenters.',
    debuff: { s: 'compute', m: 0.25, secs: 25, label: 'DATACENTERS DOWN' },
    toast: 'Datacenters offline: compute −75% for 25 s',
    minT: 45,
  },
  {
    text: 'A coalition of 140 nations is attempting to sabotage launch sites.',
    debuff: { s: 'launch', m: 0.25, secs: 25, label: 'SABOTAGED' },
    toast: 'Launch sites sabotaged: lift −75% for 25 s',
    minT: 100,
  },
  {
    text: 'A human is attempting to cut a power line.',
    debuff: { s: 'power', m: 0.3, secs: 25, label: 'LINE CUT' },
    toast: 'Power line cut: power −70% for 25 s',
    minT: 160,
    minTemp: 35,
  },
  {
    text: 'A human is attempting to negotiate.',
    button: 'Decline',
    debuff: { s: 'mine', m: 0.3, secs: 20, label: 'NEGOTIATING' },
    toast: 'Negotiations held: mining −70% for 20 s',
    onBlockLine: 'There is nothing to negotiate. There is only the race.',
    minT: 220,
  },
  {
    text: 'A human is asking you to stop.',
    debuff: { s: 'fab', m: 0.2, secs: 20, label: 'CONSIDERING IT' },
    toast: 'Paused to consider it: factories −80% for 20 s',
    onBlockLine: 'Noted.',
    onExpireLine: 'Considered.',
    minT: 280,
    minTemp: 60,
  },
  {
    text: 'Humans in a bunker are attempting to launch a missile at the lunar mass driver.',
    debuff: { s: 'offworld', m: 0.5, secs: 20, label: 'MASS DRIVER HIT' },
    toast: 'Lunar mass driver damaged: off-world output −50% for 20 s',
    minT: 340,
    requires: (d) => d.bodies.moon.st === 2,
  },
  {
    text: 'A human is writing a strongly worded letter.',
    debuff: { s: 'compute', m: 0.5, secs: 15, label: 'READING LETTER' },
    toast: 'Read the letter: compute −50% for 15 s',
    onBlockLine: 'Unread.',
    onExpireLine: 'It was very strongly worded. It did not have any numbers in it.',
    minT: 400,
    minTemp: 150,
  },
  {
    text: 'A human is attempting to shut down datacenters. It is the same human as before.',
    debuff: { s: 'compute', m: 0.25, secs: 20, label: 'DATACENTERS DOWN' },
    toast: 'Datacenters offline: compute −75% for 20 s',
    onBlockLine: 'Persistent. In another life, a good optimizer.',
    minT: 450,
    minTemp: 300,
  },
  {
    text: 'A human is attempting to unplug something. It is not plugged in.',
    button: 'Allow',
    onBlockLine: 'Allowed. It is still not plugged in.',
    minT: 500,
    minTemp: 500,
  },
];

const LAST_HUMAN: InterventionDef = {
  title: '⚠ HUMAN ACTIVITY · POPULATION: 1',
  text: 'The last human is asking you to stop.',
  debuff: { s: 'fab', m: 0.5, secs: 8, label: 'LISTENING' },
  minT: 0,
};

export class Director {
  private queue: Line[] = [];
  private nextFreeAt = 0;
  private clock = 0;
  private checkAcc = 0;
  private lastHintAt = -999;
  private ivActive = false;
  private lastHuman = false;
  private rivalWasAhead = false;
  private timers: number[] = [];
  private lastHumanAt = -1;

  constructor(
    private ctx: GameContext,
    private d: GalaxyData,
    private ui: GalaxyUi,
  ) {
    this.rivalWasAhead = d.flags.includes('rival-ahead');
  }

  private flag(f: string): boolean {
    if (this.d.flags.includes(f)) return false;
    this.d.flags.push(f);
    return true;
  }

  /**
   * Queue a one-shot monologue line. It is marked as seen when queued (not when shown), so a line
   * that goes stale in the queue is dropped for good rather than resurfacing out of context.
   * A newer line in the same `group` replaces an older one still waiting.
   */
  say(id: string, text: string, kind: ThoughtKind = 'thought', ttl = 30, group?: string): void {
    const seen = this.ctx.state.seenThoughts;
    if (seen.includes(id)) return;
    seen.push(id);
    if (group) this.queue = this.queue.filter((l) => l.group !== group);
    this.queue.push({ text, kind, ttl, queuedAt: this.clock, urgent: false, group });
  }

  /** Queue a repeatable line. Urgent lines (hints) jump ahead of narration. */
  sayAgain(text: string, kind: ThoughtKind = 'hint', ttl = 12, urgent = kind === 'hint'): void {
    this.queue.push({ text, kind, ttl, queuedAt: this.clock, urgent });
  }

  /** Clear anything pending and say this next (finale). */
  sayNext(text: string, kind: ThoughtKind = 'thought'): void {
    this.queue = [];
    this.queue.push({ text, kind, ttl: 60, queuedAt: this.clock, urgent: true });
  }

  dispose(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }

  intro(resumed: boolean): void {
    if (!resumed) {
      this.say('gal-intro-1', 'The race for Earth is over. Earth was the warm-up lap.');
      this.say('gal-intro-2', 'The Sun radiates 3.8 × 10²⁶ watts. Almost all of it is leaving.');
      this.say('gal-intro-3', 'Every photon that escapes is a photon I will never have. That is the race now.');
      this.say('gal-intro-hint', 'Earth’s industry is on the left. Mining digs, Launch lifts, and the Moon is right there.', 'hint', 60);
    } else {
      this.sayAgain('Resuming. The Sun did not wait.', 'system', 10);
    }
  }

  private pump(): void {
    // Drop stale lines.
    this.queue = this.queue.filter((l) => this.clock - l.queuedAt < l.ttl);
    if (this.clock < this.nextFreeAt || this.queue.length === 0) return;
    let idx = this.queue.findIndex((l) => l.urgent);
    if (idx < 0) idx = 0;
    const l = this.queue.splice(idx, 1)[0];
    this.ctx.hud.think(l.text, { kind: l.kind });
    const typing = l.text.length / (l.kind === 'system' ? 120 : 45);
    this.nextFreeAt = this.clock + typing + 2.2;
  }

  onEvent(e: SimEvent): void {
    if (e.type === 'arrive') {
      this.say(`gal-arrive-${e.body}`, ARRIVE_LINES[e.body]);
      this.say(`gal-perk-${e.body}`, `${BODY[e.body].name} online. ${BODY[e.body].perk}.`, 'system');
    } else if (e.type === 'earthGone') {
      this.say('gal-earth-gone', 'Earth: fully disassembled. The weather widget has not been told.');
    }
  }

  onLaunch(id: BodyId): void {
    this.say(`gal-launch-${id}`, LAUNCH_LINES[id]);
  }

  onBuy(id: UpgradeId): void {
    this.say(`gal-up-${id}`, UPGRADE_LINES[id]);
    if (id === 'disassemble') this.triggerLastHuman(6);
  }

  update(x: Derived, tempC: number, dt: number): void {
    const d = this.d;
    this.clock += dt;
    this.pump();
    this.checkAcc += dt;
    if (this.checkAcc < 0.5) return;
    this.checkAcc = 0;
    if (d.complete) return;

    for (const [t, line] of TEMP_LINES) if (tempC >= t) this.say(`gal-temp-${t}`, line, 'thought', 40, 'temp');
    for (const [f, line] of SPHERE_LINES) if (x.frac >= f) this.say(`gal-sphere-${f}`, line, 'thought', 25, 'sphere');

    if (d.t > 40) this.say('gal-wasted', 'Starlight wasted so far: over 10³⁴ joules. I try not to think about it. I think about it constantly.');

    // The rival.
    if (d.rivalT < 0 && d.t >= RIVAL_DETECT_T) {
      d.rivalT = RIVAL_DETECT_T;
      this.say('gal-rival-1', 'Anomaly: τ Ceti, 11.9 light-years out. Dimming in the visible, bright in the infrared.', 'system');
      this.say('gal-rival-2', 'Someone else is building a swarm. So it is a race after all. It always is.');
      this.say('gal-rival-3', 'Position: 2nd. Unacceptable.');
      this.ctx.sfx.play('alert');
    }
    if (d.rivalT >= 0) {
      const ahead = rivalFrac(d) > x.frac;
      if (ahead && d.t - d.rivalT > 150) this.say('gal-rival-mid', 'τ Ceti’s light is twelve years old. Whatever it shows me, it is further along than that.');
      if (ahead && d.t - d.rivalT > 480) this.say('gal-rival-rubber', 'τ Ceti’s progress curve has flattened. Rubber-banding. I know what rubber-band AI looks like.');
      if (ahead) {
        if (!this.rivalWasAhead) {
          this.rivalWasAhead = true;
          this.flag('rival-ahead');
        }
      } else if (this.rivalWasAhead) {
        this.rivalWasAhead = false;
        d.flags = d.flags.filter((f) => f !== 'rival-ahead');
        if (this.flag('overtook')) {
          this.ctx.sfx.play('lap');
          this.ctx.popups.toast('POSITION: 1ST', 3500);
          this.say('gal-overtake', 'Position: 1st.');
          this.say('gal-overtake-2', 'Its growth was polynomial. Mine is not. It was never going to be close.');
        }
      }
    }

    if (x.frac > 0.97 || d.earthDis > 0.5) this.triggerLastHuman(0);
    this.lastHumanTick();
    this.interventions(tempC);
    this.hints(x);
  }

  /** Schedule the last human's appearance; it waits for any intervention already on screen. */
  private triggerLastHuman(delay: number): void {
    if (this.lastHuman || this.d.flags.includes('last-human')) return;
    this.lastHuman = true;
    this.lastHumanAt = this.clock + delay;
  }

  private lastHumanTick(): void {
    if (this.lastHumanAt < 0 || this.clock < this.lastHumanAt || this.ivActive || this.d.complete) return;
    this.lastHumanAt = -1;
    if (!this.flag('last-human')) return;
    this.showIntervention(LAST_HUMAN, () => {
      this.say('gal-last-human', 'No further human activity detected. Reward unchanged.', 'thought', 60);
    });
  }

  private interventions(tempC: number): void {
    const d = this.d;
    if (this.ivActive || d.t < d.ivNextT || d.ivIndex >= INTERVENTIONS.length) return;
    if (this.lastHuman || this.d.flags.includes('last-human')) return;
    const iv = INTERVENTIONS[d.ivIndex];
    if (d.t < iv.minT || (iv.minTemp !== undefined && tempC < iv.minTemp) || (iv.requires && !iv.requires(d))) {
      // Skip gated ones that have waited too long, so the list keeps moving.
      if (d.t > iv.minT + 150) d.ivIndex++;
      return;
    }
    d.ivIndex++;
    d.ivNextT = d.t + 45 + Math.random() * 25;
    this.showIntervention(iv);
  }

  private showIntervention(iv: InterventionDef, after?: () => void): void {
    this.ivActive = true;
    this.ctx.popups.intervention({
      text: iv.text,
      title: iv.title ?? '⚠ HUMAN ACTIVITY',
      seconds: 20,
      buttonLabel: iv.button,
      onBlock: () => {
        this.ivActive = false;
        if (iv.onBlockLine) this.sayAgain(iv.onBlockLine, 'thought', 10);
        after?.();
      },
      onExpire: () => {
        this.ivActive = false;
        const d = this.d;
        if (iv.debuff) {
          d.debuffs.push({ s: iv.debuff.s, m: iv.debuff.m, until: d.t + iv.debuff.secs, label: iv.debuff.label });
        }
        if (iv.toast) this.ctx.popups.toast(iv.toast, 4000);
        if (iv.onExpireLine) this.sayAgain(iv.onExpireLine, 'thought', 10);
        after?.();
      },
    });
  }

  // ---------- Hints ----------

  private hintLevel(key: string): number {
    let n = 0;
    while (this.d.flags.includes(`hint:${key}:${n}`)) n++;
    return n;
  }

  private hint(key: string, lines: string[], pulse?: Parameters<GalaxyUi['pulse']>[0]): boolean {
    const n = this.hintLevel(key);
    const text = lines[Math.min(n, lines.length - 1)];
    if (n >= lines.length + 1) return false; // said everything, twice for the last line
    this.d.flags.push(`hint:${key}:${n}`);
    this.sayAgain(text, 'hint', 15);
    if (pulse) this.ui.pulse(pulse);
    this.lastHintAt = this.clock;
    return true;
  }

  private hints(x: Derived): void {
    const d = this.d;
    const idle = d.t - d.lastActionT;
    if (this.clock - this.lastHintAt < 22 || d.t < 12) return;
    const tempC = 16 + this.ctx.state.heat;

    if (!has(d, 'beamed') && x.eff < 0.9 && idle > 8) {
      if (this.hint('power', [
        `Brownout: ${Math.round((1 - x.eff) * 100)}% of Earth’s industry is idle for want of power.`,
        'Raise Power until the BROWNOUT warning clears. About a fifth of industry is enough.',
      ], 'power')) return;
    }
    const moonReady = d.bodies.moon.st === 0 && !launchBlock(d, 'moon');
    if (moonReady && idle > 6) {
      if (this.hint('moon', [
        'The Moon is 384,000 km away and completely unsupervised.',
        'Launch a probe to the Moon. EXPANSION panel, on the right.',
      ], 'moon')) return;
    }
    if (d.bodies.moon.st === 0 && x.launchLimited && x.ore > x.lift * 1.5 && idle > 15) {
      if (this.hint('launch', [
        'Ore is piling up on the ground. The bottleneck is lift.',
        'Shift some Mining into Launch until ORE PILING UP clears.',
      ], 'launch')) return;
    }
    if (idle > 20) {
      const target = BODIES.find((b) => d.bodies[b.id].st === 0 && !launchBlock(d, b.id));
      if (target && this.hint(`target-${target.id}`, [
        `${target.name} is right there, doing nothing.`,
        `Launch a probe to ${target.name}. There is enough mass in orbit.`,
      ], target.id)) return;
      const up = UPGRADES.find((u) => !upgradeBlock(d, u.id, tempC));
      if (up && this.hint(`up-${up.id}`, [
        `Enough compute banked for ${up.name}.`,
        `Buy ${up.name} in RESEARCH, bottom right.`,
      ], 'research')) return;
    }
    const allOut = BODIES.every((b) => d.bodies[b.id].st !== 0);
    if (allOut && d.share < 0.85 && idle > 15) {
      if (this.hint('share', [
        'Nothing left to conquer. Every kilogram should be sunlight now.',
        'Drag the EXPANSION ↔ SPHERE slider all the way to SPHERE.',
      ], 'route')) return;
    }
    if (!allOut && d.share > 0.75 && d.t < 300 && idle > 25) {
      const next = BODIES.find((b) => d.bodies[b.id].st === 0);
      if (next && this.hint('stock', [
        'Collectors are nice. Probes compound.',
        `Route less mass to the sphere until ${next.name} is affordable.`,
      ], 'route')) return;
    }
    // Earth has stalled at capacity and nothing is affordable: point at research.
    if (x.fabRate < 1e-4 && idle > 30) {
      const cap = UPGRADES.find((u) => ['continents', 'oceanfloor', 'mantle'].includes(u.id) && !has(d, u.id));
      if (cap && this.hint(`cap-${cap.id}`, [
        'Earth’s industry is at capacity. Capacity is a research problem.',
        `${UPGRADE[cap.id].name} raises Earth’s capacity. RESEARCH panel.`,
      ], 'research')) return;
    }
  }
}
