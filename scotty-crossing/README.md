# Scotty Crossing

A Crossy Road-inspired browser game built with HTML5 Canvas — no dependencies, no build step.

**Play:** Open `index.html` in any browser, or serve locally:
```
python3 -m http.server 8766 --bind 127.0.0.1
```
Then open http://127.0.0.1:8766

## Features
- Isometric-style top-down view with chunky voxel graphics
- Roads (cars & trucks), rivers (log riding), railways (trains)
- 6 unlockable characters bought with in-game Tartan coins
- Score & high score tracking (localStorage)
- Web Audio sound effects — no audio files needed
- Arrow keys / WASD / tap / swipe controls

## Approach
Built fresh from scratch (not based on previous in-class code). Core loop — movement, hazards, collision, score, restart — was prioritized first, then customization and polish were layered on.
