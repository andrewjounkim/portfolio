# Andrew Kim — Portfolio

**Live site:** https://andrewjounkim.github.io/portfolio/

A personal portfolio built for a class assignment, themed around materials
science and biomedical engineering (my two majors at CMU). The main idea:
the whole site is framed like a tensile test — you navigate by pulling my
name on the home page, and how far you pull decides where you land.

## How it's structured

Plain HTML/CSS/JS, no framework or build step — four pages sharing one
stylesheet and one script:

```
index.html      Home — just my name. Drag it to navigate.
about.html      Bio, photo, skills, interests.
projects.html   My work, plotted on an interactive chart instead of a list.
contact.html    Email, LinkedIn, resume, and a contact form.
linemoves.html  API project: Line Movement Tracker (see below).
linemoves.js    Its logic: the ESPN API call, the odds math, the interface.
style.css       Shared styles for all pages.
script.js       Shared interactivity for the four main pages.
resume.pdf      My actual resume, linked from the Contact page.
images/         Project photos.
PROMPT_LOG.md   The AI conversation I used to build the site (see below).
API_PROMPT_LOG.md  The AI prompts/decisions behind the API project.
```

## How the navigation works

Home has no visible menu — on purpose, since the assignment wanted the
front page kept minimal. Instead: grab my name and pull it. A stress-strain
graph is revealed beside it with three marked points (About / Projects /
Contact, in that order of pull distance). Cross a point and it lights up;
let go there and it navigates. Every other page just has a small "← Back"
button, since the pull mechanic on Home is the one hub for getting around.

The projects page plots my work on a 2×2 chart (research↔applied,
materials-led↔biology-led) instead of a card grid — click a point to see
that project's details.

## API project: Line Movement Tracker

**Live:** https://andrewjounkim.github.io/portfolio/linemoves.html (linked from the Projects page)

A sportsbook posts an opening line and then moves it as money and news come
in. This page shows which games the betting market changed its mind about,
by reading live odds from ESPN's public scoreboard API and ranking games by
how far the line moved.

**How the API is called.** The page makes one `GET` request per league with
the browser's built-in `fetch()` (plus an `AbortController` for a 15-second
timeout) to
`https://site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard`,
for example `football/nfl`. The only parameter is an optional
`?dates=YYYYMMDD` for a specific day; leaving it off returns the current
slate. The response is JSON with an `events` array, and each event's
`competitions[0].odds[0]` holds DraftKings' `moneyline`, `pointSpread` and
`total`, each with an `open` and a current (`close`) value stored as strings
like `"+130"`, `"-2.5"` or `"o43.5"`. The code turns those strings into
numbers, converts each moneyline to an implied probability, divides out the
sportsbook's margin to get a "fair" win probability, and measures how far it
moved from open to now. Games are ranked by that move, with a diverging bar
per game and an expandable panel showing the underlying numbers.

**API key:** none needed. ESPN's endpoint is keyless, so the page runs
entirely in the browser and there is nothing secret in the repo.

**To run it:** there is nothing to install. Either open the live link above,
or from this folder run `python3 -m http.server` and visit
`localhost:8000/linemoves.html`. Pick a league, choose a day, sort by
moneyline / spread / total move, and click a game to expand it. URLs are
shareable (e.g. `linemoves.html?league=mlb&sort=total`).

**Things worth knowing:**
- This is ESPN's *undocumented* public endpoint (not an official betting-data
  product), so there are no official docs and it could change or start
  blocking browsers. Requests carrying a `HeadlessChrome` User-Agent got a 403
  from ESPN's bot filter during my testing; ordinary browsers did not.
  A proper fix would be a small backend, which the course covers later.
- Only games that haven't started are ranked, since live lines aren't
  comparable. ESPN sends the literal string `"OFF"` for suspended markets, and
  soccer has a third (draw) price; both are handled.
- What I checked: the odds math against hand-computed values, invariants
  (probabilities sum to 1, no NaN) against 56 live games across all seven
  leagues, and failure cases (empty slate, no games on a day, blocked
  request, refused connection, a hung request, garbage URL parameters). Each
  gives a readable message instead of a crash. The hung-request check used a
  stubbed `fetch`, not a real network stall.
- This is for learning how odds work, not betting advice.

## AI usage

I used **Claude** (Anthropic), through Claude Code, as a coding partner for
most of this site — especially the interactive parts I didn't know how to
build myself (the spring-physics bounce, the drag-to-navigate mechanic, the
swipeable photo carousel). I directed what the site should do and look
like, asked Claude to implement or fix specific things, and had it explain
mechanics I didn't understand so I could tune them myself rather than just
accepting the first version.

- **[PROMPT_LOG.md](PROMPT_LOG.md)** — the actual prompts I sent and the
  replies I got, copy-pasted, covering the whole build.
- Inline comments marked `AI usage note` / `AI-suggested` in `script.js` and
  `style.css` point out specifically where and how AI helped, and what I
  changed or tuned myself.

## Credits

- Fonts via Google Fonts: [Fraunces](https://fonts.google.com/specimen/Fraunces) (Underware), [Public Sans](https://fonts.google.com/specimen/Public+Sans) (USWDS), [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) (IBM).
- Built with Claude (Anthropic) as described above; the API project's prompts and decisions are in [API_PROMPT_LOG.md](API_PROMPT_LOG.md).
- Odds data: ESPN's public scoreboard API (DraftKings lines).
- No other templates, images, or text were reused from outside sources.

## Running it locally

No build step — just open `index.html` in a browser, or serve the folder:

```
python3 -m http.server
```

then visit `localhost:8000`.
