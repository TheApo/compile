# CSS Structure Documentation

## Overview

Das CSS für das Compile Game wurde modular aufgeteilt, um bessere Wartbarkeit und Organisation zu ermöglichen. Die Hauptdatei `index.css` importiert alle Module und enthält zusätzlich die **Tablet-Responsive CSS** direkt am Ende.

---

## 📁 File Structure

```
compile/
├── index.css                      # ⭐ HAUPTDATEI - enthält Original-CSS + Tablet-Responsive
├── styles/
│   ├── base.css                   # CSS Variables, Reset, Typography
│   ├── components.css             # Buttons, Modals, Cards, Toaster (groß!)
│   ├── layouts/
│   │   ├── main-menu.css         # Main Menu Layout
│   │   ├── protocol-selection.css # Protocol Selection Layout
│   │   ├── game-screen.css       # Game Screen Layout
│   │   └── card-library.css      # Card Library Layout
│   └── responsive/
│       └── tablet.css             # ⭐ Tablet Media Queries (wird in index.css inkludiert)
```

---

## 📄 File Details

### `index.css` (3175 Zeilen)
**Zweck:** Die Hauptdatei, die im Build verwendet wird.

**Struktur:**
1. **Original Desktop CSS** (Zeile 1-2555): Komplette Desktop-optimierte Styles
2. **Tablet Responsive CSS** (Zeile 2556-3175): Media Queries für Tablets

**Wichtig:**
- Diese Datei wird **automatisch generiert** durch: `cp index.css.backup index.css && cat styles/responsive/tablet.css >> index.css`
- NICHT manuell bearbeiten, sondern die Module bearbeiten!

---

### `styles/base.css` (~150 Zeilen)
**Zweck:** Grundlegende Styles, Variablen, Reset

**Enthält:**
- `:root` CSS Variables (Farben, etc.)
- Reset Styles (`*`, `body`, `#root`)
- Typography (`h1`, `h2`, `p`)
- Screen Base Styles (`.screen`)
- App Header (`.app-header`)

**Wann bearbeiten:**
- Neue CSS-Variablen hinzufügen
- Globale Typografie ändern
- Base-Layout anpassen

---

### `styles/components.css` (~1220 Zeilen)
**Zweck:** Wiederverwendbare Komponenten

**Enthält:**
- **Buttons** (`.btn`, `.btn-back`, `.btn-start`)
- **Modals** (`.modal-overlay`, `.modal-content`, `.log-modal-content`)
- **Cards** (`.card-component`, `.card-front`, `.card-back`)
  - Card Anatomy (Header, Value, Protocol, Body, Rule Boxes)
  - Protocol-spezifische Styles (alle 18 Protokolle: Anarchy, Apathy, Chaos, etc.)
  - Card States (`.is-targetable`, `.is-source-of-effect`, `.selected`)
  - Card Animations (`play-card-player`, `delete-animation`, `draw-card`)
- **Toaster** (`.toaster-container`, `.toaster`)
- **Rearrange Modal** (`.rearrange-modal-content`, `.rearrange-item`)
- **Debug Modal** (`.debug-modal-content`, `.debug-card-grid`)
- **Coin Flip Modal** (`.coin-flip-modal-content`, `.coin-3d`)

**Wann bearbeiten:**
- Neue Karten-Styles hinzufügen
- Button-Styles ändern
- Modal-Verhalten anpassen
- Neues Protokoll hinzufügen → Protokoll-Farben am Ende der Datei

---

### `styles/layouts/main-menu.css` (~230 Zeilen)
**Zweck:** Main Menu spezifische Styles

**Enthält:**
- `.main-menu`, `.main-menu-layout`
- `.main-menu-preview` (dekorative Karten)
- `.difficulty-selector`, `.difficulty-options`
- `.control-mechanic-selector`
- `.card-ticker-container` (animierte Kartenreihe am unteren Rand)
- Decorative Card Animations (`.decorative-card`, `@keyframes float`)

**Wann bearbeiten:**
- Main Menu Layout ändern
- Difficulty Selector anpassen
- Card Ticker Animation modifizieren

