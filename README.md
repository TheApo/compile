# 🎲 Compile: Main 1 & 2 — Solo AI Edition

> *Boot up. Compile. Overwrite your opponent's reality before they overwrite yours.*

A digital adaptation of the cyberpunk card game [**Compile: Main 1**](https://boardgamegeek.com/boardgame/406652/compile-main-1) (+ **Main 2**, designed by [Michael Yang](https://justgravyllc.com/)) — reimagined as a slick, solo-playable experience you can fire up in your browser. No second player, no setup, no shuffling tiny cards at 2 AM. Just you, a thinking AI, and three protocols to compile.

---

## 🧠 What is Compile?

Two netrunners. Three protocols each. A ruthless race of decoding, overwriting and sabotaging. Play cards face-up to unleash their effects — or face-down for a guaranteed value of 2 and zero tells. Hit **10 in a lane** (and beat your opponent there) and you **compile** that protocol. Compile all three, and you win the simulation.

The twist? Every card has up to **three distinct abilities** (Top / Middle / Bottom), and half the fun is stacking, flipping, shifting and deleting cards in ways the original designers probably didn't fully predict either.

---

## ✨ Features

### 🃏 Complete Card Content
- **Compile: Main 1** — fully implemented (14 protocols × 6 cards = 84 cards)
- **Compile: Main 2** — fully implemented (additional protocols, new mechanics)
- **Two extensions** included — *Aux 1* and *Fan-Content* protocols for extra variety
- **30+ unique protocols** to mix and match in every match

### 🤖 Smart AI Opponents
- **Easy** — friendly, forgiving, great for learning the ropes
- **Normal** — plays the long game, reads the board, punishes greed
- **Hard** — *in development* (because a smart AI that actually thinks ahead takes time to train)

### 🛠️ Custom Protocol Creator (Deck Editor)
Build your own protocols from scratch with a visual effect editor:
- 20+ effect types (flip, delete, shift, draw, discard, reveal, shuffle, swap stacks, copy effect, ...)
- Fully typed parameter editors — pick your triggers, targets, scopes and counts
- Live preview of card text
- Save, edit, export — your protocols become playable cards alongside the officials

### 🎨 Polished Cyberpunk UI
- Every card animated — **15 distinct animation types** (play, flip, shift, delete, draw, discard, compile, swap, reveal, ...)
- Smooth "capture → change → enqueue" animation system that never lies to you
- Hover-preview on every card, ticker marquee on the main menu
- Cyberpunk theme, CSS-variable driven, zero visual clutter

### 📜 In-Game Log That Actually Helps
Most card games hide *why* something happened. This one does the opposite:
```
Player plays Anarchy-0 into Protocol Hate.
  [Middle] Anarchy-0: Player shifts Gravity-6 to Protocol Anarchy.
  [Uncover] Anarchy-1 is uncovered and its effects are re-triggered.
    [Middle] Anarchy-1: Player shifts Anarchy-0 to Protocol Gravity.
      [Uncover] Hate-2 is uncovered and its effects are re-triggered.
        [Middle] Hate-2: Player deletes their highest value uncovered card.
```
Hierarchical indentation, source-tracking (which card fired what), phase-tracking (Start / Middle / End / Uncover). When a chain of reactive effects goes nuclear, you can read it like a stack trace.

### 📚 Built-In References
- **Rules Screen** with card anatomy, phase walkthroughs, keyword glossary
- **Card Library** browsable by category and protocol — full text of every card
- **Statistics** stored locally — win rates, protocol performance, streaks

### ⚙️ Under the Hood
- **100% client-side** — no server, no accounts, no telemetry
- **localStorage** for stats and your custom protocols
- Fully **synchronous game logic** — deterministic and replayable
- Type-safe from top to bottom (TypeScript strict mode)

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (latest LTS recommended)

### Run Locally
```bash
# Clone the repository
git clone <your-repo-url>
cd compile

# Install dependencies
npm install

# Start the development server
npm run dev

# Or build for production
npm run build
```
Then open your browser, pick three protocols, and compile.

### Testing
```bash
npm test             # Vitest unit tests
npm run test:e2e     # Playwright end-to-end tests
npm run check:all    # Validate effects + custom protocols
```

---

## 🧱 Tech Stack
- **React 19** + **Vite 6**
- **TypeScript 5.8** (strict)
- Vanilla CSS with CSS variables (cyberpunk-themed)
- **Vitest** (unit) + **Playwright** (E2E)

---

## 🗂️ Project Shape (brief)
```
compile/
├── components/          UI (Card, Lane, GameBoard, Modals, AnimationOverlay)
├── screens/             MainMenu, GameScreen, CardLibrary, Rules, Statistics,
│                        CustomProtocolCreator (the deck editor)
├── logic/               Game engine — synchronous, testable, no async
│   ├── ai/              Easy / Normal / Hard opponents
│   ├── animation/       Queue + snapshot system (15 animation types)
│   ├── customProtocols/ JSON-driven effect interpreter
│   ├── effects/actions/ Modular executors (flip, delete, draw, shift, ...)
│   └── game/            Phases, resolvers, reactive effects
├── custom_protocols/    All 30+ protocols as JSON definitions
├── data/                Base card data
└── styles/              Cyberpunk CSS
```

---

## 🙌 Credits

- **Original game**: [Compile: Main 1 & 2](https://boardgamegeek.com/boardgame/406652/compile-main-1) by **Michael Yang** / [Just Gravy](https://justgravyllc.com/)
- **Digital adaptation**: [Dirk Aporius](https://apo-games.de/)

This is a fan-made solo implementation built out of love for the original game. Please support the designer — buy the physical game, it's worth it.

---

## 📜 License

Code: Apache-2.0 (see SPDX headers). Original *Compile* card content, names and rules are property of Michael Yang / Just Gravy LLC.

---

> *Ready Player One. Compile when ready.* 🕹️
