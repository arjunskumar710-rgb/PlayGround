<!-- omgithub:readme:start -->
## 🚀 Build, play, and remix with OMGithub

**Created using [OMGithub.com](https://go.ondev.store/).**

[![OMGithub](https://img.shields.io/badge/OMGithub-Open%20project-orange?style=for-the-badge)](https://go.ondev.store/arjunskumar710-rgb/PlayGround)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?style=for-the-badge&logo=github)](https://github.com/arjunskumar710-rgb/PlayGround)

- 🎮 [Open the project](https://go.ondev.store/arjunskumar710-rgb/PlayGround).
- ✨ [Remix this project](https://go.ondev.store/arjunskumar710-rgb/PlayGround?remix=1).
- 💻 [Explore the source](https://github.com/arjunskumar710-rgb/PlayGround).
- 🛠️ [Check build runs](https://github.com/arjunskumar710-rgb/PlayGround/actions).
- 🐛 [Report an issue](https://github.com/arjunskumar710-rgb/PlayGround/issues).
- 👤 [Explore the creator's projects](https://go.ondev.store/arjunskumar710-rgb).
- 🌍 [Create with OMGithub](https://go.ondev.store/).
<!-- omgithub:readme:end -->

# LASER CHESS

A neon, local two-player game of mirrors, emitters and light. Move or rotate one
piece per turn, then fire the laser. Angle your mirrors to burn the enemy king —
or shatter an opponent's mirror by striking its dark back.

Play it on phone, tablet or desktop. No build step and no external assets.

## How to play

1. **PLAY** starts a local match. Red moves first.
2. Tap one of your pieces to select it.
3. **Move** to a highlighted tile, or **ROTATE** (or tap the selected mirror/emitter
   again) to turn it 90°.
4. Press **FIRE**. The beam charges, travels, reflects, and destroys vulnerable
   pieces. The turn then passes to the other player.
5. Hit the opposing king with your beam to win.

You get **one action** (move *or* rotate) plus **one shot** per turn. Firing
without using the action is allowed. Pieces, emitters and kings block movement;
everything stops or redirects the beam.

### Piece notes

- **King** — one hit from an enemy beam ends the match.
- **Mirror** — the bright face reflects; the dark, striped back shatters the
  mirror and stops the beam. Four 90° facings (two diagonal silhouettes) let both
  sides angle toward the centre.
- **Emitter** — fires straight ahead at the end of the turn. Emitters absorb
  beams; they cannot be destroyed.

## Run locally

Serve the folder as static files, then open the page:

```sh
python3 -m http.server 3000
# http://localhost:3000
```

## Test the rules engine

```sh
node --test
```

The rules tests cover setup symmetry, legal movement, action limits, reflection
and vulnerability directions, beam blocking, king hits and loop termination.

## Source layout

- `index.html` — screens and controls
- `styles.css` — responsive neon UI
- `js/game.js` — pure rules engine and laser tracing
- `js/renderer.js` — canvas board, pieces, glow, animations
- `js/main.js` — turns, input, UI state and animation clock
- `js/audio.js` — synthesised sound effects
- `tests/game.test.mjs` — rules tests