---

### `styles/layouts/protocol-selection.css` (~280 Zeilen)
**Zweck:** Protocol Selection Screen

**Enthält:**
- `.protocol-selection-screen`, `.protocol-selection-layout`
- `.protocol-selection-sidebar`
- `.player-protocols-area`, `.opponent-protocols-area`
- `.protocol-preview-area`
- `.protocol-grid`, `.protocol-card`
- `.category-filters`, `.category-filter-item`
- `.selected-protocol-cards-container`
- Animations (`@keyframes reveal`, `@keyframes scan-opponent`)

**Wann bearbeiten:**
- Protocol Selection Grid ändern
- Sidebar-Layout anpassen
- Category Filter Styles

---

### `styles/layouts/game-screen.css` (~500 Zeilen)
**Zweck:** Game Screen - das Herzstück des Spiels

**Enthält:**
- `.game-screen`, `.game-screen-layout`
- `.game-preview-container` (Mainframe Panel links)
- `.game-board`, `.player-side`, `.opponent-side`
- `.lanes`, `.lane`, `.lane-stack`
- `.card-component` in-game States
- `.protocol-bars-container`, `.protocol-display`
- `.control-coin` (Control Mechanic Coin)
- `.player-hand-area`, `.opponent-hand-area`
- `.phase-controller`
- `.btn-play-facedown`

**Wann bearbeiten:**
- Game Board Layout ändern
- Lane-Größen anpassen
- Hand Area modifizieren
- Control Coin Styles

---

### `styles/layouts/card-library.css` (~90 Zeilen)
**Zweck:** Card Library Screen

**Enthält:**
- `.card-library-screen`, `.card-library-layout`
- `.card-list-container`
- `.protocol-group`
- `.protocol-card-grid`
- Scrollbar Styles

**Wann bearbeiten:**
- Card Library Layout ändern
- Protocol Group Styles anpassen

---

### `styles/responsive/tablet.css` (~510 Zeilen) ⭐
**Zweck:** Tablet-Responsive Optimierungen (12-13.3 Zoll iPads)

**Struktur:**

#### 1️⃣ **Landscape Mode** (≥1180px)
```css
@media (min-width: 1180px) { }
```

**Gilt für:**
- iPad Pro 12.9" Landscape (1366 x 1024)
- iPad Pro 11" Landscape (1194 x 834)
- iPad Air 11" Landscape (1180 x 820)

**Anpassungen:**
- Card Ticker: `display: none !important` (Performance!)
- Protocol Selection Grid: `repeat(5, 106px)` (5 Spalten)
- Sidebars: `240px`
- Font-Scaling: `14px` root
- Game Screen: Reduzierte Dimensionen (Lanes, Cards, Hand)

#### 2️⃣ **Portrait Mode** (820px - 1179px)
```css
@media (max-width: 1179px) and (min-width: 820px) { }
```

**Gilt für:**
- iPad Pro Portrait (1024 x 1366)
- iPad Air Portrait (834 x 1180)
- iPad 10.2" Portrait (810 x 1080)

**Anpassungen:**
- Protocol Selection Grid: `repeat(4, 105px)` (4 Spalten!)
- Sidebars: `220px` (schmaler)
- Game Screen: Lanes `130px → 110px`
- Cards: `85x119px → 70x98px`

#### 3️⃣ **Smaller Tablets** (<900px)
```css
@media (max-width: 900px) { }
```

**Gilt für:**
- iPad Mini
- Kleinere Tablets

**Anpassungen:**
- Protocol Grid: `repeat(4, 100px)`
- Noch kleinere Fonts
- Noch kompakteres Layout

#### 4️⃣ **Very Small** (<767px)
```css
@media (max-width: 767px) { }
```

**Fallback für sehr kleine Geräte** (optional, weniger wichtig)

---

## 🔧 Workflow: CSS Änderungen vornehmen

### Desktop CSS ändern
1. **Bearbeite die Original-Datei:** Ändere Zeilen 1-2555 in `index.css` direkt
2. **Oder:** Bearbeite die Module in `styles/` (nicht verwendet aktuell)
3. **Build:** `npm run build`

