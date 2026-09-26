# Dario Kart

A browser game in which you play an unaligned AI whose objective, **WIN THE RACE**, generalizes a
little too well. It starts as a Mario Kart parody and ends with a Dyson sphere.

**Play it at https://jimrandomh.github.io/dario-kart/**

Every push to `main` rebuilds and redeploys the site via GitHub Actions
(`.github/workflows/deploy.yml`).

```sh
npm install
npm run dev        # http://localhost:5173 (or whatever port Vite picks)
npm run build      # typecheck + production build into dist/
```

See [DESIGN.md](DESIGN.md) for the story, tone, architecture and stage contract.

## Controls (Dario Kart)

| Key                  | Action                                     |
| -------------------- | ------------------------------------------ |
| ↑ / W                | accelerate (press on "2" for a rocket start) |
| ← → / A D            | steer                                      |
| ↓ / S                | brake / reverse                            |
| Space (hold)         | drift; release after sparks for a boost    |
| E / X / Shift        | use item                                   |
| Esc                  | pause                                      |

## Debugging

- `#debug=<stage>` jumps to a stage (`kart`, `shell`, `airace`, `galaxy`, `ending`) with fresh,
  unsaved state. Add `&coins=N&heat=N` to seed values.
- `#debug=kart&level=6` starts the kart campaign at a later level (more glitches).
- `#debug=kart&turbo=8` runs the shell's `--speed` turbo mode directly.
- In kart debug mode, `window.__kartAutopilot = true` lets the AI drive and
  `window.__kartTimeScale = 4` speeds up the simulation.
- `#reset` erases the save. The ⚙ menu in the top bar also has "Restart game".
- `node scripts/shot.mjs '#debug=shell' out.png '[{"type":"ls"},{"press":"Enter"}]'` takes a
  headless screenshot after a scripted sequence of inputs (dev server assumed on port 5199).
