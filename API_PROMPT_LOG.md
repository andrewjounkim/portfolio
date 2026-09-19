# Prompt Log — API Project (Line Movement Tracker)

**Tool/model:** Claude Sonnet 5 (Anthropic) through Claude Code in VS Code.
This log covers the API assignment only; the log for the portfolio site itself
is [PROMPT_LOG.md](PROMPT_LOG.md). It lists the prompts that shaped the project
and what the AI did with them, not the whole chat.

---

## Prompt 1 — the assignment

**Me:** pasted the full assignment brief (build something around a public API,
README with 3–5 sentences on how the API is called, prompt log, add it to the
portfolio, no keys in the repo, try to break it).

**What Claude did:** Looked at my existing portfolio repo, then, since I hadn't
picked a topic, proposed one that fit my materials/biomedical themes: a
device-failure explorer on the keyless openFDA medical-device API. It made real
requests first and looked at the raw JSON before writing code. Along the way it
found that a `limit=1000` on the date series returns a 403 for anonymous
callers, that `count` requests return every daily bucket, and that a
brand-name `OR` query silently matched about 330,000 unrelated records, so it
did not rely on that query shape. It had started on the page when I redirected.

## Prompt 2 — changing direction

**Me:** "i was thinking about doing a sports betting related project"

**What Claude did:** Stopped the openFDA work and deleted the unfinished page
(nothing had been committed). Because most odds APIs need a key, and the
assignment forbids keys in browser code, it checked for a keyless source and
found ESPN's public scoreboard endpoint, which includes DraftKings moneyline,
spread and total with opening and current values. It surveyed the odd cases
before designing (the string `"OFF"` for suspended markets, soccer's third draw
price, live/finished games carrying odds). It then asked me two questions.

## Prompt 3 — my choices

**Me (answering its questions):** use **ESPN's keyless scoreboard** (over The
Odds API, which needs a key and would have to run in Python), and build a
**line-movement tracker** (over an "odds decoder" that explains a single game).

**What Claude did:** Built `linemoves.html` / `linemoves.js` and the styles,
with the odds math kept as small pure functions (American odds to implied
probability, removing the sportsbook's margin to get "fair" probabilities,
open-to-now movement) separate from the fetching and drawing code.

## Verification and what it caught

I asked for the work to be tested, not just written. Claude ran it in headless
Chrome and reported problems honestly rather than smoothing them over:

- **Odds math:** 35 checks pass, including hand-computed values and invariants
  across 56 live games in all seven leagues.
- **A failure that turned out to be the test, not the app:** every live
  request failed under headless Chrome. It traced this to ESPN's bot filter
  returning 403 to a `HeadlessChrome` User-Agent, confirmed a normal
  User-Agent gets 200, and reworded the on-page error so a blocked request
  isn't described only as "check your internet".
- **A real layout bug:** screenshots showed the fixed back button covering the
  page title. The cause is a CSS specificity clash (`.wrap` overrides the
  section padding). The same bug exists on the existing Projects page, so
  Claude fixed it only for the new page and flagged the rest to me instead of
  changing my other pages unasked.
- **Mobile:** fixed a clipped sort dropdown and a wrapping table column
  after checking a true 390px viewport.

## Understanding the code

The main functions are commented in `linemoves.js` (the file header explains
how the API is called; `impliedProb`, `fairProbs` and `buildGame` explain the
math and the data shape). The key idea I can explain: a price like `-150`
implies a 60% chance, but the two sides' implied probabilities add up to more
than 100%; that excess is the sportsbook's margin. Dividing it out gives a
"fair" probability, and changes in *that* number show the market really
changing its mind rather than just the sportsbook adjusting its cut.
