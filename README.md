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
style.css       Shared styles for all four pages.
script.js       Shared interactivity for all four pages.
resume.pdf      My actual resume, linked from the Contact page.
images/         Project photos go here as I send them.
PROMPT_LOG.md   The AI conversation I used to build this (see below).
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
- Built with Claude (Anthropic) as described above.
- No other templates, images, or text were reused from outside sources.

## Running it locally

No build step — just open `index.html` in a browser, or serve the folder:

```
python3 -m http.server
```

then visit `localhost:8000`.
