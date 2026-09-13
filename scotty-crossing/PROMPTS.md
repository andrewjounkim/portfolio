# Prompt Log — Scotty Crossing

A record of the AI-assisted development conversation that produced this game.

---

## Session Summary

**Tool:** Kiro (AI agent)  
**Date:** 2026-09-13  
**Goal:** Build a Crossy Road clone from scratch

---

## Prompt History

**1.** "help me make a remake of the popular game crossy road and ask me any questions throughout the process that might help you create it."

**2.** *(Question card answers)*
- Visual style: Isometric 3D voxel (like the real Crossy Road)
- Character: Chicken (classic Crossy Road)
- Features: Score/high score tracking, Sound effects, Multiple obstacle types (cars, trains, logs), Coins to collect, Unlockable characters
- Polish: "make a solid prototype first, ill review and tell you what to add or remove and then lets polish it"

**3.** *(Requirements injected mid-build)*
- Decide whether to build on in-class code or restart — chose restart
- Get core loop solid first: movement, hazards, collision, score, restart
- Then customize
- Test by opening index.html in browser, watch console for errors
- At ~4 hours, stop and write REFLECTION.md

**4.** "i cant see the screen, only the game. review the code and help me access it locally"

**5.** "no" *(confirming hard refresh didn't work)*

**6.** "i still dont see anything"

**7.** "i only see the text and nothing else"

**8.** "i made some edits using claude but i need more help making this look like the actual real crossy road with the bigger grids and less compact screen play"
*(Uploaded edited index.html — the "Scotty Crossing" CMU-themed version)*

**9.** *(Shared screenshot of real Crossy Road gameplay)*
"its still too crammed. the camera doesnt move with the character so if u go far enough it goes off screen and i want the graphics to look like crossy roads blockiness not these lines that are so hard to see and crammed together. heres an example of what crossy roads actually looks like"

**10.** "i think you need to completely scrap the graphics. redo it. make it 3d and make it like crossy road with character moving all directions and cars and logs and stuff moving left to right only"

**11.** *(Console errors reported)*
"chrome, Uncaught TypeError: Cannot read properties of undefined (reading 'addEventListener')"

**12.** "much better. a problem is that the player can go through trees. thats not good. another major thing i want you to change is the view. this is like 2d from the top i want 3d from kind of like the side but keep this kind of theme and idea its good"

**13.** "nevermind, revert it back to before my last prompt i think its better as the birds eye view"

**14.** "right now the grid is only like the square in the middle can we make it pan through the entire computer screen"

**15.** "can you upload this to my github https://github.com/andrewjounkim"

**16.** "can you insert a prompt log of this too"

---

## Key Technical Decisions

- **Restarted from scratch** rather than building on prior version — cleaner architecture
- **Single HTML file** — zero dependencies, no build step, opens directly in browser
- **Top-down bird's-eye view** chosen over isometric after testing both — simpler, more readable
- **All canvas/ctx usage deferred to DOMContentLoaded** — fixed persistent "undefined" crash
- **Dynamic column count** — `HC` recalculated from `window.innerWidth` on resize so lanes fill the full screen
- **Tree collision** uses `Math.round(PL.col)` to avoid float drift from log riding bypassing the block check
- **Web Audio API** for all sound effects — synthesized tones, no audio files needed
- **localStorage** for high score, total coins, and unlocked characters

---

## What the AI Built

| File | Description |
|------|-------------|
| `index.html` | Complete self-contained game (~750 lines) |
| `README.md` | Setup and feature documentation |
| `PROMPTS.md` | This file |
