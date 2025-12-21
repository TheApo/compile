import { test, expect, Page } from '@playwright/test';

// =============================================================================
// HILFSFUNKTIONEN - Diese helfen dir Aktionen auszuführen
// =============================================================================

/**
 * Startet ein neues Spiel mit bestimmten Einstellungen
 */
async function startGame(page: Page, options: {
  difficulty: 'easy' | 'normal' | 'hard';
  useControlMechanic: boolean;
  playerProtocols: string[];
  opponentProtocols: string[];
}) {
  await page.goto('/');

  // Warte auf MainMenu
  await page.waitForSelector('text=Start Game');

  // Difficulty wählen
  await page.click(`button:has-text("${options.difficulty}")`);

  // Control Mechanic Toggle (wenn gewünscht)
  if (options.useControlMechanic) {
    await page.click('text=Control Mechanic');
  }

  // Start Game klicken
  await page.click('button:has-text("Start Game")');

  // Protokoll-Auswahl
  // Player wählt 2 Protokolle, dann Opponent 2, dann Player 1, dann Opponent 1
  for (const protocol of options.playerProtocols.slice(0, 2)) {
    await page.click(`text=${protocol}`);
  }
  // Hier würde normalerweise AI wählen...
  // Für Tests können wir das überspringen wenn wir URL-Parameter nutzen
}

/**
 * Warte bis ein bestimmter Spieler am Zug ist
 */
async function waitForTurn(page: Page, turn: 'player' | 'opponent') {
  await page.waitForFunction(
    (t) => {
      const turnIndicator = document.querySelector('.turn-indicator, [class*="turn"]');
      return turnIndicator?.textContent?.toLowerCase().includes(t);
    },
    turn,
    { timeout: 30000 }
  );
}

/**
 * Warte auf eine bestimmte Phase
 */
async function waitForPhase(page: Page, phase: string) {
  await page.waitForFunction(
    (p) => {
      const phaseIndicator = document.querySelector('.phase-indicator, [class*="phase"]');
      return phaseIndicator?.textContent?.toLowerCase().includes(p.toLowerCase());
    },
    phase,
    { timeout: 10000 }
  );
}

/**
 * Spiele eine Karte aus der Hand in eine Lane
 * @param cardIndex - 0-basierter Index der Karte in der Hand
 * @param laneIndex - 0-basierter Lane-Index (0, 1, oder 2)
 * @param faceUp - true für face-up, false für face-down
 */
async function playCard(page: Page, cardIndex: number, laneIndex: number, faceUp: boolean = true) {
  // Klicke auf Karte in Hand
  const handCards = page.locator('.player-hand .card, [class*="hand"] [class*="card"]');
  await handCards.nth(cardIndex).click();

  // Wenn face-down, klicke nochmal zum Umdrehen
  if (!faceUp) {
    await handCards.nth(cardIndex).click();
  }

  // Klicke auf Lane
  const lanes = page.locator('.player-lane, [class*="lane"]');
  await lanes.nth(laneIndex).click();

  // Warte auf Animation
  await page.waitForTimeout(600);
}

/**
 * Klicke auf "End Turn" / "Confirm" Button
 */
async function endTurn(page: Page) {
  await page.click('button:has-text("End Turn"), button:has-text("Confirm"), button:has-text("Done")');
}

/**
 * Warte bis AI fertig ist (Opponent Turn vorbei)
 */
async function waitForAIComplete(page: Page) {
  // Warte bis Player wieder am Zug ist
  await waitForTurn(page, 'player');
}

/**
 * Prüfe ob Konsolen-Fehler vorhanden sind
 * Ignoriert 404-Fehler für Ressourcen (Bilder, Fonts)
 */
function setupConsoleErrorCapture(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignoriere 404-Fehler für Ressourcen
      if (text.includes('404') && text.includes('Failed to load resource')) {
        console.log('⚠️ Resource 404 (ignored):', text);
        return;
      }
      errors.push(text);
      console.error('🔴 BROWSER ERROR:', text);
    }
  });
  return errors;
}

// =============================================================================
// BEISPIEL TESTS - So schreibst du konkrete Tests
// =============================================================================

test.describe('Basic Game Flow', () => {

  test('Spiel kann gestartet werden', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);

    await page.goto('/');

    // Prüfe dass MainMenu sichtbar ist
    await expect(page.locator('text=Start Game')).toBeVisible();

    // Prüfe keine Konsolen-Fehler
    expect(errors).toHaveLength(0);
  });

});

test.describe('AI Turn Verhalten', () => {

  test('AI spielt nicht doppelt', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);

    // Gehe direkt zum Spiel (wenn URL-Parameter implementiert)
    // await page.goto('/?testScenario=basic-game');

    // Für jetzt: Manuell durch Menü navigieren
    await page.goto('/');

    // TODO: Hier würde der Test weitergehen...
    // Das zeigt nur die Struktur
  });

});

// =============================================================================
// BEISPIEL: So testest du einen spezifischen Effekt
// =============================================================================

test.describe('Death-1 Effekt', () => {

  test.skip('Draw -> If you do -> Delete funktioniert', async ({ page }) => {
    // DIESEN TEST ÜBERSPRINGEN BIS URL-PARAMETER FUNKTIONIEREN

    const errors = setupConsoleErrorCapture(page);

    // 1. Lade Szenario mit Death-1 bereits auf dem Board
    await page.goto('/?testScenario=death1-test');

    // 2. Warte auf Spielstart
    await page.waitForSelector('.game-board');

    // 3. Warte auf Start-Phase (Death-1 triggert hier)
    await waitForPhase(page, 'start');

    // 4. Draw sollte passieren (Karte wird gezogen)
    // Zähle Handkarten vorher/nachher
    const handBefore = await page.locator('.player-hand .card').count();
    await page.waitForTimeout(1000);
    const handAfter = await page.locator('.player-hand .card').count();
    expect(handAfter).toBe(handBefore + 1);

    // 5. "If you do" - Delete Prompt sollte erscheinen
    await expect(page.locator('text=delete')).toBeVisible();

    // 6. Wähle eine Karte zum Löschen
    await page.locator('.player-hand .card').first().click();

    // 7. Bestätige
    await page.click('button:has-text("Confirm")');

    // 8. Prüfe keine Fehler
    expect(errors).toHaveLength(0);
  });

});

// =============================================================================
// TEMPLATE FÜR DEINE EIGENEN TESTS
// =============================================================================

/*
test.describe('DEIN PROTOKOLL Effekte', () => {

  test('EFFEKT NAME funktioniert', async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);

    // 1. Setup - Gehe zum Spiel
    await page.goto('/?testScenario=DEIN-SZENARIO');
    await page.waitForSelector('.game-board');

    // 2. Aktionen ausführen
    // - Warte auf Phase: await waitForPhase(page, 'action');
    // - Spiele Karte: await playCard(page, 0, 1, true);
    // - Beende Zug: await endTurn(page);
    // - Warte auf AI: await waitForAIComplete(page);

    // 3. Klicke auf spezifische Elemente
    // - Button: await page.click('button:has-text("Accept")');
    // - Karte: await page.locator('.card').first().click();
    // - Lane: await page.locator('.lane').nth(1).click();

    // 4. Prüfe Ergebnisse
    // - Text sichtbar: await expect(page.locator('text=You win')).toBeVisible();
    // - Element count: expect(await page.locator('.card').count()).toBe(5);
    // - Keine Fehler: expect(errors).toHaveLength(0);
  });

});
*/
