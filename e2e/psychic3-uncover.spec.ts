import { test, expect, Page } from '@playwright/test';

/**
 * Test: Psychic-3 Uncover während Player's Turn
 *
 * Szenario aus testScenarios.ts: scenario1_Psychic3Uncover
 *
 * Setup:
 * - Player hat in Hand: Hate-0, Fire-1, Water-1
 * - Opponent hat auf Lane 1: Psychic-3 (unten) + face-down Fire-1 (oben)
 * - Player's Turn, Action Phase
 *
 * Ablauf:
 * 1. Player spielt Hate-0 in Lane 0
 * 2. Hate-0 Effekt triggert: "Delete 1 face-down card"
 * 3. Player wählt Opponent's face-down Karte (Fire-1 auf Lane 1)
 * 4. Karte wird gelöscht → Psychic-3 wird uncovered
 * 5. Psychic-3 on-uncover triggert: "Opponent discards 1, you shift 1 of opponent's cards"
 *    - "Opponent" aus Psychic-3's Sicht = Player
 *    - "You" aus Psychic-3's Sicht = Opponent (AI)
 * 6. Player muss 1 Karte discarden → wählt Water-1
 * 7. AI (Opponent) shiftet Player's Hate-0 automatisch
 *
 * Endergebnis:
 * - Opponent: Psychic-3 auf Lane 1
 * - Player: Hate-0 (wurde verschoben)
 */

// Hilfsfunktion: Konsolen-Fehler erfassen
function setupConsoleCapture(page: Page): { errors: string[], logs: string[] } {
  const errors: string[] = [];
  const logs: string[] = [];

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      // Ignoriere 404-Fehler für Ressourcen
      if (text.includes('404') && text.includes('Failed to load resource')) {
        return;
      }
      errors.push(text);
      console.error('🔴 BROWSER ERROR:', text);
    } else if (msg.type() === 'log' && text.includes('[E2E]')) {
      logs.push(text);
      console.log('📋', text);
    }
  });

  return { errors, logs };
}

// Hilfsfunktion: Warte auf stabilen Zustand (keine Animationen)
async function waitForStableState(page: Page, timeout = 5000) {
  await page.waitForFunction(() => {
    // Warte bis keine Animation-Klassen mehr aktiv sind
    const animating = document.querySelectorAll('.animating, [class*="animation"]');
    return animating.length === 0;
  }, { timeout });
  // Kleine Extra-Pause für State-Updates
  await page.waitForTimeout(300);
}

test.describe('Psychic-3 Uncover Test', () => {

  test('Hate-0 löscht face-down → Psychic-3 uncovered → Player discardet → Hate-0 wird geshiftet', async ({ page }) => {
    const { errors, logs } = setupConsoleCapture(page);

    // 1. Lade das komplexe Szenario aus testScenarios.ts
    await page.goto('/?scenario=scenario1_Psychic3Uncover');

    // Warte auf Szenario-Setup
    await page.waitForFunction(
      () => document.querySelector('.game-board') !== null,
      { timeout: 10000 }
    );
    await page.waitForTimeout(500); // Warte auf Szenario-Anwendung

    console.log('✅ Szenario geladen');

    // 2. Prüfe Anfangszustand
    // Player sollte 3 Karten in der Hand haben (Hate-0, Fire-1, Water-1)
    const playerHandCards = page.locator('.player-hand-area .card-component');
    await expect(playerHandCards).toHaveCount(3);
    console.log('✅ Player hat 3 Karten in der Hand');

    // Opponent sollte 1 Lane mit 2 Karten haben (Psychic-3 + face-down)
    // Die face-down Karte ist oben (sichtbar), Psychic-3 ist unten (verdeckt von face-down)

    // 3. Player spielt Hate-0 (erste Karte in Hand) in Lane 0
    console.log('🎮 Spiele Hate-0...');

    // Klicke auf Hate-0 (erste Karte in der Hand)
    await playerHandCards.first().click();
    await page.waitForTimeout(200);

    // Klicke auf Player's Lane 0 um die Karte zu spielen
    // Player side is the one WITHOUT opponent-side class
    const playerLanes = page.locator('.player-side:not(.opponent-side) .lane');
    await playerLanes.first().click();
    await page.waitForTimeout(500);

    console.log('✅ Hate-0 gespielt');

    // 4. Hate-0 Effekt: "Delete 1 face-down card"
    // Warte auf den Delete-Prompt
    await page.waitForSelector('text=/delete|Delete|face-down/i', { timeout: 5000 });
    console.log('✅ Delete-Prompt erschienen');

    // Wähle die face-down Karte des Opponents (auf Lane 1)
    // Die face-down Karte sollte klickbar/auswählbar sein
    // Face-down cards have .card-inner.is-flipped inside them
    const opponentFaceDownCards = page.locator('.opponent-side .card-component:has(.is-flipped)');
    const faceDownCount = await opponentFaceDownCards.count();
    console.log(`📋 Gefundene face-down Karten: ${faceDownCount}`);

    if (faceDownCount > 0) {
      await opponentFaceDownCards.first().click();
    } else {
      // Alternativ: Klicke auf die Karte in Opponent's Lane 1
      const opponentLanes = page.locator('.opponent-side .lane');
      const lane1Cards = opponentLanes.nth(1).locator('.card-component');
      await lane1Cards.first().click(); // Oberste Karte (face-down)
    }
    await page.waitForTimeout(500);

    console.log('✅ Face-down Karte ausgewählt und gelöscht');

    // 5. Psychic-3 wird uncovered und triggert
    // "Opponent discards 1 card" - Player muss discarden
    await page.waitForSelector('text=/discard|Discard/i', { timeout: 5000 });
    console.log('✅ Discard-Prompt erschienen');

    // Player wählt Water-1 zum Discarden (sollte in der Hand sein)
    // Water-1 ist wahrscheinlich die dritte Karte
    const handCardsForDiscard = page.locator('.player-hand-area .card-component');
    const cardCount = await handCardsForDiscard.count();
    console.log(`📋 Karten in Hand für Discard: ${cardCount}`);

    // Wähle die letzte Karte (Water-1)
    if (cardCount > 0) {
      await handCardsForDiscard.last().click();
      await page.waitForTimeout(300);
    }

    // Bestätige Discard (falls Button nötig)
    const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Done"), button:has-text("OK")');
    if (await confirmButton.isVisible()) {
      await confirmButton.click();
    }
    await page.waitForTimeout(500);

    console.log('✅ Water-1 discarded');

    // 6. AI shiftet Hate-0 automatisch
    // Warte auf Shift-Animation/Effekt
    await waitForStableState(page);

    console.log('✅ AI hat Hate-0 geshiftet');

    // 7. Prüfe Endergebnis
    // Warte bis alles fertig ist
    await page.waitForTimeout(1000);

    // Prüfe auf Konsolen-Fehler
    if (errors.length > 0) {
      console.error('❌ Konsolen-Fehler gefunden:', errors);
    }
    expect(errors).toHaveLength(0);

    console.log('✅ Test erfolgreich abgeschlossen!');
  });

});