### Tablet-Responsive ändern
1. **Bearbeite:** `styles/responsive/tablet.css`
2. **Rebuild index.css:**
   ```bash
   # Backup erstellen (optional)
   cp index.css index.css.temp

   # Original wiederherstellen und Tablet CSS anhängen
   head -n 2555 index.css.temp > index.css
   cat styles/responsive/tablet.css >> index.css
   ```
3. **Build:** `npm run build`

---

## 🎯 Wichtige CSS-Klassen nach Screen

### Main Menu
- `.main-menu`, `.main-menu-layout`
- `.difficulty-selector`, `.difficulty-options`
- `.card-ticker-container` ← **Performance-kritisch!**

### Protocol Selection
- `.protocol-selection-layout` ← **3-Spalten Grid (280px | 1fr | 280px)**
- `.protocol-grid` ← **Auto-fill Grid für Protokoll-Karten**
- `.protocol-card` ← **Einzelne Protokoll-Buttons**
- `.protocol-preview-area` ← **Karten-Preview links**

### Game Screen
- `.game-screen-layout` ← **3-Spalten Layout**
- `.game-board` ← **Spielfeld mit Lanes**
- `.lane` ← **Einzelne Lane (160px breit Desktop)**
- `.card-component` ← **Karten im Spiel**
- `.protocol-bars-container` ← **Protokoll-Werte Mitte**
- `.control-coin` ← **Control Mechanic Coin**

### Card Library
- `.card-library-layout` ← **2-Spalten Layout**
- `.protocol-card-grid` ← **Grid für Karten-Anzeige**

---

## 🚨 Wichtige Hinweise

### Performance
- **Card Ticker:** Wird auf Tablets komplett ausgeblendet (`display: none !important`) wegen Animation-Last
- **Animations:** Reduziert auf Tablets (weniger Transitions)

### Responsive Breakpoints
```css
/* Desktop */
@media (min-width: 1401px) { /* Original Desktop CSS */ }

/* Tablet Landscape */
@media (min-width: 1180px) { /* 5 Spalten Protocol Grid */ }

/* Tablet Portrait */
@media (max-width: 1179px) and (min-width: 820px) { /* 4 Spalten */ }

/* Small Tablets */
@media (max-width: 900px) { /* Noch kompakter */ }

/* Very Small */
@media (max-width: 767px) { /* Fallback */ }
```

### Touch vs. Mouse
- **Hover-Effekte:** Funktionieren auf Touch, aber ohne visuelle Feedback
- **Click/Tap:** Alle interaktiven Elemente haben `onClick` UND `onPointerEnter`
- **Preview:** Protocol Selection zeigt Preview bei Click (nicht nur Hover!)

---

## 📚 Farb-Schema (CSS Variables)

```css
:root {
  --background-color: #0A051A;   /* Deep space blue/purple */
  --surface-color: #1A113B;      /* Dark violet surface */
  --surface-hover: #2c1d63;      /* Brighter violet for hover */
  --primary-color: #61EFFF;      /* Bright cyan accent */
  --secondary-color: #8A79E8;    /* Muted lavender */
  --text-color: #F0F0F0;         /* Off-white text */
  --danger-color: #ff5555;       /* Modern red */
  --success-color: var(--primary-color);
  --lane-divider: var(--surface-hover);
}
```

**Protokoll-Farben:** Siehe `components.css` Zeilen ~1460-1774 (18 Protokolle mit je 3 Varianten)

---

## 🔍 Häufige Aufgaben

### Neue Protokoll-Farbe hinzufügen
**Datei:** `styles/components.css` (oder `index.css` Zeile ~1460-1774)

```css
/* Für Karten in-game */
.card-protocol-NEWPROTOCOL .card-front {
    border-color: hsl(XXX, XX%, XX%);
    background-image: radial-gradient(...);
}

/* Für Protocol Selection Grid */
.protocol-card.card-protocol-NEWPROTOCOL {
    border-color: hsl(XXX, XX%, XX%);
    background-image: radial-gradient(...);
}

/* Für Selected Protocols Sidebar */
.protocol-display-card.card-protocol-NEWPROTOCOL {
    border-color: hsl(XXX, XX%, XX%);
    background-image: radial-gradient(...);
}
```

