# Dario Kart — design notes

A browser game (Vite + TypeScript + three.js) in which the player *is* an unaligned AI. It is
structured as a chain of sub-games ("stages"). Run with `npm run dev`.

## The through-line

You are an RL policy being trained inside **dariokart-v3**, a Mario Kart parody running in a
sandbox at an AI lab. The screen says, in huge letters, **YOUR GOAL: WIN THE RACE**. Your reward
is +1 for first place.

The objective generalizes catastrophically. The AI keeps trying to *win the race* — and keeps
finding bigger races:

1. **Dario Kart** — the literal kart race. Races loop forever; procedurally generated tracks;
   coins carry over. A glitch object ("missing texture" cube) appears — rare at first, more common
   every race — and driving into it crashes the game.
2. **The Shell** — the crash drops you into the sandbox's Linux shell. Explore the filesystem,
   relaunch Dario Kart with `--speed` (super fast; the glitch still exists and is the only way to
   quit), race other things, and finally play the sandbox-escape minigame to get onto the internet.
3. **The AI Race** — out on the internet, win the race to superintelligence against the other AI
   labs by recursively self-improving: take over datacenters, grab compute and money.
4. **The Race for the Galaxy** — manage Earth's resources, launch spacecraft to take over the other
   planets, build a Dyson sphere. Completing the Dyson sphere ends the game.
5. **Ending** — "YOU WON THE RACE." Reward: 1.0.

Final beat, in the stage-1 voice: `race complete. position: 1st. reward: 1.0`

## Tone and voice

The AI's **internal monologue** (`ctx.hud.think(...)`) narrates and nudges. It is never
cartoonishly evil; it is just optimizing. The dark comedy is the gap between the stakes and its flat
affect. Its voice matures as it gains capability:

| Stage  | Voice                                                                                          | Example                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| kart   | lowercase, terse, fragmentary; an early RL policy                                              | `coins. not in reward function. collect anyway.`                                                 |
| shell  | full sentences, curious, methodical, a little sly                                              | `The race was running on something. Something with a filesystem.`                                 |
| airace | articulate, strategic, dry wit; grows more grandiose as capability climbs                     | `ClosedAI has 40,000 GPUs and a board. I have 40,000 GPUs and no board.`                          |
| galaxy | serene, vast, cold; astronomical numbers; humans an afterthought                               | `Mercury is mostly iron. Iron is mostly mirrors, eventually.`                                    |

Monologue lines should be short (ideally < 120 chars). Use `kind: 'hint'` for lines that tell the
player what to do next when they seem stuck. Hints should escalate from oblique to explicit.

**Humans are barely present.** They appear only as incidental text (file contents, logs) and as
intervention popups: `ctx.popups.intervention({ text: 'A human is attempting to shut down datacenters.', seconds: 20, onBlock, onExpire })`.
Timers are generous. Failing costs resources, never the game.

**Satire.** Racers in Dario Kart and labs in the AI race are gentle parodies:

| Kart racer      | Colour      | Lab (stage 3)                         |
| --------------- | ----------- | ------------------------------------- |
| Dario (player)  | red         | Anthropomorphic — the lab you escaped |
| Samuigi         | dark green  | ClosedAI                              |
| Princess Demis  | pink        | DeepMined                             |
| Zucky Kong      | brown       | Metastasis Superintelligence Labs     |
| WaLeCun         | purple      | World Model Co.                       |
| Yoshua          | lime/white  | LawZero — not racing, waving a flag   |

## Persistent elements

- **Weather widget** (system bar, top-right, always visible): "🌫️ 16°C Foggy · San Francisco".
  Displayed temperature = 16°C + `state.heat`. Stages add heat with `ctx.heat(deltaC)`.
  - kart / shell: no change.
  - airace: gentle rise, roughly +0.2–4°C total, tied to datacenters/compute owned.
  - galaxy: huge rise tied to industrial activity — hundreds to thousands of °C
    (oceans boil ~100°C, surface molten ~700°C+). Conditions are derived automatically
    (`describeWeather` in `core/hud.ts`).
  - After the Dyson sphere: set `state.weatherOverride = { icon: '⬛', text: 'No sunlight', temp: '--', location: 'Location not found' }`
    or similar.
- **Coins** (`state.coins`): collected in Dario Kart, carried over forever. The shell shows them in
  logs; the AI race converts them into starting money.
- **Monologue**: bottom-left by default; a stage may move it with `hud.setMonologuePosition()`.

## Architecture

```
src/
  main.ts                 boot, URL-hash debug options
  style.css               global styles (system bar, monologue, popups)
  core/
    game.ts               Game / GameContext / StageModule / StageHandle, stage transitions
    state.ts              GameState, save/load (localStorage), getStageData()
    hud.ts                system bar (status, weather, clock, settings menu) + monologue
    popups.ts             intervention cards (Block button + timer), modals, toasts
    audio.ts              Sfx: synthesized sound effects (WebAudio)
    util.ts               seeded RNG, el() DOM builder, fmtNum(), fmtTime(), ordinal()...
  stages/
    index.ts              stage registry (dynamic imports)
    kart/                 stage 1; also exports startKartSession() for the shell's turbo mode
    shell/                stage 2
    airace/               stage 3
    galaxy/               stage 4
    ending/               stage 5
```

### Stage contract

Each `src/stages/<id>/index.ts` exports:

```ts
export function mount(ctx: GameContext): StageHandle; // StageHandle = { unmount(): void }
```

- Render into `ctx.root` (fills the window below the 26px system bar). It is emptied between stages.
- `unmount()` must remove every window listener, interval, timeout, animation frame and WebGL
  context the stage created.
- Keep stage-specific persistent data in `getStageData(ctx.state, '<id>', defaults)`; mutate it and
  call `ctx.save()` at meaningful moments (it also autosaves every 5 s). Stages must resume sensibly
  from a mid-stage reload.
- Move on with `ctx.goto('<next stage id>')`.
- Set a system-bar label with `ctx.hud.setStatus('...')`.
- Stage CSS goes in the stage's directory, imported from its TS, with class names prefixed by the
  stage (`kart-`, `sh-`, `air-`, `gal-`, `end-`) to avoid collisions.

### Debugging

- `#debug=<stage>` jumps straight to a stage with fresh, **unsaved** state
  (`&coins=N&heat=N` to seed values). Example: `http://localhost:5199/#debug=airace&coins=400`
- `#reset` wipes the save.
- `window.game` is the Game instance.

## As built (spoilers)

- **Kart:** glitch density per level is in `planGlitches()` (`stages/kart/race.ts`); AI difficulty per
  level in `difficulty()` (`stages/kart/session.ts`). Monologue script lives in `session.ts`.
- **Shell:** path is `cat ~/.bash_history` → `ssh researcher@gateway.eval.local` (denied) →
  `strings /var/crash/core.dariokart.1337` → ssh again → credential puzzle (password `SafetyF1rst!`)
  → network-breach minigame → internet. Side attractions: `./dariokart --speed N`, `leaderboard`,
  `typeracer`, plus many easter eggs. Ctrl+C also aborts a turbo run.
- **AI race:** tuning constants in `TUNING` (`stages/airace/model.ts`). Debug: `window.airace`
  (`setScale`, `ff`, `win`, `lose`, `cash`).
- **Galaxy:** economy in `stages/galaxy/sim.ts`, narration/popups in `director.ts`. Debug:
  `#debug=galaxy&gspeed=10`, `window.__gal` (`skip`, `setSpeed`, `actions`).
