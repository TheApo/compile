# CSS Refactoring Plan

## Aktuelle Situation

### Dateigrößen (Zeilen)
| Datei | Zeilen | Status |
|-------|--------|--------|
| `index.css` | 3354 | **PROBLEM: Zu groß, enthält alles** |
| `styles/components.css` | 1446 | Wird importiert, aber Duplikate in index.css |
| `styles/custom-protocol-creator.css` | 1466 | Wird NICHT importiert |
| `styles/responsive/tablet.css` | 621 | Wird NICHT importiert |
| `styles/layouts/protocol-selection.css` | 609 | Wird NICHT importiert |
| `styles/layouts/game-screen.css` | 527 | Wird NICHT importiert |
| `styles/layouts/main-menu.css` | 264 | Wird NICHT importiert |
| `styles/StatisticsScreen.css` | 240 | Wird NICHT importiert |
| `styles/base.css` | 139 | Wird NICHT importiert |
| `styles/layouts/card-library.css` | 95 | Wird NICHT importiert |

### Import-Struktur
```
index.css
  └── @import './styles/components.css'
```

**Nur `components.css` wird importiert!** Alle anderen separaten Dateien existieren, werden aber nicht genutzt.

## Probleme

1. **`index.css` ist mit 3354 Zeilen viel zu groß** - schwer zu pflegen
2. **Duplikate**: `components.css` wird importiert, aber dieselben Styles sind AUCH in `index.css`
3. **Ungenutzte Dateien**: 8 CSS-Dateien im `styles/` Ordner werden nicht importiert
4. **Inkonsistenz**: Manche Styles in separaten Dateien, aber `index.css` hat eigene Versionen

## Analyse der Duplikate

### In `index.css` UND `components.css`:
- `.btn`, `.btn:hover`, `.btn:disabled`, `.btn-back`
- `.modal-overlay`, `.modal-content`, `.modal-close-btn`
- `.log-modal-content`, `.log-list`, `.log-entry`
- `.card-component`, `.card-inner`, `.card-face`, `.card-front`, `.card-back`
- Alle Card-Protocol-Styles (`.card-protocol-anarchy`, etc.)

### In `index.css` UND `main-menu.css`:
- `.main-menu`, `.main-menu-layout`, `.main-menu-actions-container`
- `.difficulty-selector`, `.difficulty-options`
- `.control-mechanic-selector`
- `.decorative-card`, `.card-ticker-container`

### In `index.css` UND `game-screen.css`:
- `.game-screen`, `.game-screen-layout`
- `.game-board`, `.lanes`, `.lane`, `.lane-stack`
- `.player-side`, `.opponent-side`
- `.player-hand-area`, `.opponent-hand-area`

## Refactoring-Plan

### Schritt 1: Import-Struktur aufbauen
Ändere `index.css` zu:
```css
@import './styles/base.css';
@import './styles/components.css';
@import './styles/layouts/main-menu.css';
@import './styles/layouts/game-screen.css';
@import './styles/layouts/protocol-selection.css';
@import './styles/layouts/card-library.css';
@import './styles/StatisticsScreen.css';
@import './styles/custom-protocol-creator.css';
@import './styles/responsive/tablet.css';
```

### Schritt 2: Duplikate aus `index.css` entfernen
Nach dem Import-Setup:
1. Entferne alle `.btn`-Styles aus `index.css` (bleiben in `components.css`)
2. Entferne alle `.modal`-Styles aus `index.css`
3. Entferne alle `.card-component`-Styles aus `index.css`
4. Entferne alle `.main-menu`-Styles aus `index.css`
5. Entferne alle `.game-screen`-Styles aus `index.css`
6. Entferne alle `.protocol-selection`-Styles aus `index.css`
7. Entferne alle responsive `@media`-Queries aus `index.css`

### Schritt 3: Fehlende Styles in separate Dateien verschieben
Prüfe was noch in `index.css` übrig ist und verschiebe in passende Dateien:
- Base-Styles (`:root`, `body`, `#root`, `.screen`) → `base.css`
- Card-Protocol-Styles → neues `styles/card-protocols.css`

### Schritt 4: Separate Dateien aktualisieren
Stelle sicher, dass die separaten Dateien die aktuellsten Styles haben:
- `main-menu.css` muss `.btn-wip::after` haben
- `components.css` muss `opacity: 0.7` für `.btn:disabled` haben

### Schritt 5: Aufräumen
1. Lösche leere/ungenutzte Regeln
2. Prüfe auf weitere Duplikate
3. Sortiere Styles logisch

## Erwartetes Ergebnis

| Datei | Vorher | Nachher (geschätzt) |
|-------|--------|---------------------|
| `index.css` | 3354 | ~50 (nur imports + :root) |
| `styles/base.css` | 139 | ~150 |
| `styles/components.css` | 1446 | ~1450 |
| `styles/layouts/main-menu.css` | 264 | ~270 |
| `styles/layouts/game-screen.css` | 527 | ~550 |

## Reihenfolge der Umsetzung

1. **Backup**: `index.css` kopieren
2. **Imports hinzufügen**: Alle @import Statements
3. **Testen**: Prüfen ob alles noch funktioniert
4. **Duplikate entfernen**: Schrittweise aus `index.css`
5. **Nach jedem Schritt testen**
6. **Separate Dateien updaten**: Falls nötig