### Lane-Größe ändern
**Datei:** `styles/layouts/game-screen.css` (oder `index.css` Zeile ~878)

```css
.lane {
    width: 160px; /* Ändern nach Bedarf */
}

.lane-stack .card-component {
    width: 100px;  /* Proportional anpassen */
    height: 140px; /* Proportional anpassen */
}
```

**Tablet:** Zusätzlich in `styles/responsive/tablet.css` anpassen!

### Protocol Grid Spaltenanzahl ändern
**Datei:** `styles/responsive/tablet.css`

```css
/* Landscape */
@media (min-width: 1180px) {
  .protocol-grid {
    grid-template-columns: repeat(5, 106px) !important; /* Anzahl & Breite */
    max-width: 600px !important; /* Total Width */
  }
}

/* Portrait */
@media (max-width: 1179px) and (min-width: 820px) {
  .protocol-grid {
    grid-template-columns: repeat(4, 105px) !important;
    max-width: 500px !important;
  }
}
```

---

## 🐛 Troubleshooting

### "CSS Änderungen werden nicht angezeigt"
1. **Hard Refresh:** `Cmd+Shift+R` (Mac) oder `Strg+Shift+F5` (Windows)
2. **DevTools Cache leeren:**
   - F12 → Network Tab → "Disable cache" ankreuzen
   - Rechtsklick auf Reload → "Leeren des Caches und Hard Refresh"
3. **Build neu:** `npm run build`
4. **Dev Server neu starten:** `npm run dev`

### "Tablet Layout ist kaputt"
1. **Prüfe Breakpoint:** Welche Bildschirmbreite? (DevTools → Responsive Mode)
2. **Prüfe Media Query:** Welche Query greift? (DevTools → Elements → Computed)
3. **Prüfe index.css:** Ist `tablet.css` korrekt angehängt? (Zeile 2556+)

### "Protocol Grid zu breit/schmal"
1. **Berechne Total Width:**
   ```
   Sidebar_Left + Gap + Grid_Width + Gap + Sidebar_Right = Total
   240px + 19px + 600px + 19px + 240px = 1118px
   ```
2. **Muss passen in:** iPad Pro Portrait = 1024px ✅
3. **Wenn zu breit:** Reduziere Sidebar oder Grid Width
4. **Wenn zu schmal:** Nutze mehr Platz (max-width erhöhen)

---

## 📦 Build Process

```bash
# Development
npm run dev          # Startet Vite Dev Server (Hot Reload)

# Production Build
npm run build        # Baut in /dist Ordner

# Preview Build
npm run preview      # Preview der Production Build
```

**Build Output:**
- `dist/assets/index-XXXXX.css` (~60 KB, gzipped ~10 KB)
- Enthält komplettes CSS (Desktop + Tablet)

---

## 📝 Version History

- **v0.23** (26.10.2024): Tablet-Responsive Support hinzugefügt
  - Card Ticker auf Tablets ausgeblendet (Performance)
  - Protocol Selection: 5 Spalten Landscape, 4 Spalten Portrait
  - Game Screen: Reduzierte Dimensionen für Tablets
  - Touch-Support: Preview bei Click/Tap

- **v0.22** (24.10.2024): Original Desktop-optimierte Version

---

## 🎨 Design Principles

1. **Desktop First:** Original für Desktop (1920x1080+) optimiert
2. **Tablet Scaling:** Proportionales Scaling für 12-13.3" Tablets
3. **Touch-Friendly:** Alle interaktiven Elemente mindestens 44x44px
4. **Performance:** Animationen reduziert auf Tablets (Card Ticker aus)
5. **Consistency:** Alle Screens folgen gleichem 3-Spalten Pattern
6. **Readability:** Fonts nie kleiner als 13px (root) auf Tablets

---

**Letzte Aktualisierung:** 26. Oktober 2024
**Maintainer:** Dirk Aporius
**Basierend auf:** Compile: Main 1 von Michael Yang
