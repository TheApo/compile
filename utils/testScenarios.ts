/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, LogEntry } from "../types";
import { v4 as uuidv4 } from 'uuid';
import { recalculateAllLaneValues } from '../logic/game/stateManager';
import { getAllCustomProtocolCards } from '../logic/customProtocols/cardFactory';

/**
 * Test Scenarios for validating actor/owner fixes
 */

export type TestScenario = {
    name: string;
    description: string;
    setup: (state: GameState) => GameState;
};

// Helper: Create a PlayedCard with full data from cards database
function createCard(protocol: string, value: number, isFaceUp: boolean = true): PlayedCard {
    // Find the card in the custom protocols (all protocols are now custom)
    const allCards = getAllCustomProtocolCards();
    const cardData = allCards.find(c => c.protocol === protocol && c.value === value);

    if (!cardData) {
        console.warn(`Card not found: ${protocol}-${value}`);
        return {
            id: uuidv4(),
            protocol,
            value,
            top: '',
            middle: '',
            bottom: '',
            keywords: {},
            isFaceUp,
            isRevealed: false,
            category: 'Main',
        };
    }

    return {
        id: uuidv4(),
        protocol: cardData.protocol,
        value: cardData.value,
        top: cardData.top,
        middle: cardData.middle,
        bottom: cardData.bottom,
        keywords: cardData.keywords,
        isFaceUp,
        isRevealed: false,
        category: (cardData as any).category || 'Main',
        // Copy customEffects for custom protocol cards
        ...(cardData as any).customEffects && { customEffects: (cardData as any).customEffects }
    };
}

// Helper: Place card on board
function placeCard(state: GameState, owner: Player, laneIndex: number, card: PlayedCard): GameState {
    const newState = { ...state };
    const ownerState = { ...newState[owner] };
    const lanes = [...ownerState.lanes];
    lanes[laneIndex] = [...lanes[laneIndex], card];
    ownerState.lanes = lanes;
    newState[owner] = ownerState;
    return newState;
}

// Helper: Build deck from protocols, excluding cards already in use
function buildDeckFromProtocols(protocols: string[], usedCards: PlayedCard[]): PlayedCard[] {
    const deck: PlayedCard[] = [];

    // Get all available cards (all protocols are now custom)
    const allCards = getAllCustomProtocolCards();

    // For each protocol, add only cards that actually exist in that protocol
    for (const protocol of protocols) {
        const protocolCards = allCards.filter(c => c.protocol === protocol);

        for (const cardData of protocolCards) {
            // Check if this card is already used (on board or in hand)
            const isUsed = usedCards.some(c => c.protocol === cardData.protocol && c.value === cardData.value);
            if (!isUsed) {
                deck.push(createCard(cardData.protocol, cardData.value, true));
            }
        }
    }

    return deck;
}

// Helper: Initialize common scenario setup
function initScenarioBase(state: GameState, playerProtocols: string[], opponentProtocols: string[], turn: Player, phase: GameState['phase']): GameState {
    // Use proper immutable updates
    const newState: GameState = {
        ...state,
        player: {
            ...state.player,
            protocols: playerProtocols,
            lanes: [[], [], []],
            hand: [],
        },
        opponent: {
            ...state.opponent,
            protocols: opponentProtocols,
            lanes: [[], [], []],
            hand: [],
        },
        turn,
        phase,
        actionRequired: null,
        queuedActions: [],
        _interruptedTurn: undefined,
        _interruptedPhase: undefined,
        processedStartEffectIds: [],
        processedEndEffectIds: [],
        processedUncoverEventIds: [],
    };

    return newState;
}

// Helper: Finalize scenario setup - build decks, reset discard, uncompile protocols, reset log
function finalizeScenario(state: GameState): GameState {
    // Build decks from protocols, excluding cards already in use
    const playerUsedCards = [
        ...state.player.hand,
        ...state.player.lanes.flat()
    ];
    const opponentUsedCards = [
        ...state.opponent.hand,
        ...state.opponent.lanes.flat()
    ];

    const playerDeck = buildDeckFromProtocols(state.player.protocols, playerUsedCards);
    const opponentDeck = buildDeckFromProtocols(state.opponent.protocols, opponentUsedCards);

    // ALWAYS reset log and initialize with protocols and starting player
    const startingPlayer = state.turn === 'player' ? 'Player' : 'Opponent';
    const newLog = [
        { player: 'player' as Player, message: `Player protocols: ${state.player.protocols.join(', ')}` },
        { player: 'opponent' as Player, message: `Opponent protocols: ${state.opponent.protocols.join(', ')}` },
        { player: state.turn, message: `${startingPlayer} goes first.` },
        { player: 'player' as Player, message: '---' },
        // CRITICAL: Add a 5th entry to prevent useGameState's coin-flip hook from overriding the turn
        // The hook only triggers if log.length <= 4
        { player: state.turn, message: `[Test Scenario] Phase: ${state.phase}` }
    ];

    // Return new state with all updates
    return {
        ...state,
        player: {
            ...state.player,
            deck: playerDeck,
            discard: [],
            compiled: [false, false, false]
        },
        opponent: {
            ...state.opponent,
            deck: opponentDeck,
            discard: [],
            compiled: [false, false, false]
        },
        log: newLog
    };
}

/**
 * Szenario 1: Psychic-3 Uncover während Opponent's Turn
 *
 * Setup:
 * - Player's Hate-0 (face-up) auf Lane 0
 * - Opponent's Psychic-3 (face-up) auf Lane 1, darunter ein face-down card
 *
 * Test: Player löscht die face-down card → Psychic-3 wird uncovered
 * Erwartet: Player discardet, Opponent shiftet Player's card
 */
export const scenario1_Psychic3Uncover: TestScenario = {
    name: "Psychic-3 Uncover während Opponent's Turn",
    description: "Player löscht Opponent's face-down card → Psychic-3 uncovered → Player discardet, Opponent shiftet",
    setup: (state: GameState) => {
        // Initialize base scenario
        let newState = initScenarioBase(
            state,
            ['Hate', 'Fire', 'Water'],
            ['Psychic', 'Death', 'Spirit'],
            'player',
            'action'
        );

        // Player bekommt Hate-0 in Hand + ein paar Karten zum Discarden
        newState.player.hand = [
            createCard('Hate', 0, true),
            createCard('Fire', 1, true),
            createCard('Water', 1, true),
        ];

        // Opponent: Face-down card auf Lane 1, Psychic-3 DARAUF (oben drauf)
        // Wichtig: UNTEN zuerst platzieren, dann OBEN (push = ans Ende)
        newState = placeCard(newState, 'opponent', 1, createCard('Psychic', 3, true)); // UNTEN
        newState = placeCard(newState, 'opponent', 1, createCard('Fire', 1, false)); // OBEN (darauf)

        // Recalculate lane values
        newState = recalculateAllLaneValues(newState);

        return finalizeScenario(newState);
    }
};

/**
 * Szenario 2: Psychic-4 End Effect mit Uncover-Interrupt
 *
 * Setup:
 * - Opponent's Psychic-4 auf Lane 0
 * - Player's Fire-4 auf Lane 1 (unten), Fire-2 darauf (oben)
 * - Opponent's Turn, End Phase
 *
 * Test: Psychic-4 triggert → Opponent returnt Fire-2 (oben) → Fire-4 uncovered (Player muss 2 discarden)
 * Erwartet: Fire-4 Interrupt läuft (Player discardet 2), dann Psychic-4 flippt sich (aus Queue)
 */
export const scenario2_Psychic4EndEffect: TestScenario = {
    name: "Psychic-4 End Effect mit Uncover-Interrupt",
    description: "Psychic-4 returnt Fire-2 → Fire-4 uncovered → Interrupt → Psychic-4 flip aus Queue",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Fire', 'Water', 'Spirit'],
            ['Psychic', 'Death', 'Metal'],
            'opponent',
            'end'
        );

        // Opponent: Psychic-4 auf Lane 0
        newState = placeCard(newState, 'opponent', 0, createCard('Psychic', 4, true));

        // Player: Fire-4 auf Lane 1 (unten), Fire-2 darauf (oben)
        newState = placeCard(newState, 'player', 1, createCard('Fire', 4, true));
        newState = placeCard(newState, 'player', 1, createCard('Fire', 2, true));

        // Opponent gibt genug Cards zum Discarden
        newState.opponent.hand = [
            createCard('Water', 1),
            createCard('Water', 2),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 3: Spirit-3 Draw während End Phase
 *
 * Setup:
 * - Player's Spirit-3 auf Lane 0
 * - Player's Turn, End Phase wird triggern
 * - Deck hat genug Karten
 *
 * Test: End Phase → Spirit-3 triggert draw → Spirit-3 shift-prompt in Queue
 * Erwartet: Player kann lanes klicken, End Phase endet nicht vorzeitig
 */
export const scenario3_Spirit3EndPhase: TestScenario = {
    name: "Spirit-3 Draw während End Phase",
    description: "Spirit-3 draw in End Phase → Shift-prompt in Queue → Player kann lanes klicken",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Spirit', 'Fire', 'Water'],
            ['Death', 'Metal', 'Psychic'],
            'player',
            'action'
        );

        // Player: Spirit-3 auf Lane 0
        newState = placeCard(newState, 'player', 0, createCard('Spirit', 3, true));

        // Deck mit genug Karten (using actual Card objects from database)
        const allCards = getAllCustomProtocolCards();
        const fireCard = allCards.find(c => c.protocol === 'Fire' && c.value === 1);
        const waterCard = allCards.find(c => c.protocol === 'Water' && c.value === 1);
        const spiritCard = allCards.find(c => c.protocol === 'Spirit' && c.value === 1);
        newState.player.deck = [
            fireCard!,
            waterCard!,
            spiritCard!,
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 4: Plague-2 Actor Propagation
 *
 * Setup:
 * - Player's Plague-2 in Hand
 * - Beide Spieler haben genug Karten zum Discarden
 *
 * Test: Player spielt Plague-2 → discardet 2 → Opponent discardet 3
 * Erwartet: Korrekte Actor-Namen, richtige Reihenfolge
 */
export const scenario4_Plague2Actor: TestScenario = {
    name: "Plague-2 Actor Propagation",
    description: "Player spielt Plague-2 → Player discardet → Opponent discardet (actor korrekt)",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Plague', 'Death', 'Hate'],
            ['Fire', 'Water', 'Spirit'],
            'player',
            'action'
        );

        // Player: Plague-2 in Hand + Karten zum Discarden
        newState.player.hand = [
            createCard('Plague', 2, true),
            createCard('Fire', 1),
            createCard('Water', 1),
            createCard('Spirit', 1),
        ];

        // Opponent: Genug Karten zum Discarden
        newState.opponent.hand = [
            createCard('Fire', 2),
            createCard('Water', 2),
            createCard('Spirit', 2),
            createCard('Death', 2),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 5: Darkness-1 Flip + Shift mit Interrupt
 *
 * Setup:
 * - Player's Darkness-1 in Hand
 * - Opponent's Fire-0 (face-down) auf Lane 0
 *
 * Test: Player spielt Darkness-1 → flippt Fire-0 → Fire-0 delete-interrupt → shift-prompt
 * Erwartet: Fire-0 deleted, Player shiftet (nicht Opponent)
 */
export const scenario5_Darkness1Interrupt: TestScenario = {
    name: "Darkness-1 Flip + Shift mit Interrupt",
    description: "Darkness-1 flippt Fire-0 → Delete-Interrupt → Player shiftet",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Darkness', 'Fire', 'Water'],
            ['Spirit', 'Death', 'Metal'],
            'player',
            'action'
        );

        // Player: Darkness-1 in Hand
        newState.player.hand = [createCard('Darkness', 1, true)];

        // Opponent: Fire-0 (face-down) auf Lane 0
        newState = placeCard(newState, 'opponent', 0, createCard('Fire', 0, false));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 8: Plague-4 Owner vs Turn Check
 *
 * Setup:
 * - Opponent's Plague-4 auf Lane 0
 * - Player's face-down card auf Lane 1
 * - Opponent's Turn, End Phase
 *
 * Test: Plague-4 triggert → Player deleted face-down → Opponent (owner) wird für flip gefragt
 * Erwartet: Opponent (card owner) wird für flip gefragt, nicht turn player
 */
export const scenario8_Plague4Owner: TestScenario = {
    name: "Plague-4 Owner vs Turn Check",
    description: "Plague-4 End → Player deletet → Opponent (owner) wird für flip gefragt",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Fire', 'Water', 'Spirit'],
            ['Plague', 'Death', 'Metal'],
            'opponent',
            'end'
        );

        // Opponent: Plague-4 auf Lane 0
        newState = placeCard(newState, 'opponent', 0, createCard('Plague', 4, true));

        // Player: Face-down card auf Lane 1
        newState = placeCard(newState, 'player', 1, createCard('Water', 2, false));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 8: Plague-4 Owner vs Turn Check
 *
 * Setup:
 * - Opponent's Plague-4 auf Lane 0
 * - Player's face-down card auf Lane 1
 * - Opponent's Turn, End Phase
 *
 * Test: Plague-4 triggert → Player deleted face-down → Opponent (owner) wird für flip gefragt
 * Erwartet: Opponent (card owner) wird für flip gefragt, nicht turn player
 */
export const scenario9_Water: TestScenario = {
    name: "Water Owner vs Turn Check",
    description: "Plague-4 End → Player deletet → Opponent (owner) wird für flip gefragt",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Fire', 'Water', 'Spirit'],
            ['Plague', 'Death', 'Metal'],
            'player',
            'action'
        );

        // Opponent: Plague-4 auf Lane 0
        newState = placeCard(newState, 'opponent', 0, createCard('Plague', 4, true));

        // Player: Face-down card auf Lane 1
        newState = placeCard(newState, 'player', 2, createCard('Water', 4, false));
		
		// Player: Plague-2 in Hand + Karten zum Discarden
        newState.player.hand = [
            createCard('Water', 0, true),
            createCard('Fire', 1),
            createCard('Water', 1),
            createCard('Spirit', 1),
        ];

        // Opponent: Genug Karten zum Discarden
        newState.opponent.hand = [
            createCard('Fire', 2),
            createCard('Water', 2),
            createCard('Spirit', 2),
            createCard('Death', 2),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 10: Hate-1 Multi-Delete mit Uncover-Interrupt
 *
 * Setup:
 * - Player's Hate-1 in Hand + 4 andere Karten zum Discarden
 * - Opponent's Plague-5 (unten) + Plague-0 (oben, uncovered) auf Lane 0
 * - Opponent hat 5 Karten in Hand zum Discarden
 *
 * Test: Player spielt Hate-1 → discardet 3 → löscht Plague-0 → Plague-5 uncovered (Opponent discard Interrupt) → Player soll 2. Delete machen
 * Erwartet: Nach Plague-5 Interrupt bleibt Player dran für den 2. Delete (nicht Opponent's Zug)
 */
export const scenario10_Hate1Interrupt: TestScenario = {
    name: "Hate-1 Multi-Delete mit Uncover-Interrupt",
    description: "Hate-1 löscht Plague-0 → Plague-5 uncovered → Interrupt → Player macht 2. Delete",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Fire', 'Hate', 'Water'],
            ['Plague', 'Death', 'Metal'],
            'player',
            'action'
        );

        // Player: Hate-1 in Hand + 4 Karten zum Discarden
        newState.player.hand = [
            createCard('Hate', 1, true),
            createCard('Psychic', 2, true),
            createCard('Psychic', 4, true),
            createCard('Hate', 4, true),
            createCard('Water', 1, true),
        ];

        // Opponent: Plague-5 (unten) + Plague-0 (oben, uncovered) auf Lane 0
        newState = placeCard(newState, 'opponent', 0, createCard('Plague', 2, true)); // UNTEN
        newState = placeCard(newState, 'opponent', 0, createCard('Plague', 0, true)); // OBEN (uncovered)

        // Opponent: 5 Karten in Hand zum Discarden
        newState.opponent.hand = [
            createCard('Fire', 2, true),
            createCard('Water', 2, true),
            createCard('Spirit', 2, true),
            createCard('Death', 2, true),
            createCard('Metal', 2, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 11: Darkness-1 Flip Hate-0 → Multi-Effect Chain
 *
 * Setup:
 * - Player's Darkness-1 in Hand
 * - Opponent's Hate-0 (face-down) auf Lane 0
 * - Opponent's Hate-3 (face-up) auf Lane 1
 * - Opponent's Fire-1 (face-down) auf Lane 2 (für Hate-0 Delete-Target - NICHT Player's Darkness-1!)
 * - Player's Turn, Action Phase
 *
 * Test: Player spielt Darkness-1 → flippt Hate-0 face-up → Hate-0 delete interrupt → Hate-3 draw interrupt → Player shiftet Hate-0
 * Erwartet:
 *   1. Player spielt Darkness-1 in Lane 0 (face-up)
 *   2. Player wählt Hate-0 zum Flippen
 *   3. Hate-0 wird face-up → Triggert On-Play-Effekt (Delete 1 face-down card)
 *   4. AI löscht Opponent's Fire-1 (face-down) - NICHT Darkness-1!
 *   5. Hate-3 triggert: Draw 1 card (wegen delete)
 *   6. Player bekommt Shift-Prompt für Hate-0 (aus Queue, weil Darkness-1 noch existiert!)
 *
 * Bug (VORHER): Shift-Prompt wurde durch Hate-0 Interrupt überschrieben → ging verloren
 * Fix (NACHHER): Shift-Prompt wird in Queue geschoben WENN beide Karten (Darkness-1 + Hate-0) noch existieren
 */
export const scenario11_Darkness1HateChain: TestScenario = {
    name: "Darkness-1 → Hate-0 Flip → Multi-Effect Chain",
    description: "🆕 Darkness-1 flippt Hate-0 → Delete-Interrupt → Draw-Interrupt → Shift aus Queue",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Darkness', 'Fire', 'Water'],
            ['Hate', 'Death', 'Metal'],
            'player',
            'action'
        );

        // Player: Darkness-1 in Hand
        newState.player.hand = [createCard('Darkness', 1, true)];

        // Opponent: Hate-0 (face-down) auf Lane 0
        newState = placeCard(newState, 'opponent', 0, createCard('Hate', 0, false));

        // Opponent: Hate-3 (face-up) auf Lane 1 (für Draw-Trigger)
        newState = placeCard(newState, 'opponent', 1, createCard('Hate', 3, true));

        // Opponent: Fire-1 (face-down) auf Lane 2 (für Hate-0 Delete-Target)
        // CRITICAL: Dies ist eine OPPONENT-Karte, damit Hate-0 sie löschen kann ohne Darkness-1 zu löschen!
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 1, false));

        // Player: Weitere Karte auf Lane 1 (damit Shift sinnvoll ist)
        newState = placeCard(newState, 'player', 1, createCard('Water', 2, true));

        // Opponent: Genug Karten in Hand (für Hate-3 Draw)
        newState.opponent.hand = [
            createCard('Death', 2),
            createCard('Metal', 3),
        ];

        // Opponent deck with cards for Hate-3 draw
        const allCardsForDeck = getAllCustomProtocolCards();
        const deathCard = allCardsForDeck.find(c => c.protocol === 'Death' && c.value === 1);
        newState.opponent.deck = [deathCard!];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 12: Water-4 Return → Turn End Bug-Test
 *
 * Setup:
 * - Opponent's Water-4 in Hand
 * - Opponent's Life-4 (face-up) auf Lane 0
 * - Opponent's Turn, Action Phase
 *
 * Test: Opponent spielt Water-4 → returnt Life-4 → Turn sollte enden (Player's Turn)
 * Erwartet:
 *   1. Opponent spielt Water-4
 *   2. Opponent wählt Life-4 zum Returnen
 *   3. Life-4 geht auf Hand zurück
 *   4. Turn endet → Player ist dran!
 *   5. state.turn === 'player'
 *
 * Bug (VORHER): requiresTurnEnd = false → Opponent blieb am Zug und konnte nochmal spielen!
 * Fix (NACHHER): requiresTurnEnd = !newState.actionRequired → Turn endet wie bei allen anderen On-Play-Effekten
 */
export const scenario12_Water4TurnEnd: TestScenario = {
    name: "Water-4 Return → Turn End",
    description: "🆕 Water-4 returnt Karte → Turn endet (Bug-Fix: Opponent spielt nicht zweimal)",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Hate', 'Spirit', 'Light'],
            ['Fire', 'Water', 'Death'],
            'opponent',
            'action'
        );

        // Opponent: Water-4 in Hand
        newState.opponent.hand = [createCard('Water', 4, true)];

        // Opponent: Life-4 (face-up) auf Lane 0 (wird returned)
        newState = placeCard(newState, 'opponent', 0, createCard('Life', 4, true));
		newState = placeCard(newState, 'opponent', 2, createCard('Death', 4, false));

		newState = placeCard(newState, 'player', 1, createCard('Spirit', 1, true));
		newState = placeCard(newState, 'player', 2, createCard('Light', 5, false));

        // Player: Ein paar Karten in Hand (damit klar ist dass Player dran ist danach)
        newState.player.hand = [
            createCard('Fire', 1),
            createCard('Spirit', 2),
            createCard('Hate', 4),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 13: Psychic-3 Discard + Shift Test
 *
 * Setup:
 * - Opponent's Psychic-3 in Hand
 * - Player hat 3 Karten auf Hand (zum Discarden)
 * - Player hat je 1 Karte auf jeder Lane (zum Shiften)
 * - Opponent's Turn, Action Phase
 *
 * Test: Opponent spielt Psychic-3 → Player discardet 1 Karte → AI shiftet Player's Karte
 * Erwartet:
 *   1. Opponent spielt Psychic-3
 *   2. Player muss 1 Karte discarden
 *   3. AI wählt eine von Player's Karten zum Shiften
 *   4. Karte wird geshiftet
 *   5. KEIN "AI has no logic for mandatory action" Fehler!
 *
 * Bug (VORHER): shiftCard fehlte in handleRequiredAction → AI konnte nicht shiften
 * Fix (NACHHER): shiftCard zu handleRequiredAction hinzugefügt
 */
export const scenario13_Psychic3ShiftTest: TestScenario = {
    name: "Psychic-3 Discard + Shift",
    description: "🆕 Psychic-3 On-Play → Player discardet → AI shiftet (Bug-Fix: AI kann shiften)",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Fire', 'Water', 'Spirit'],
            ['Psychic', 'Death', 'Metal'],
            'opponent',
            'action'
        );

        // Opponent: Psychic-3 in Hand
        newState.opponent.hand = [createCard('Psychic', 3, true)];

        // Player: 3 Karten auf Hand (zum Discarden)
        newState.player.hand = [
            createCard('Fire', 1),
            createCard('Water', 2),
            createCard('Spirit', 1),
        ];

        // Player: Je 1 Karte auf jeder Lane (zum Shiften)
        newState = placeCard(newState, 'player', 0, createCard('Fire', 2, true));
        newState = placeCard(newState, 'player', 1, createCard('Water', 3, true));
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 4, true));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 14: Death-1 Delete → Speed-3 Uncover Bug-Test
 *
 * Setup:
 * - Opponent's Death-1 (face-up) auf Lane 0
 * - Player's Speed-3 (face-up, covered - unten) + Light-0 (face-up, uncovered - oben) auf Lane 0
 * - Opponent's Turn, Start Phase
 *
 * Test: Death-1 triggert → AI löscht Light-0 → Speed-3 uncovered → Player sollte Shift-Prompt bekommen
 * Erwartet:
 *   - Speed-3 wird uncovered (Log: "Speed-3 is uncovered and its effects are re-triggered")
 *   - Player bekomme Action: "Select one of your cards to shift"
 *   - KEIN Softlock!
 *
 * Bug (VORHER): actionRequired wurde nach uncover auf null gesetzt → Shift-Prompt verloren
 * Fix (NACHHER): actionRequired wird geprüft und NICHT gelöscht wenn uncover sie gesetzt hat
 */
export const scenario14_Death1UncoverTest: TestScenario = {
    name: "Death-1 Delete → Speed-3 Uncover",
    description: "🆕 Death-1 löscht Light-0 → Speed-3 uncovered → Player shiftet (Bug-Fix Test)",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Speed', 'Light', 'Water'],
            ['Death', 'Fire', 'Metal'],
            'opponent',
            'start'
        );

        // Player: Speed-3 (unten, covered) + Light-0 (oben, uncovered) auf Lane 0
        newState = placeCard(newState, 'player', 0, createCard('Speed', 3, true)); // UNTEN (covered)
        newState = placeCard(newState, 'player', 0, createCard('Light', 0, true)); // OBEN (uncovered - wird gelöscht)

        // CRITICAL: Speed-3 needs "other cards" to shift! Add a card in another lane
        newState = placeCard(newState, 'player', 1, createCard('Water', 1, true)); // Another card for Speed-3 to shift

        // Opponent: Death-1 (face-up) auf Lane 0
        newState = placeCard(newState, 'opponent', 0, createCard('Death', 1, true));

        // Empty hands (will be drawn by Death-1 effect)
        newState.player.hand = [];
        newState.opponent.hand = [];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 15: Gravity-2 Flip + Shift mit Interrupt (Metal-5 Discard)
 *
 * Setup:
 * - Opponent's Hand: Gravity-2 (face-up)
 * - Opponent's Lane 1: Metal-5 (face-down)
 * - Opponent's Protokolle: ['Gravity', 'Metal', 'Fire']
 * - Opponent's Turn, Action Phase
 *
 * Test: AI spielt Gravity-2 → flippt Metal-5 → Metal-5 On-Flip discard triggert → AI muss danach Metal-5 shiften
 * Erwartet:
 *   1. AI spielt Gravity-2
 *   2. AI flippt Metal-5 face-up (select_card_to_flip_and_shift_for_gravity_2)
 *   3. Metal-5 On-Flip Effect: AI discardet 1 Karte
 *   4. QUEUED ACTION: gravity_2_shift_after_flip → AI shiftet Metal-5
 *   5. Turn endet
 *
 * Bug (VORHER): gravity_2_shift_after_flip nicht in aiManager → AI stuck
 * Fix (NACHHER): gravity_2_shift_after_flip in selectLane handler hinzugefügt
 */
export const scenario15_Gravity2ShiftInterrupt: TestScenario = {
    name: "Gravity-2 Flip → Metal-5 Discard → Shift",
    description: "🆕 Gravity-2 flippt Metal-5 → Discard Interrupt → shiften (Bug-Fix: AI stuck)",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Fire', 'Water', 'Light'],
            ['Gravity', 'Metal', 'Fire'],
            'opponent',
            'action'
        );

        // Opponent's hand: Gravity-2 + 1 andere Karte (für Metal-5 Discard)
        newState.opponent.hand = [
            createCard('Gravity', 2, true),
            createCard('Fire', 1)
        ];

        // Opponent's Lane 1: Metal-5 face-down
        newState = placeCard(newState, 'opponent', 1, createCard('Metal', 5, false));

        // Player: Ein paar Karten für vollständiges Setup
        newState = placeCard(newState, 'player', 0, createCard('Fire', 2, true));
        newState = placeCard(newState, 'player', 2, createCard('Light', 3, true));

        newState.player.hand = [
            createCard('Water', 1),
            createCard('Fire', 3)
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 16: Hate-2 Spieler spielt (Einfach)
 *
 * Setup:
 * - Player hat Hate-2 in Hand
 * - Player hat verschiedene Werte auf Lanes: Fire-4 (Lane 0), Water-2 (Lane 1), Light-6 (Lane 2)
 * - Opponent hat verschiedene Werte: Metal-3 (Lane 0), Death-5 (Lane 1), Gravity-2 (Lane 2)
 * - Player's Turn, Action Phase
 *
 * Test: Player spielt Hate-2 → wählt eigene höchste (Light-6) → wählt Gegners höchste (Death-5)
 * Erwartet:
 *   1. Player spielt Hate-2 in Lane 0 (Hate Protocol)
 *   2. Player muss eigene höchste uncovered Karte wählen (Light-6)
 *   3. Light-6 wird gelöscht
 *   4. Player muss Gegners höchste uncovered Karte wählen (Death-5)
 *   5. Death-5 wird gelöscht
 *   6. Turn endet
 */
export const scenario16_Hate2PlayerPlays: TestScenario = {
    name: "Hate-2 Player spielt (Einfach)",
    description: "🆕 Player spielt Hate-2 → Wählt eigene & Gegners höchste Karte",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Hate', 'Water', 'Light'],
            ['Metal', 'Death', 'Gravity'],
            'player',
            'action'
        );

        // Player: Hate-2 in Hand
        newState.player.hand = [createCard('Hate', 2, true)];

        // Player: Verschiedene Werte auf Lanes
        newState = placeCard(newState, 'player', 0, createCard('Fire', 4, true));  // Nicht höchste
        newState = placeCard(newState, 'player', 1, createCard('Water', 2, true)); // Tied highest!
        newState = placeCard(newState, 'player', 2, createCard('Light', 5, true)); // Höchste!

        // Opponent: Verschiedene Werte auf Lanes
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 3, true)); // Nicht höchste
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 5, true)); // Höchste!
        newState = placeCard(newState, 'opponent', 2, createCard('Gravity', 2, false)); // Face-down (value 2)

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 17: Hate-2 AI spielt (Normal)
 *
 * Setup:
 * - Opponent (AI) hat Hate-2 in Hand
 * - Opponent hat Fire-5 (Lane 0), Metal-3 (Lane 1), Death-2 face-down (Lane 2)
 * - Player hat Water-4 (Lane 0), Spirit-6 (Lane 1), Light-2 (Lane 2)
 * - Opponent's Turn, Action Phase
 *
 * Test: AI spielt Hate-2 → wählt eigene höchste (Fire-5) → wählt Players höchste (Spirit-6)
 * Erwartet:
 *   1. AI spielt Hate-2 in Lane 0 (Hate Protocol muss bei Opponent sein!)
 *   2. AI wählt eigene höchste (Fire-5) automatisch
 *   3. Fire-5 wird gelöscht
 *   4. AI wählt Players höchste (Spirit-6) automatisch
 *   5. Spirit-6 wird gelöscht
 *   6. Turn endet
 */
export const scenario17_Hate2AIPlays: TestScenario = {
    name: "Hate-2 AI spielt (Normal)",
    description: "🆕 AI spielt Hate-2 → AI wählt eigene & Players höchste automatisch",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Water', 'Spirit', 'Light'],
            ['Hate', 'Metal', 'Death'],
            'opponent',
            'action'
        );

        // Opponent (AI): Hate-2 in Hand
        newState.opponent.hand = [createCard('Hate', 2, true)];

        // Opponent: Verschiedene Werte
        newState = placeCard(newState, 'opponent', 0, createCard('Fire', 5, true));  // Höchste!
        newState = placeCard(newState, 'opponent', 1, createCard('Metal', 3, true)); // Nicht höchste
        newState = placeCard(newState, 'opponent', 2, createCard('Death', 2, false)); // Face-down (value 2)

        // Player: Verschiedene Werte
        newState = placeCard(newState, 'player', 0, createCard('Water', 4, true));  // Nicht höchste
        newState = placeCard(newState, 'player', 1, createCard('Spirit', 5, true)); // Höchste!
        newState = placeCard(newState, 'player', 2, createCard('Light', 2, true));  // Niedrig

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 17: Hate-2 AI spielt (Normal)
 *
 * Setup:
 * - Opponent (AI) hat Hate-2 in Hand
 * - Opponent hat Fire-5 (Lane 0), Metal-3 (Lane 1), Death-2 face-down (Lane 2)
 * - Player hat Water-4 (Lane 0), Spirit-6 (Lane 1), Light-2 (Lane 2)
 * - Opponent's Turn, Action Phase
 *
 * Test: AI spielt Hate-2 → wählt eigene höchste (Fire-5) → wählt Players höchste (Spirit-6)
 * Erwartet:
 *   1. AI spielt Hate-2 in Lane 0 (Hate Protocol muss bei Opponent sein!)
 *   2. AI wählt eigene höchste (Fire-5) automatisch
 *   3. Fire-5 wird gelöscht
 *   4. AI wählt Players höchste (Spirit-6) automatisch
 *   5. Spirit-6 wird gelöscht
 *   6. Turn endet
 */
export const scenario171_Hate2AIPlays: TestScenario = {
    name: "Hate-2 AI spielt (Normal) mit Auswahl",
    description: "🆕 AI spielt Hate-2 → AI wählt eigene & Players höchste automatisch",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Water', 'Spirit', 'Light'],
            ['Hate', 'Metal', 'Death'],
            'opponent',
            'action'
        );

        // Opponent (AI): Hate-2 in Hand
        newState.opponent.hand = [createCard('Hate', 2, true)];

        // Opponent: Verschiedene Werte
        newState = placeCard(newState, 'opponent', 0, createCard('Fire', 5, true));  // Höchste!
        newState = placeCard(newState, 'opponent', 1, createCard('Metal', 3, true)); // Nicht höchste
        newState = placeCard(newState, 'opponent', 2, createCard('Death', 2, false)); // Face-down (value 2)

        // Player: Verschiedene Werte
        newState = placeCard(newState, 'player', 0, createCard('Water', 4, true));  // Nicht höchste
        newState = placeCard(newState, 'player', 1, createCard('Spirit', 5, true)); // Höchste!
        newState = placeCard(newState, 'player', 2, createCard('Light', 5, true));  // Niedrig

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 18: Hate-2 Selbst-Löschung (Player)
 *
 * Setup:
 * - Player hat Hate-2 in Hand
 * - Player hat NUR niedrige Karten: Fire-1 (Lane 0), Water-0 (Lane 2)
 * - Opponent hat höhere Werte: Metal-4 (Lane 0), Death-5 (Lane 1)
 * - Player's Turn, Action Phase
 *
 * Test: Player spielt Hate-2 → wird selbst höchste Karte → löscht sich selbst → Effekt endet!
 * Erwartet:
 *   1. Player spielt Hate-2 in Lane 0 (Hate Protocol)
 *   2. Player muss eigene höchste wählen (Hate-2 selbst mit value 2!)
 *   3. Hate-2 löscht sich selbst
 *   4. Zweite Klausel triggert NICHT (Opponent verliert nichts)
 *   5. Log: "Hate-2 deleted itself, second clause does not trigger."
 */
export const scenario18_Hate2SelfDelete: TestScenario = {
    name: "Hate-2 Selbst-Löschung",
    description: "🆕 Hate-2 löscht sich selbst → Zweite Klausel entfällt (Regelwerk-Check)",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Hate', 'Fire', 'Water'],
            ['Metal', 'Death', 'Gravity'],
            'player',
            'action'
        );

        // Player: Hate-2 in Hand
        newState.player.hand = [createCard('Hate', 2, true)];

        // Player: NUR niedrige Karten (Hate-2 wird höchste sein!)
        newState = placeCard(newState, 'player', 1, createCard('Fire', 1, true));  // Niedriger als 2
        newState = placeCard(newState, 'player', 2, createCard('Water', 0, true)); // Niedriger als 2

        // Opponent: Höhere Werte (sollten NICHT gelöscht werden)
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 3, true));
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 5, true));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 19: Hate-2 mit Gleichstand (Mehrere höchste)
 *
 * Setup:
 * - Player hat Hate-2 in Hand
 * - Player hat MEHRERE Karten mit value 4: Fire-4 (Lane 0), Water-4 (Lane 1), Spirit-4 (Lane 2)
 * - Opponent hat auch Gleichstand: Metal-5 (Lane 0), Death-5 (Lane 1), Gravity-2 (Lane 2)
 * - Player's Turn, Action Phase
 *
 * Test: Player spielt Hate-2 → MUSS wählen welche von 3x value-4 → MUSS wählen welche von 2x value-5
 * Erwartet:
 *   1. Player spielt Hate-2
 *   2. Alle 3 eigenen Karten mit value 4 sind klickbar
 *   3. Player wählt eine (z.B. Fire-4)
 *   4. Fire-4 wird gelöscht
 *   5. Beide Gegner-Karten mit value 5 sind klickbar
 *   6. Player wählt eine (z.B. Death-5)
 *   7. Death-5 wird gelöscht
 */
export const scenario19_Hate2MultipleTies: TestScenario = {
    name: "Hate-2 Gleichstand (Auswahl)",
    description: "🆕 Hate-2 mit mehreren höchsten → Player muss wählen (Tied values)",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Hate', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Gravity'],
            'player',
            'action'
        );

        // Player: Hate-2 in Hand
        newState.player.hand = [createCard('Hate', 2, true)];

        // Player: DREI Karten mit value 4 (alle gleich hoch!)
        newState = placeCard(newState, 'player', 0, createCard('Fire', 4, true));
        newState = placeCard(newState, 'player', 1, createCard('Water', 4, true));
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 4, true));

        // Opponent: ZWEI Karten mit value 5 (gleich hoch!)
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 5, true));
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 5, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Gravity', 2, false)); // Niedriger

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 20: Hate-2 mit Face-Down Karten
 *
 * Setup:
 * - Player hat Hate-2 in Hand
 * - Player hat Face-down Karten (alle value 2): Fire (Lane 0), Water (Lane 1), Spirit (Lane 2)
 * - Opponent hat gemischt: Metal-6 face-up (Lane 0), Death face-down (Lane 1), Gravity-1 face-up (Lane 2)
 * - Player's Turn, Action Phase
 *
 * Test: Hate-2 mit face-down Karten → ALLE face-down haben value 2!
 * Erwartet:
 *   1. Player spielt Hate-2 (wird selbst value 2)
 *   2. Player's höchste: Alle 3 face-down + Hate-2 = alle value 2 (4x tied!)
 *   3. Player muss eine der 4 Karten wählen (3x face-down + Hate-2 selbst)
 *   4. Wenn Hate-2 gewählt → self-delete, Effekt endet
 *   5. Wenn andere gewählt → Opponent's höchste ist Metal-6
 */
export const scenario20_Hate2FaceDown: TestScenario = {
    name: "Hate-2 Face-Down Karten",
    description: "🆕 Hate-2 mit face-down → Alle face-down sind value 2 (Tied mit Hate-2)",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Hate', 'Fire', 'Water'],
            ['Metal', 'Death', 'Gravity'],
            'player',
            'action'
        );

        // Player: Hate-2 in Hand
        newState.player.hand = [createCard('Hate', 2, true)];

        // Player: ALLE face-down (value 2 each!)
        newState = placeCard(newState, 'player', 1, createCard('Fire', 5, false));   // Face-down = 2
        newState = placeCard(newState, 'player', 2, createCard('Water', 5, false));  // Face-down = 2

        // Opponent: Gemischt
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 5, true));   // Höchste!
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 4, false));  // Face-down = 2
        newState = placeCard(newState, 'opponent', 2, createCard('Gravity', 1, true)); // Niedrig

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 21: Hate-2 AI Play-Validation Test
 *
 * Setup:
 * - Opponent (AI) hat Hate-2 in Hand + andere Karten
 * - Opponent hat NUR niedrige Karten: Fire-0, Water-1
 * - Player hat höhere Karten
 * - Opponent's Turn, Action Phase
 *
 * Test: AI sollte Hate-2 NICHT face-up spielen (würde sich selbst löschen)
 * Erwartet:
 *   1. AI erkennt: Hate-2 würde sich selbst löschen
 *   2. AI spielt Hate-2 NICHT face-up (sollte andere Karte spielen oder face-down)
 *   3. Kein Self-Delete!
 */
export const scenario21_Hate2AIValidation: TestScenario = {
    name: "Hate-2 AI Play-Validation",
    description: "🆕 AI spielt Hate-2 NICHT face-up wenn es sich selbst löschen würde",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Fire', 'Water', 'Spirit'],
            ['Hate', 'Death', 'Metal'],
            'opponent',
            'action'
        );

        // Opponent (AI): Hate-2 + andere Karten in Hand
        newState.opponent.hand = [
            createCard('Hate', 2, true),
        ];

        // Opponent: NUR niedrige Karten (Hate-2 wäre höchste!)
        newState = placeCard(newState, 'opponent', 1, createCard('Fire', 0, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Water', 1, true));

        // Player: Höhere Karten
        newState = placeCard(newState, 'player', 0, createCard('Fire', 5, true));
        newState = placeCard(newState, 'player', 1, createCard('Water', 4, true));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 22: Hate-2 AI spielt OFFEN (Optimal)
 *
 * Setup:
 * - Opponent (AI) hat Hate-2 + hohe Karten (Fire-5, Metal-4) → Hate-2 ist NICHT höchste!
 * - Opponent's höchste: Fire-5
 * - Player hat nur eine sehr hohe Karte: Spirit-5 (Lane 1)
 * - Opponent's Turn, Action Phase
 *
 * Erwartetes Verhalten:
 * - Easy/Normal/Hard AI sollten Hate-2 OFFEN spielen (weil nicht höchste)
 * - AI löscht eigene Fire-5 (verliert 5)
 * - AI löscht Players Spirit-5 (Gegner verliert 5)
 * - Plus: Hate-2 bringt 2 Punkte auf dem Board
 * - Netto: Ausgeglichen, aber taktisch sinnvoll (gleiche Lane!)
 */
export const scenario22_Hate2AIPlaysOpen: TestScenario = {
    name: "Hate-2 AI spielt OFFEN (Optimal)",
    description: "🆕 AI spielt Hate-2 offen weil nicht höchste Karte",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Water', 'Spirit', 'Light'],
            ['Hate', 'Metal', 'Death'],
            'opponent',
            'action'
        );

        // Opponent (AI): Hate-2 + hohe Karten
        newState.opponent.hand = [createCard('Hate', 2, true)];

        // Opponent: Hohe Karten (Hate-2 wird NICHT höchste sein!)
        newState = placeCard(newState, 'opponent', 0, createCard('Fire', 5, true));  // Höchste!
        newState = placeCard(newState, 'opponent', 1, createCard('Metal', 4, true)); // Zweithöchste
        newState = placeCard(newState, 'opponent', 2, createCard('Death', 3, true)); // Dritthöchste

        // Player: NUR eine hohe Karte
        newState = placeCard(newState, 'player', 0, createCard('Water', 2, true));   // Niedrig
        newState = placeCard(newState, 'player', 1, createCard('Spirit', 5, true));  // Höchste!
        newState = placeCard(newState, 'player', 2, createCard('Light', 1, true));   // Niedrig

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 23: Chaos-3 Protocol-Free Playing Test
 *
 * Setup:
 * - Player has Chaos-3 (face-up, uncovered) in Lane 0
 * - Player has Gravity-2 in hand
 * - Protocols: player=Chaos, opponent=Spirit (Lane 0)
 * - Player's Turn, Action Phase
 *
 * Test: Player should be able to play Gravity-2 face-up in Lane 0 despite protocol mismatch
 * Expected:
 *   1. Player can play Gravity-2 face-up in ANY lane (because of Chaos-3)
 *   2. No "Illegal Move" error in console
 */
const scenario23_Chaos3ProtocolFree: TestScenario = {
    name: "Chaos-3 Protocol-Free Playing",
    description: "Player with Chaos-3 can play any card face-up in any lane",
    setup: (state: GameState): GameState => {
        let newState = initScenarioBase(
            state,
            ['Chaos', 'Fire', 'Water'],
            ['Spirit', 'Death', 'Metal'],
            'player',
            'action'
        );

        // Player: Chaos-3 (face-up, uncovered) in Lane 0
        newState = placeCard(newState, 'player', 0, createCard('Chaos', 3, true));

        // Player: Gravity-2 in Hand (should be playable face-up in ANY lane)
        newState.player.hand = [
            createCard('Gravity', 2, true),
            createCard('Hate', 3, true),
            createCard('Love', 1, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 24: Frost-3 Blocks Shifts (Covered)
 *
 * Setup:
 * - Opponent has Frost-3 (face-up, COVERED) in Lane 0
 * - Opponent has Metal-2 (face-down) on top of Frost-3
 * - Player has Gravity-1 in hand (shift effect)
 * - Player has Water-2 (face-up) in Lane 1
 * - Player's Turn, Action Phase
 *
 * Test: Frost-3 should block shifts even when covered (Top-Box effect)
 * Expected:
 *   1. Player plays Gravity-1 in Lane 1 (covering Water-2)
 *   2. Player should NOT be able to shift Gravity-1 to Lane 0 (Frost-3 blocks even when covered!)
 *   3. Console shows "[FROST-3 BLOCK] Blocking shift..."
 */
const scenario24_Frost3BlocksShift: TestScenario = {
    name: "Frost-3 Blocks Shifts (Covered)",
    description: "Frost-3 should prevent shifts even when covered (Top-Box effect always active)",
    setup: (state: GameState): GameState => {
        let newState = initScenarioBase(
            state,
            ['Gravity', 'Water', 'Fire'],
            ['Frost', 'Metal', 'Death'],
            'player',
            'action'
        );

        // Opponent: Frost-3 (face-up, covered) in Lane 0
        newState = placeCard(newState, 'opponent', 0, createCard('Frost', 3, true));
        // Opponent: Metal-2 (face-down) on top of Frost-3
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 2, false));

        // Player: Water-2 (face-up, uncovered) in Lane 1
        newState = placeCard(newState, 'player', 1, createCard('Water', 2, true));

        // Player: Gravity-1 in Hand (has shift effect)
        newState.player.hand = [
            createCard('Gravity', 1, true),
            createCard('Fire', 2, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 25: Water-0 Softlock Bug Fix
 *
 * Setup:
 * - Darkness-3 (face-down) in Lane 0
 * - Player has Water-0 in hand
 * - Player has Darkness-2 in hand
 * - Player's Turn, Action Phase
 *
 * Test: Water-0 self-flip should be cancelled when card becomes covered
 * Expected:
 *   1. Player plays Water-0 in Lane 0
 *   2. [Middle] Water-0 flips Darkness-3 face-up
 *   3. Player plays Darkness-2 face-down in Lane 0 (covering Water-0)
 *   4. Water-0's self-flip should be cancelled with log: "The self-flip effect was cancelled because it is now covered."
 *   5. NO SOFTLOCK - game continues normally
 */
const scenario25_Water0SoftlockFix: TestScenario = {
    name: "Water-0 Softlock Bug Fix",
    description: "Water-0 self-flip should be cancelled when card becomes covered before self-flip executes",
    setup: (state: GameState): GameState => {
        let newState = initScenarioBase(
            state,
            ['Water', 'Darkness', 'Light'],
            ['Apathy', 'Fire', 'Death'],
            'player',
            'action'
        );

        // Opponent: Darkness-3 (face-down) in Lane 0
        newState = placeCard(newState, 'player', 1, createCard('Darkness', 3, false));

        // Player: Water-0 and Darkness-2 in hand
        newState.player.hand = [
            createCard('Water', 0, true),
            createCard('Darkness', 2, true),
            createCard('Fire', 1, true), // Extra card for safety
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 26: Darkness-1 Flip and Shift Chain
 *
 * Setup:
 * - Player has Darkness protocol in Lane 0
 * - Opponent has Metal-2 (face-down) in Lane 0
 * - Opponent has Fire-1 (face-up) in Lane 1
 * - Player has Darkness-1 in hand
 * - Player's Turn, Action Phase
 *
 * Test: Darkness-1 should flip opponent card, then allow shifting that card
 * Expected:
 *   1. Player plays Darkness-1 in Lane 0
 *   2. [Middle Effect 1] Flip 1 opponent card -> Prompts to select Metal-2
 *   3. Metal-2 flips face-up
 *   4. [Middle Effect 2] "You may shift that card" -> Prompts to shift the FLIPPED card (Metal-2)
 *   5. Player can choose to shift Metal-2 to another lane OR skip (optional)
 */
const scenario26_DarkCust1FlipShift: TestScenario = {
    name: "Darkness-1 Flip and Shift Chain",
    description: "Darkness-1 should flip opponent card, then allow shifting that same card",
    setup: (state: GameState): GameState => {
        let newState = initScenarioBase(
            state,
            ['Darkness', 'Water', 'Fire'],
            ['Metal', 'Fire', 'Death'],
            'player',
            'action'
        );

        // Opponent: Metal-2 (face-down) in Lane 0
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 2, false));

        // Opponent: Fire-1 (face-up) in Lane 1
        newState = placeCard(newState, 'opponent', 1, createCard('Fire', 1, true));

		newState = placeCard(newState, 'opponent', 2, createCard('Hate', 0, false));

        // Player: Darkness-1 in hand
        newState.player.hand = [
            createCard('Darkness', 1, true),
            createCard('Water', 2, true),
            createCard('Fire', 3, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 27: Darkness-1 Flips Speed-3 - Middle Effect Should Execute
 *
 * Setup:
 * - Player has Darkness protocol in Lane 0
 * - Opponent has Speed-3 (face-down, uncovered) in Lane 1
 * - Opponent has Fire-1 (face-up, uncovered) in Lane 2 (target for Speed-3's shift effect)
 * - Player has Darkness-1 in hand
 * - Player's Turn, Action Phase
 *
 * Test: When Darkness-1 flips Speed-3, Speed-3's middle effect should execute BEFORE shift
 * Expected:
 *   1. Player plays Darkness-1 in Lane 0
 *   2. [Middle Effect 1] Darkness-1: Flip 1 opponent card -> Player selects Speed-3
 *   3. Speed-3 flips face-up
 *   4. [CRITICAL] Speed-3's Middle Effect triggers: "Shift 1 of your other cards" (Opponent's effect!)
 *   5. Opponent must select one of their cards to shift (e.g., Fire-1)
 *   6. AFTER Speed-3's effect completes, Darkness-1's shift effect should execute
 *   7. Player can choose to shift Speed-3 OR skip
 */
const scenario27_DarkCust1FlipSpeed3: TestScenario = {
    name: "Darkness-1 Flips Speed-3 - Middle Effect Execution",
    description: "When Darkness-1 flips Speed-3, Speed-3's middle effect (shift) should execute before Darkness-1's shift",
    setup: (state: GameState): GameState => {
        let newState = initScenarioBase(
            state,
            ['Darkness', 'Water', 'Fire'],
            ['Speed', 'Fire', 'Metal'],
            'player',
            'action'
        );

        // Opponent: Speed-3 (face-down, uncovered) in Lane 0
        newState = placeCard(newState, 'opponent', 0, createCard('Speed', 3, false));

        // Opponent: Fire-1 (face-up, uncovered) in Lane 1 - target for Speed-3's shift
        newState = placeCard(newState, 'opponent', 1, createCard('Fire', 1, true));

        // Opponent: Metal-2 (face-up, uncovered) in Lane 2 - another target
        newState = placeCard(newState, 'opponent', 2, createCard('Metal', 2, true));

        // Player: Darkness-1 in hand
        newState.player.hand = [
            createCard('Darkness', 1, true),
            createCard('Water', 2, true),
            createCard('Fire', 3, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 27: Darkness-1 Flips Speed-3 - Middle Effect Should Execute
 *
 * Setup:
 * - Player has Darkness protocol in Lane 0
 * - Opponent has Speed-3 (face-down, uncovered) in Lane 1
 * - Opponent has Fire-1 (face-up, uncovered) in Lane 2 (target for Speed-3's shift effect)
 * - Player has Darkness-1 in hand
 * - Player's Turn, Action Phase
 *
 * Test: When Darkness-1 flips Speed-3, Speed-3's middle effect should execute BEFORE shift
 * Expected:
 *   1. Player plays Darkness-1 in Lane 0
 *   2. [Middle Effect 1] Darkness-1: Flip 1 opponent card -> Player selects Speed-3
 *   3. Speed-3 flips face-up
 *   4. [CRITICAL] Speed-3's Middle Effect triggers: "Shift 1 of your other cards" (Opponent's effect!)
 *   5. Opponent must select one of their cards to shift (e.g., Fire-1)
 *   6. AFTER Speed-3's effect completes, Darkness-1's shift effect should execute
 *   7. Player can choose to shift Speed-3 OR skip
 */
const scenario28_Darkness1FlipSpeed3: TestScenario = {
    name: "Darkness-1 Flips Speed-3 - Middle Effect Execution",
    description: "When Darkness-1 flips Speed-3, Speed-3's middle effect (shift) should execute before Darkness-1's shift",
    setup: (state: GameState): GameState => {
        let newState = initScenarioBase(
            state,
            ['Darkness', 'Water', 'Fire'],
            ['Speed', 'Fire', 'Metal'],
            'player',
            'action'
        );

        // Opponent: Speed-3 (face-down, uncovered) in Lane 0
        newState = placeCard(newState, 'opponent', 0, createCard('Speed', 3, false));

        // Opponent: Fire-1 (face-up, uncovered) in Lane 1 - target for Speed-3's shift
        newState = placeCard(newState, 'opponent', 1, createCard('Fire', 1, true));

        // Opponent: Metal-2 (face-up, uncovered) in Lane 2 - another target
        newState = placeCard(newState, 'opponent', 2, createCard('Metal', 2, true));

        // Player: Darkness-1 in hand
        newState.player.hand = [
            createCard('Darkness', 1, true),
            createCard('Water', 2, true),
            createCard('Fire', 3, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 29: Fire-1 und Fire-2 Conditional Test
 *
 * Setup:
 * - Player has Fire protocol in Lane 0
 * - Player has Fire-1 and Fire-2 in hand
 * - Player has extra cards to discard
 * - Opponent has at least one card in each lane (face-up for targeting)
 * - Player's Turn, Action Phase
 *
 * Test: Fire-1 and Fire-2 "if_executed" conditional logic
 * Expected for Fire-1:
 *   1. Player plays Fire-1 in Lane 0
 *   2. [Middle Effect] "Discard 1 card. If you did, delete 1 uncovered card."
 *   3. Player discards a card
 *   4. Because discard succeeded, player can delete 1 uncovered card
 *   5. Player selects and deletes an opponent's card
 *
 * Expected for Fire-2:
 *   1. Player plays Fire-2 in Lane 0
 *   2. [Middle Effect] "Discard 1 card. If you did, return 1 uncovered card to its owner's hand."
 *   3. Player discards a card
 *   4. Because discard succeeded, player can return 1 uncovered card
 *   5. Player selects and returns an opponent's card
 */
export const scenario29_FireCustomConditional: TestScenario = {
    name: "Fire-1 & Fire-2 Conditional Test",
    description: "🆕 Fire-1 (discard -> delete) & Fire-2 (discard -> return) if_executed logic",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Fire', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: Fire-1, Fire-2 in hand + cards to discard
        newState.player.hand = [
            createCard('Fire', 1, true),
            createCard('Fire', 2, true),
            createCard('Fire', 0, true),  // Discard target 1
            createCard('Fire', 3, true), // Discard target 2
            createCard('Fire', 4, true),  // Extra card
            createCard('Fire', 5, true),  // Extra card
        ];

        // Opponent: At least one card in each lane (face-up for targeting)
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 3, true));
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 4, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 2, true));

        // Add some covered cards too (for more realistic test)
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 1, true)); // On top of Metal-3

        newState = placeCard(newState, 'player', 2, createCard('Spirit', 3, true));
        newState = placeCard(newState, 'player', 1, createCard('Water', 3, true));
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 2, true));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 30: Anarchy Test Playground
 *
 * Setup:
 * - Player has Anarchy protocol in Lane 0
 * - Player has all Anarchy cards in hand (0, 1, 2, 3, 5, 6)
 * - Opponent has cards on board for testing
 * - Player's Turn, Action Phase
 */
export const scenario30_AnarchyCustomPlayground: TestScenario = {
    name: "Anarchy Test Playground",
    description: "🆕 All Anarchy cards on hand for testing",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Anarchy', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Anarchy cards in hand
        newState.player.hand = [
            createCard('Anarchy', 0, true),
            createCard('Anarchy', 1, true),
            createCard('Anarchy', 2, true),
            createCard('Anarchy', 3, true),
            createCard('Anarchy', 5, true),
            createCard('Anarchy', 6, true),
        ];

        // Opponent: At least one card in each lane (mixed face-up/down for testing)
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 3, true));
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 4, false)); // Face-down
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 2, true));

        // Add some covered cards
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 1, true)); // On top of Metal-3

        // Player cards on board for testing
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 3, true));
        newState = placeCard(newState, 'player', 1, createCard('Water', 3, true));
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 2, true));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 31: Darkness Test Playground
 *
 * Setup:
 * - Player has Darkness protocol in Lane 0
 * - Player has all Darkness cards in hand (0, 1, 2, 3, 4, 5)
 * - Opponent has cards on board for testing
 * - Player's Turn, Action Phase
 */
export const scenario31_DarkCustPlayground: TestScenario = {
    name: "Darkness Test Playground",
    description: "🆕 All Darkness cards on hand for testing",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Darkness', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Darkness cards in hand
        newState.player.hand = [
            createCard('Darkness', 0, true),
            createCard('Darkness', 1, true),
            createCard('Darkness', 2, true),
            createCard('Darkness', 3, true),
            createCard('Darkness', 4, true),
            createCard('Darkness', 5, true),
        ];

        // Opponent: At least one card in each lane (mixed face-up/down for testing)
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 3, false)); // Face-down
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 4, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 2, false)); // Face-down

        // Add some covered cards
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 1, true)); // On top of Metal-3
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 2, false)); // Face-down covered

        // Player cards on board for testing
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 3, true));
        newState = placeCard(newState, 'player', 1, createCard('Water', 3, true));
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 2, true));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 32: Apathy Test Playground
 *
 * Setup:
 * - Player has Apathy protocol in Lane 0
 * - Player has all Apathy cards in hand (0, 1, 2, 3, 4, 5)
 * - Opponent has cards on board for testing
 * - Player's Turn, Action Phase
 */
export const scenario32_ApathyCustomPlayground: TestScenario = {
    name: "Apathy Test Playground",
    description: "🆕 All Apathy cards on hand for testing",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Apathy', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Apathy cards in hand
        newState.player.hand = [
            createCard('Apathy', 0, true),
            createCard('Apathy', 1, true),
            createCard('Apathy', 2, true),
            createCard('Apathy', 3, true),
            createCard('Apathy', 4, true),
            createCard('Apathy', 5, true),
        ];

        // Opponent: At least one card in each lane (mixed face-up/down for testing)
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 3, true));
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 4, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 2, true));

        // Add some covered cards
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 1, true)); // On top of Metal-3
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 1, false)); // Face-down covered

        // Player cards on board for testing
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 3, true));
        newState = placeCard(newState, 'player', 1, createCard('Water', 3, true));
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 2, true));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 33: Death Test Playground
 *
 * Setup:
 * - Player has Death protocol in Lane 0
 * - Player has all Death cards in hand (0, 1, 2, 3, 4, 5)
 * - Opponent has cards on board for testing (including value 0-1 for Death-4)
 * - Player's Turn, Action Phase
 */
export const scenario33_DeathCustomPlayground: TestScenario = {
    name: "Death Test Playground",
    description: "🆕 All Death cards on hand for testing",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Death_cust', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Death cards in hand
        newState.player.hand = [
            createCard('Death_cust', 0, true),
            createCard('Death_cust', 1, true),
            createCard('Death_cust', 2, true),
            createCard('Death_cust', 3, true),
            createCard('Death_cust', 4, true),
            createCard('Death_cust', 5, true),
        ];

        // Opponent: At least one card in each lane (including value 0-1 for Death-4 testing)
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 0, true)); // Value 0 for Death-4
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 1, true)); // Value 1 for Death-4
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 3, true));

        // Add some covered cards
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 2, true)); // On top of Metal-0
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 4, false)); // Face-down covered

        // Player cards on board for testing
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 3, true));
        newState = placeCard(newState, 'player', 1, createCard('Water', 3, true));
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 2, true));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 34: Water Test Playground
 *
 * Setup:
 * - Player has Water protocol in Lane 0
 * - Player has all Water cards in hand (0, 1, 2, 3, 4, 5)
 * - Opponent has cards on board for testing (including value 2 cards for Water-3)
 * - Player's Turn, Action Phase
 */
export const scenario34_WaterCustomPlayground: TestScenario = {
    name: "Water Test Playground",
    description: "🆕 All Water cards on hand for testing - wash away and renew",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Water', 'Fire', 'Spirit'],
            ['Metal', 'Death', 'Light'],
            'player',
            'action'
        );

        // Player: All Water cards in hand
        newState.player.hand = [
            createCard('Water', 0, true),
            createCard('Water', 1, true),
            createCard('Water', 2, true),
            createCard('Water', 3, true),
            createCard('Water', 4, true),
            createCard('Water', 5, true),
        ];

        // Opponent: Cards in all lanes, including value 2 cards for Water-3 testing
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 2, true)); // Value 2 for Water-3
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 3, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Light', 2, true)); // Value 2 for Water-3

        // Add some covered cards and face-down cards
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 4, true)); // On top of Metal-2
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 2, false)); // Face-down (value 2) for Water-3
        newState = placeCard(newState, 'opponent', 2, createCard('Light', 5, false)); // Face-down

        // Player cards on board for testing (including value 2 for Water-3)
        newState = placeCard(newState, 'player', 1, createCard('Fire', 2, true)); // Value 2
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 3, true));
        newState = placeCard(newState, 'player', 1, createCard('Fire', 4, true));

        // Add a face-down card for Water-0 flip testing
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 5, false)); // Face-down for Water-0

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

export const scenario35_SpiritCustomPlayground: TestScenario = {
    name: "Spirit Test Playground",
    description: "🆕 All Spirit cards on hand - true strength from within",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Spirit', 'Fire', 'Water'],
            ['Metal', 'Death', 'Light'],
            'player',
            'action'
        );

        // Player: All Spirit cards in hand
        newState.player.hand = [
            createCard('Spirit', 0, true),
            createCard('Spirit', 1, true),
            createCard('Spirit', 2, true),
            createCard('Spirit', 3, true),
            createCard('Spirit', 4, true),
            createCard('Spirit', 5, true),
        ];

        // Opponent: Mix of face-up and face-down cards for Spirit-2 flip testing
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 3, true));
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 2, false)); // Face-down for flipping
        newState = placeCard(newState, 'opponent', 2, createCard('Light', 4, true));

        // Add some covered cards
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 5, false)); // Covered, face-down
        newState = placeCard(newState, 'opponent', 2, createCard('Light', 3, true)); // On top of Light-4

        // Player cards on board for Spirit-3 shift testing
        newState = placeCard(newState, 'player', 1, createCard('Fire', 2, true));
        newState = placeCard(newState, 'player', 2, createCard('Water', 4, true));
        newState = placeCard(newState, 'player', 1, createCard('Fire', 3, false)); // Face-down


        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 36: Chaos Test Playground
 *
 * Setup:
 * - Player has Chaos protocol in Lane 0
 * - Player has all Chaos cards in hand (0, 1, 2, 3, 4, 5)
 * - Opponent and Player have covered cards in all lanes for Chaos-0 "In each line, flip 1 covered card"
 * - Player has covered cards for Chaos-2 "Shift 1 of your covered cards"
 * - Player's Turn, Action Phase
 */
export const scenario36_ChaosCustomPlayground: TestScenario = {
    name: "Chaos Test Playground",
    description: "🆕 All Chaos cards on hand - embrace the unpredictable",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Chaos', 'Fire', 'Water'],
            ['Metal', 'Death', 'Light'],
            'player',
            'action'
        );

        // Player: All Chaos cards in hand
        newState.player.hand = [
            createCard('Chaos', 0, true),
            createCard('Chaos', 1, true),
            createCard('Chaos', 2, true),
            createCard('Chaos', 3, true),
            createCard('Chaos', 4, true),
            createCard('Chaos', 5, true),
        ];

        // Opponent: Covered cards in ALL lanes for Chaos-0 testing ("In each line, flip 1 covered card")
        // Lane 0: Metal-2 (bottom, covered) + Metal-4 (top, uncovered)
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 2, true)); // Covered
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 4, true)); // Uncovered

        // Lane 1: Death-3 (bottom, covered, face-down) + Death-5 (top, uncovered)
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 3, false)); // Covered, face-down
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 5, true)); // Uncovered

        // Lane 2: Light-1 (bottom, covered) + Light-3 (top, uncovered, face-down)
        newState = placeCard(newState, 'opponent', 2, createCard('Light', 1, true)); // Covered
        newState = placeCard(newState, 'opponent', 2, createCard('Light', 3, false)); // Uncovered, face-down

        // Player: Covered cards for Chaos-2 shift testing + protocol rearrange testing
        // Lane 0: Fire-2 (bottom, covered) + Fire-4 (top, uncovered)
        newState = placeCard(newState, 'player', 0, createCard('Fire', 2, true)); // Covered - for Chaos-2 shift
        newState = placeCard(newState, 'player', 0, createCard('Fire', 4, true)); // Uncovered

        // Lane 1: Water-3 (bottom, covered, face-down) + Water-5 (top, uncovered)
        newState = placeCard(newState, 'player', 1, createCard('Water', 3, false)); // Covered, face-down
        newState = placeCard(newState, 'player', 1, createCard('Water', 5, true)); // Uncovered

        // Lane 2: Just one card for variety
        newState = placeCard(newState, 'player', 2, createCard('Fire', 1, true)); // Uncovered only

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 37: Gravity Test Playground
 *
 * Setup:
 * - Player has Gravity protocol in Lane 1
 * - Player has all Gravity cards in hand (0, 1, 2, 4, 5, 6)
 * - Lane 1 has multiple cards for Gravity-0 "For every 2 cards in this line, play..."
 * - Multiple cards in different lanes for Gravity-1 shift testing
 * - Face-up and face-down cards for Gravity-2 flip + shift combo
 * - Face-down cards for Gravity-4 shift to this line
 * - Opponent deck has cards for Gravity-6 "opponent plays in this line"
 * - Player's Turn, Action Phase
 */
export const scenario37_GravityCustomPlayground: TestScenario = {
    name: "Gravity Test Playground",
    description: "🆕 All Gravity cards on hand - pull everything together",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Fire', 'Gravity', 'Water'],
            ['Metal', 'Death', 'Light'],
            'player',
            'action'
        );

        // Player: All Gravity cards in hand
        newState.player.hand = [
            createCard('Gravity', 0, true),
            createCard('Gravity', 1, true),
            createCard('Gravity', 2, true),
            createCard('Gravity', 4, true),
            createCard('Gravity', 5, true),
            createCard('Gravity', 6, true),
        ];

        // Player Lane 1 (Gravity): Multiple cards for Gravity-0 testing
        // "For every 2 cards in this line, play the top card of your deck face-down under this card"

        // Player Lane 0: Cards for shift testing
        newState = placeCard(newState, 'player', 0, createCard('Fire', 1, true));

        // Player Lane 2: Cards for shift testing
        newState = placeCard(newState, 'player', 2, createCard('Water', 2, false)); // Face-down for Gravity-4 shift

        // Opponent: Cards for Gravity-2 flip testing and Gravity-4 shift testing
        // Lane 0: Mix of face-up and face-down
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 3, false)); // Face-down for Gravity-2 flip
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 4, true));

        // Lane 1: Face-down cards for Gravity-4 shift testing
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 2, false)); // Face-down - shiftable to Lane 1
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 3, true));

        // Lane 2: Mixed cards
        newState = placeCard(newState, 'opponent', 2, createCard('Light', 4, false)); // Face-down for Gravity-4

        // Ensure opponent has cards in deck for Gravity-6 testing
        newState.opponent.deck = [
            createCard('Metal', 5, true),
            createCard('Death', 4, true),
            createCard('Light', 5, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 38: Frost Playground
 *
 * Test all Frost cards
 */
export const scenario38_FrostCustomPlayground: TestScenario = {
    name: "Frost Test Playground",
    description: "🆕 All Frost cards on hand - pull everything together",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Fire', 'Frost', 'Water'],
            ['Metal', 'Death', 'Light'],
            'player',
            'action'
        );

        // Player: All Frost cards in hand
        newState.player.hand = [
            createCard('Frost', 0, true),
            createCard('Frost', 1, true),
            createCard('Frost', 2, true),
            createCard('Frost', 3, true),
            createCard('Frost', 4, true),
            createCard('Frost', 5, true),
        ];

        // Player Lane 0: Cards for shift testing
        newState = placeCard(newState, 'player', 0, createCard('Fire', 1, true));

        // Player Lane 2: Cards for shift testing
        newState = placeCard(newState, 'player', 2, createCard('Water', 2, false)); // Face-down

        // Opponent: Cards for flip testing and shift testing
        // Lane 0: Mix of face-up and face-down
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 3, false)); // Face-down
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 4, true));

        // Lane 1: Face-down cards for shift testing
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 2, false)); // Face-down
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 3, true));

        // Lane 2: Mixed cards
        newState = placeCard(newState, 'opponent', 2, createCard('Light', 4, false)); // Face-down

        // Ensure opponent has cards in deck
        newState.opponent.deck = [
            createCard('Metal', 5, true),
            createCard('Death', 4, true),
            createCard('Light', 5, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 39: Hate Playground
 *
 * Test all Hate cards
 * - Hate-0: Delete 1 card
 * - Hate-1: Discard 3 cards. Delete 1 card. Delete 1 card.
 * - Hate-2: Delete your highest value uncovered card. Delete your opponent's highest value uncovered card.
 * - Hate-3: [Top] After you delete cards: Draw 1 card.
 * - Hate-4: [Bottom on_cover] Delete the lowest value covered card in this line.
 * - Hate-5: You discard 1 card.
 */
export const scenario39_HateCustomPlayground: TestScenario = {
    name: "Hate Test Playground",
    description: "🆕 All Hate cards on hand - test deletion mechanics",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Hate', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Hate cards in hand (0-5, no 6 for Hate)
        newState.player.hand = [
            createCard('Hate', 0, true),
            createCard('Hate', 1, true),
            createCard('Hate', 2, true),
            createCard('Hate', 3, true),
            createCard('Hate', 4, true),
            createCard('Hate', 5, true),
        ];

        // Player Lane 0: Cards for delete testing (including covered cards for Hate-4)
        newState = placeCard(newState, 'player', 1, createCard('Water', 1, true)); // Covered
        newState = placeCard(newState, 'player', 1, createCard('Water', 2, true)); // Covered
        newState = placeCard(newState, 'player', 1, createCard('Water', 3, true)); // Uncovered

        // Player Lane 1: Cards for testing
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 2, true));

        // Player Lane 2: Cards for testing
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 4, false)); // Face-down

        // Opponent: Cards with various values for Hate-2 testing
        // Lane 0: High value card (will be deleted by Hate-2)
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 5, true));

        // Lane 1: Mixed values
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 2, true)); // Lower value
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 4, true)); // Higher value (uncovered)

        // Lane 2: Face-down card
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 3, false)); // Face-down

        // Ensure player has enough cards for discarding (Hate-1 needs 3 cards)
        newState.player.deck = [
            createCard('Water', 0, true),
            createCard('Water', 4, true),
            createCard('Spirit', 0, true),
            createCard('Spirit', 5, true),
        ];

        // Ensure opponent has cards in deck for potential draw effects
        newState.opponent.deck = [
            createCard('Metal', 3, true),
            createCard('Death', 5, true),
            createCard('Fire', 1, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 40: Life Playground
 *
 * Test all Life cards
 * - Life-0: Play the top card of your deck face-down in each line where you have a card.
 * - Life-1: Flip 1 card. Flip 1 card.
 * - Life-2: Draw 1 card. You may flip 1 face-down card.
 * - Life-3: [Bottom on_cover] When this card would be covered: First, play the top card of your deck face-down in another line.
 * - Life-4: If this card is covering a card, draw 1 card.
 * - Life-5: Discard 1 card.
 */
export const scenario40_LifeCustomPlayground: TestScenario = {
    name: "Life Test Playground",
    description: "🆕 All Life cards on hand - test play and flip mechanics",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Life', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Life cards in hand (0-5)
        newState.player.hand = [
            createCard('Life', 0, true),
            createCard('Life', 1, true),
            createCard('Life', 2, true),
            createCard('Life', 3, true),
            createCard('Life', 4, true),
            createCard('Life', 5, true),
        ];

        // Player Lane 0: Card for testing Life-0 (will have card, so Life-0 can play here)
        newState = placeCard(newState, 'player', 1, createCard('Water', 1, true)); // Covered
        newState = placeCard(newState, 'player', 1, createCard('Water', 2, true)); // Covered
        newState = placeCard(newState, 'player', 1, createCard('Water', 3, true)); // Uncovered

        // Player Lane 1: Cards for testing
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 2, true));

        // Player Lane 2: Cards for testing
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 4, false)); // Face-down

        // Opponent: Mixed cards for flip testing
        // Lane 0: Face-down card for Life-2 flip
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 3, false)); // Face-down

        // Lane 1: Face-up card for Life-1 flip
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 2, true));
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 4, false)); // Face-down (covered)

        // Lane 2: Face-down card for flip testing
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 5, false)); // Face-down

        // Ensure player has enough cards in deck for Life-0, Life-3 play effects
        newState.player.deck = [
            createCard('Water', 0, true),
            createCard('Water', 3, true),
            createCard('Water', 4, true),
            createCard('Spirit', 0, true),
            createCard('Spirit', 1, true),
            createCard('Spirit', 2, true),
            createCard('Spirit', 3, true),
            createCard('Spirit', 4, true),
        ];

        // Ensure opponent has cards in deck
        newState.opponent.deck = [
            createCard('Metal', 1, true),
            createCard('Death', 3, true),
            createCard('Fire', 2, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 41: Light Playground
 *
 * Test all Light cards
 * - Light-0: Flip 1 card. Draw cards equal to that card's value.
 * - Light-1: [Bottom end] End: Draw 1 card.
 * - Light-2: Draw 2 cards. You may shift or flip 1 face-down card. (simplified: choice between shift/flip)
 * - Light-3: Shift all face-down cards in this line to another line.
 * - Light-4: Your opponent reveals their hand.
 * - Light-5: Discard 1 card.
 */
export const scenario41_LightCustomPlayground: TestScenario = {
    name: "Light Test Playground",
    description: "🆕 All Light cards on hand - burn away the dark",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Light', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Light cards in hand (0-5)
        newState.player.hand = [
            createCard('Light', 0, true),
            createCard('Light', 1, true),
            createCard('Light', 2, true),
            createCard('Light', 3, true),
            createCard('Light', 4, true),
            createCard('Light', 5, true),
        ];

        // Opponent: Mixed cards for Light-0 flip testing
        // Lane 0: Fire-3 (face-down) - for Light-0 to flip → draws 3 cards if flipped face-up
        newState = placeCard(newState, 'opponent', 0, createCard('Fire', 3, false)); // Face-down (value 2) → flip to face-up (value 3)

        // Lane 1: Metal-4 (face-up) - for Light-0 to flip → draws 2 cards if flipped face-down
        newState = placeCard(newState, 'opponent', 1, createCard('Metal', 4, false)); // Face-up (value 4) → flip to face-down (value 2)

        // Lane 2: Death-5 (face-up) for variety
        newState = placeCard(newState, 'opponent', 2, createCard('Death', 5, true));

        // Player Lane 1: Multiple face-down cards for Light-3 testing ("Shift all face-down cards in this line")
        // Light-3 should shift ALL of these to another line
        newState = placeCard(newState, 'player', 1, createCard('Water', 2, false)); // Face-down (will be shifted by Light-3)
        newState = placeCard(newState, 'player', 1, createCard('Water', 3, false)); // Face-down (covered, will be shifted)
        newState = placeCard(newState, 'player', 1, createCard('Water', 4, false)); // Face-down (uncovered, will be shifted)

        // Player Lane 0: Mix of face-up and face-down
        newState = placeCard(newState, 'player', 0, createCard('Spirit', 1, true)); // Face-up (won't be shifted by Light-3)
        newState = placeCard(newState, 'player', 0, createCard('Spirit', 2, false)); // Face-down (will be shifted by Light-3 if in scope)

        // Player Lane 2: Face-down card for Light-2 shift/flip choice
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 5, false)); // Face-down for Light-2 testing

        // Ensure player has enough cards in deck for Light-0 draw effect
        newState.player.deck = [
            createCard('Water', 0, true),
            createCard('Water', 1, true),
            createCard('Spirit', 0, true),
            createCard('Spirit', 3, true),
            createCard('Spirit', 4, true),
        ];

        // Ensure opponent has cards in hand for Light-4 reveal testing
        newState.opponent.hand = [
            createCard('Metal', 1, true),
            createCard('Death', 2, true),
            createCard('Fire', 3, true),
            createCard('Metal', 0, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 42: Death-2 Uncover Interrupt - Turn muss zu Opponent wechseln
 *
 * Setup:
 * - Player's Turn, Action Phase
 * - Player hat Death-2 in der Hand
 * - Opponent hat Darkness-1 (oben) auf Darkness-4 (unten) auf Lane 1
 * - Player hat eine face-down Karte auf Lane 0 (zum Shiften)
 *
 * Test:
 * 1. Player spielt Death-2 → löscht Opponent's Darkness-1
 * 2. Darkness-4 wird uncovered → Opponent muss eine face-down Karte shiften
 * 3. Opponent shiftet Player's face-down Karte
 * 4. Nach dem Shift sollte der Turn zu OPPONENT wechseln (nicht zu Player's Start Phase!)
 *
 * Bug vorher: Nach dem Shift ging es zu Player's Start Phase (Death-1 Effekt triggerte)
 * Erwartet: Turn wechselt zu Opponent
 */
export const scenario42_Death2UncoverInterruptTurn: TestScenario = {
    name: "Death-2 Uncover Interrupt - Turn Wechsel Test",
    description: "Death-2 löscht → Darkness-4 uncovered → Opponent shiftet → Turn muss zu Opponent wechseln",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Death', 'Fire', 'Hate'],      // Player protocols
            ['Water', 'Darkness', 'Spirit'], // Opponent protocols
            'player',
            'action'
        );

        // Player: Death-2 in Hand (zum Spielen)
        newState.player.hand = [
            createCard('Death', 2, true),
            createCard('Fire', 1, true),
            createCard('Hate', 1, true),
        ];

        // Player: Eine face-down Karte auf Lane 0 (die vom Opponent geshiftet werden kann)
        newState = placeCard(newState, 'player', 0, createCard('Fire', 0, false));

        // Opponent: Darkness-4 (unten) mit Darkness-1 (oben) auf Lane 1
        // Darkness-4: "Shift 1 face-down card" wenn uncovered
        // Darkness-1 wird gelöscht → Darkness-4 uncovered
        newState = placeCard(newState, 'opponent', 1, createCard('Darkness', 4, true)); // UNTEN
        newState = placeCard(newState, 'opponent', 1, createCard('Darkness', 1, true)); // OBEN (wird gelöscht)
		
		newState = placeCard(newState, 'opponent', 0, createCard('Water', 0, false)); // OBEN (wird gelöscht)

        // Opponent braucht auch etwas in der Hand
        newState.opponent.hand = [
            createCard('Water', 1, true),
            createCard('Spirit', 1, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 43: Apathy-5 Uncover - darf nur einmal triggern
 *
 * Setup:
 * - Player's Turn, Action Phase
 * - Player hat Hate-0 in der Hand
 * - Opponent hat Apathy-4 (oben) auf Apathy-5 (unten) auf Lane 0
 *
 * Test:
 * 1. Player spielt Hate-0 auf Hate Lane
 * 2. Player wählt Opponent's Apathy-4 zum Löschen (Wert 4 ist NICHT 0 oder 1!)
 *    -> Warte, Hate-0 kann nur Wert 0-1 löschen, also brauchen wir eine andere Karte oben
 *
 * Korrektur: Apathy-0 (Wert 0) auf Apathy-5
 *
 * Test:
 * 1. Player spielt Hate-0 → löscht Apathy-0 (Wert 0)
 * 2. Apathy-5 wird uncovered → "Opponent discards 1 card"
 * 3. Apathy-5 darf NUR EINMAL triggern, nicht zweimal!
 *
 * Bug vorher: Apathy-5 triggerte zweimal und Opponent musste 2 Karten discarden
 * Erwartet: Apathy-5 triggert nur einmal
 */
export const scenario43_Apathy5DoubleUncover: TestScenario = {
    name: "Apathy-5 Uncover - darf nur einmal triggern",
    description: "Hate-0 löscht Apathy-0 → Apathy-5 uncovered → darf nur 1x triggern",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Hate', 'Fire', 'Death'],       // Player protocols
            ['Apathy', 'Darkness', 'Plague'], // Opponent protocols
            'player',
            'action'
        );

        // Player: Hate-0 in Hand (löscht 1 Karte mit Wert 0 oder 1)
        newState.player.hand = [
            createCard('Hate', 0, true),
            createCard('Fire', 2, true),
            createCard('Death', 2, true),
        ];

        // Opponent: Apathy-5 (unten) mit Apathy-0 (oben, Wert 0 - kann gelöscht werden) auf Lane 0
        // Wenn Apathy-0 gelöscht wird → Apathy-5 uncovered → "Opponent discards 1 card"
        newState = placeCard(newState, 'opponent', 0, createCard('Apathy', 5, true)); // UNTEN
        newState = placeCard(newState, 'opponent', 0, createCard('Apathy', 4, true)); // OBEN (wird gelöscht)

        // Opponent braucht Karten in der Hand zum Discarden
        newState.opponent.hand = [
            createCard('Darkness', 1, true),
            createCard('Apathy', 1, true),
            createCard('Darkness', 2, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

export const scenario44_Psychic1Darkness2Test: TestScenario = {
    name: "Psychic-1 facedown flip darkness 2 test",
    description: "Psychic-1 facedown, darkness-2 flippt Karte nur noch facedown bug",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Frost', 'Gravity', 'Plague'],       // Player protocols
            ['Psychic', 'Darkness', 'Speed'], // Opponent protocols
            'player',
            'action'
        );

        newState.player.hand = [
            createCard('Darkness', 1, true),
            createCard('Darkness', 2, true),
            createCard('Speed', 3, true),
        ];

        newState = placeCard(newState, 'opponent', 0, createCard('Frost', 0, false)); // UNTEN
        newState = placeCard(newState, 'opponent', 1, createCard('Gravity', 6, false)); // OBEN (wird gelöscht)

		newState = placeCard(newState, 'player', 0, createCard('Psychic', 4, false)); // UNTEN
        newState = placeCard(newState, 'player', 1, createCard('Psychic', 1, false)); // OBEN (wird gelöscht)

        // Opponent braucht Karten in der Hand zum Discarden
        newState.opponent.hand = [
            createCard('Gravity', 1, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 45: Speed Playground
 *
 * Test all Speed cards
 * - Speed-0: Play 1 card.
 * - Speed-1: [Top] After you clear cache: Draw 1 card. [Middle] Draw 2 cards.
 * - Speed-2: [Top] When this card would be deleted by compiling: Shift this card, even if covered.
 * - Speed-3: [Middle] Shift 1 of your other cards. [Bottom] End: You may shift 1 of your cards. If you do, flip this card.
 * - Speed-4: Shift 1 of your opponent's face-down cards.
 * - Speed-5: Discard 1 card.
 */
export const scenario45_SpeedCustomPlayground: TestScenario = {
    name: "Speed Test Playground",
    description: "🆕 All Speed cards on hand - swift and adaptive",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Speed', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Speed cards in hand (0-5)
        newState.player.hand = [
            createCard('Speed', 0, true),
            createCard('Speed', 1, true),
            createCard('Speed', 2, true),
            createCard('Speed', 3, true),
            createCard('Speed', 4, true),
            createCard('Speed', 5, true),
        ];

        // Setup for Speed-3 testing (shift 1 of your other cards)
        // Player Lane 0: Own cards to shift
        newState = placeCard(newState, 'player', 0, createCard('Water', 2, true)); // Face-up uncovered card to shift
        newState = placeCard(newState, 'player', 1, createCard('Spirit', 3, true)); // Another own card to shift

        // Setup for Speed-4 testing (shift opponent's face-down cards)
        // Opponent lanes with face-down cards
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 3, false)); // Face-down for Speed-4
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 4, false)); // Face-down for Speed-4
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 2, true));   // Face-up (not targetable by Speed-4)

        // Setup for Speed-2 compile testing
        // Player Lane 2: High value to potentially compile
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 5, true));
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 4, true));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 46: Metal Playground
 *
 * Test all Metal cards (values 0,1,2,3,5,6 - no 4!)
 * - Metal-0: [Top] Opponent total in this line -2. [Middle] Flip 1 card.
 * - Metal-1: Draw 2 cards. Your opponent cannot compile next turn.
 * - Metal-2: [Top] Opponent cannot play face-down in this line.
 * - Metal-3: Draw 1 card. Delete all cards in 1 other line with 8+ cards.
 * - Metal-5: Discard 1 card.
 * - Metal-6: [Top] When this card would be covered or flipped: First, delete this card.
 */
export const scenario46_MetalCustomPlayground: TestScenario = {
    name: "Metal Test Playground",
    description: "🆕 All Metal cards on hand - unyielding defense",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Metal', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Metal cards in hand (0,1,2,3,5,6 - no 4!)
        newState.player.hand = [
            createCard('Metal', 0, true),
            createCard('Metal', 1, true),
            createCard('Metal', 2, true),
            createCard('Metal', 3, true),
            createCard('Metal', 5, true),
            createCard('Metal', 6, true),
        ];

        // Setup for Metal-0 testing (flip 1 card, opponent total -2)
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 3, false)); // Face-down to flip
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 4, true));  // Face-up to flip

        // Setup for Metal-6 testing (delete on cover/flip)
        newState = placeCard(newState, 'player', 1, createCard('Water', 3, true)); // Card to cover Metal-6

        // Setup for Metal-3 testing (delete all in lane with 8+ cards)
        // Create a lane with many cards for testing
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 0, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 1, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 2, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 3, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 4, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 5, true));

        // Player cards to shift/test
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 3, true));
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 2, true));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 47: Plague Playground
 *
 * Test all Plague cards (values 0,1,2,3,4,5)
 * - Plague-0: [Middle] Opponent discards 1 card. [Bottom] Opponent cannot play cards in this line.
 * - Plague-1: [Top] After opponent discards: Draw 1 card. [Middle] Opponent discards 1 card.
 * - Plague-2: Discard 1 or more cards. Opponent discards amount+1.
 * - Plague-3: Flip all other face-up cards.
 * - Plague-4: [Bottom End] Opponent deletes 1 of their face-down cards. You may flip this card.
 * - Plague-5: Discard 1 card.
 */
export const scenario47_PlagueCustomPlayground: TestScenario = {
    name: "Plague Test Playground",
    description: "🦠 All Plague cards on hand - spread suffering",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Plague', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Plague cards in hand (0,1,2,3,4,5)
        newState.player.hand = [
            createCard('Plague', 0, true),
            createCard('Plague', 1, true),
            createCard('Plague', 2, true),
            createCard('Plague', 3, true),
            createCard('Plague', 4, true),
            createCard('Plague', 5, true),
        ];

        // Opponent has some cards to discard
        newState.opponent.hand = [
            createCard('Fire', 2, true),
            createCard('Death', 3, true),
            createCard('Water', 1, true),
        ];

        // Setup some face-up cards for Plague-3 testing (flip all other face-up)
        newState.player.lanes[0] = [createCard('Spirit', 2, true)];  // Face-up card
        newState.player.lanes[1] = [];
        newState.player.lanes[2] = [];

        newState.opponent.lanes[0] = [createCard('Metal', 1, true)];  // Face-up card
        newState.opponent.lanes[1] = [createCard('Death', 2, false)]; // Face-down for Plague-4
        newState.opponent.lanes[2] = [createCard('Fire', 3, true)];   // Face-up card

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Scenario 48: Love Playground
 * Test all Love effects:
 * - Love-1: Draw top card of opponent's deck. End: May give 1 card → draw 2.
 * - Love-2: Opponent draws 1 card. Refresh.
 * - Love-3: Take 1 random card from opponent's hand. Give 1 card to opponent.
 * - Love-4: Reveal 1 card from your hand. Flip 1 card.
 * - Love-5: Discard 1 card.
 * - Love-6: Opponent draws 2 cards.
 */
export const scenario48_LoveCustomPlayground: TestScenario = {
    name: "Love Test Playground",
    description: "💕 All Love cards on hand - share the love",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Love', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Love cards in hand (1,2,3,4,5,6)
        newState.player.hand = [
            createCard('Love', 1, true),
            createCard('Love', 2, true),
            createCard('Love', 3, true),
            createCard('Love', 4, true),
            createCard('Love', 5, true),
            createCard('Love', 6, true),
        ];

        // Opponent has cards in hand for Love-3 (take) and to see effects
        newState.opponent.hand = [
            createCard('Fire', 2, true),
            createCard('Death', 3, true),
            createCard('Water', 1, true),
            createCard('Metal', 4, true),
        ];

        // Setup some cards for Love-4 testing (flip any uncovered card)
        newState.player.lanes[0] = [createCard('Spirit', 2, true)];   // Face-up - can flip to face-down
        newState.player.lanes[1] = [];
        newState.player.lanes[2] = [];

        newState.opponent.lanes[0] = [createCard('Metal', 1, true)];  // Face-up - can flip
        newState.opponent.lanes[1] = [createCard('Death', 2, false)]; // Face-down - can flip to face-up
        newState.opponent.lanes[2] = [createCard('Fire', 3, true)];   // Face-up - can flip

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Scenario 49: Psychic Playground
 * Test all Psychic effects:
 * - Psychic-0: Draw 2 cards. Opponent discards 2. Reveal opponent's hand.
 * - Psychic-1: Top: Opponent can only play face-down (global). Start: Flip self.
 * - Psychic-2: Opponent discards 2. Rearrange opponent's protocols.
 * - Psychic-3: Opponent discards 1. Shift 1 opponent's card.
 * - Psychic-4: End: May return 1 opponent's card. If you do, flip self.
 * - Psychic-5: Discard 1 card.
 */
export const scenario49_PsychicCustomPlayground: TestScenario = {
    name: "Psychic Test Playground",
    description: "🔮 All Psychic cards on hand - read minds and control",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Psychic', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Psychic cards in hand (0,1,2,3,4,5)
        newState.player.hand = [
            createCard('Psychic', 0, true),
            createCard('Psychic', 1, true),
            createCard('Psychic', 2, true),
            createCard('Psychic', 3, true),
            createCard('Psychic', 4, true),
            createCard('Psychic', 5, true),
        ];

        // Opponent has cards for discard effects (Psychic-0, 2, 3)
        newState.opponent.hand = [
            createCard('Fire', 2, true),
            createCard('Death', 3, true),
            createCard('Water', 1, true),
            createCard('Metal', 4, true),
        ];

        // Setup opponent cards for shift (Psychic-3) and return (Psychic-4)
        newState.player.lanes[0] = [createCard('Spirit', 2, true)];
        newState.player.lanes[1] = [];
        newState.player.lanes[2] = [];

        newState.opponent.lanes[0] = [createCard('Metal', 1, true)];   // Can be shifted/returned
        newState.opponent.lanes[1] = [createCard('Death', 2, false)];  // Face-down - can shift/return
        newState.opponent.lanes[2] = [createCard('Fire', 3, true)];    // Can be shifted/returned

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 50: Gravity-2 AI Single Card Bug Test
 *
 * Setup:
 * - Opponent (AI) hat Gravity-2 in Hand + Death-1
 * - Player hat eine face-up Karte auf Lane 1 (für Flip-Target)
 * - Opponent's Turn, Action Phase
 *
 * Test: AI spielt Gravity-2 → flippt Player's Karte → shiftet diese Karte → Turn endet
 * Erwartet:
 *   1. AI spielt Gravity-2 (EINE Karte)
 *   2. AI flippt Player's Karte (z.B. Hate-4)
 *   3. AI shiftet die geflippte Karte zur Gravity Lane
 *   4. Turn endet → Player ist dran
 *   5. AI spielt NICHT Death-1 oder andere Karte!
 *
 * Bug (VORHER): AI spielte 2 Karten (Gravity-2 + Death-1) weil queuedActions nicht verarbeitet wurde
 * Fix (NACHHER): queuedActions wird vor dem Turn-Ende verarbeitet
 */
export const scenario50_Gravity2SingleCardBug: TestScenario = {
    name: "🐛 Gravity-2 AI Single Card Bug",
    description: "AI spielt Gravity-2 → Flip → Shift → Turn endet (NUR 1 Karte!)",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Hate', 'Fire', 'Water'],
            ['Gravity', 'Death', 'Metal'],
            'opponent',
            'action'
        );

        // Opponent (AI): Gravity-2 + Death-1 in Hand
        // Bug: AI spielte BEIDE Karten in einem Zug!
        newState.opponent.hand = [
            createCard('Gravity', 2, true),
            createCard('Death', 1, true),
            createCard('Metal', 3, true),
        ];

        // Player: Face-up Karte auf Lane 1 (Flip-Target für Gravity-2)
        newState = placeCard(newState, 'player', 1, createCard('Hate', 5, true));
        newState = placeCard(newState, 'player', 1, createCard('Hate', 4, true));

        // Mehr Player-Karten für realistisches Setup
        newState = placeCard(newState, 'player', 0, createCard('Fire', 2, true));
        newState = placeCard(newState, 'player', 2, createCard('Water', 3, true));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 51: Speed-3 End-Effekt Softlock Test
 *
 * Setup:
 * - Opponent's Turn, End Phase
 * - Opponent hat NUR Speed-3 als uncovered Karte (keine anderen eigenen uncovered Karten)
 * - Speed-3 hat Bottom-Effekt: "End: You may shift 1 of your uncovered cards. If you do, flip this card."
 *
 * Test:
 * 1. End Phase beginnt
 * 2. Speed-3 End-Effekt triggert: "prompt_optional_effect" für Shift
 * 3. AI akzeptiert den optionalen Shift
 * 4. Speed-3 sollte sich SELBST als gültiges Target finden (kein excludeSelf im End-Effekt!)
 * 5. AI wählt Speed-3 zum Shiften
 * 6. Nach dem Shift: Speed-3 flippt sich selbst (if_executed)
 *
 * Bug vorher: AI akzeptierte den Effekt, aber fand keine gültigen Targets → Softlock
 * Erwartet: Speed-3 kann sich selbst shiften
 */
export const scenario51_Speed3EndEffectSoftlock: TestScenario = {
    name: "Speed-3 End-Effekt Softlock Test",
    description: "Speed-3 als einzige uncovered Karte sollte sich selbst im End-Effekt shiften können",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Fire', 'Water', 'Death'],      // Player protocols
            ['Speed', 'Gravity', 'Light'],   // Opponent protocols - Speed ist wichtig!
            'opponent',
            'end'  // End Phase - hier triggert Speed-3's Bottom-Effekt
        );

        // Player: Ein paar Karten damit das Spiel realistisch aussieht
        newState.player.hand = [
            createCard('Fire', 1, true),
            createCard('Water', 2, true),
            createCard('Death', 0, true),
        ];
        newState = placeCard(newState, 'player', 0, createCard('Fire', 3, true));
        newState = placeCard(newState, 'player', 1, createCard('Water', 1, true));

        // Opponent: NUR Speed-3 als uncovered Karte!
        // Das ist der kritische Fall - Speed-3 muss sich selbst shiften können
        newState = placeCard(newState, 'opponent', 0, createCard('Speed', 3, true));

        // Opponent braucht auch Karten in der Hand
        newState.opponent.hand = [
            createCard('Gravity', 1, true),
            createCard('Light', 2, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 52: Uncover nach "Delete All" in Lane Test
 *
 * Setup:
 * - Player's Turn, Action Phase
 * - Player hat Death-2 in Hand (Middle: "Delete all cards in 1 line with values of 1 or 2")
 * - Opponent hat auf Lane 0:
 *   - Unten: Fire-5 (face-up) - diese sollte uncovered werden!
 *   - Oben: Fire-2 (face-up) - diese wird gelöscht
 *
 * Test:
 * 1. Player spielt Death-2 auf Lane 0
 * 2. Death-2 Effekt triggert: "Wähle eine Lane"
 * 3. Player wählt Lane 0
 * 4. Fire-2 wird gelöscht (Wert 2 im Bereich 1-2)
 * 5. Fire-5 sollte jetzt uncovered werden und dessen Effekt triggern!
 *
 * Bug vorher: Nach dem Löschen von Fire-2 wurde Fire-5 nicht uncovered
 * Erwartet: Fire-5 wird uncovered und dessen Middle-Effekt triggert
 */
export const scenario52_UncoverAfterBulkDelete: TestScenario = {
    name: "Uncover nach Delete All in Lane Test",
    description: "Death-2 löscht alle 1/2er → Karte darunter wird uncovered → Effekt triggert",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Death', 'Fire', 'Water'],      // Player protocols
            ['Fire', 'Spirit', 'Light'],     // Opponent protocols
            'player',
            'action'
        );

        // Player: Death-2 in Hand zum Spielen
        newState.player.hand = [
            createCard('Death', 2, true),
            createCard('Fire', 3, true),
            createCard('Water', 4, true),
        ];

        // Opponent Lane 0: Fire-5 unten (wird uncovered), Fire-2 oben (wird gelöscht)
        // WICHTIG: Fire-5 hat Middle-Effekt "Draw 2" - einfacher zu testen
        newState = placeCard(newState, 'opponent', 0, createCard('Fire', 5, true));  // Unten - bleibt
        newState = placeCard(newState, 'opponent', 0, createCard('Fire', 2, true));  // Oben - wird gelöscht

        // Player Lane 0: Auch eine Karte die gelöscht werden könnte
        newState = placeCard(newState, 'player', 0, createCard('Fire', 4, true));  // Wert 4 - bleibt

        // Mehr Kontext für realistisches Spiel
        newState = placeCard(newState, 'player', 1, createCard('Water', 3, true));
        newState = placeCard(newState, 'opponent', 1, createCard('Spirit', 2, true));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 53: Mehrfach-Uncover nach "Delete All" in Lane Test
 *
 * Setup:
 * - Player's Turn, Action Phase
 * - Player hat Death-2 in Hand
 * - Lane 0 hat bei BEIDEN Spielern Karten die gelöscht werden:
 *   - Player Lane 0: Water-5 unten (bleibt), Water-1 oben (wird gelöscht)
 *   - Opponent Lane 0: Fire-5 unten (bleibt), Fire-2 oben (wird gelöscht)
 *
 * Test:
 * 1. Player spielt Death-2
 * 2. Beide 1/2er werden gelöscht
 * 3. BEIDE 5er sollten uncovered werden!
 *
 * Bug vorher: Nur eine der Karten wurde uncovered
 * Erwartet: Beide Karten werden uncovered und deren Effekte triggern
 */
export const scenario53_MultiUncoverAfterBulkDelete: TestScenario = {
    name: "Mehrfach-Uncover nach Delete All Test",
    description: "Death-2 löscht bei beiden Spielern → beide Karten darunter werden uncovered",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Death', 'Water', 'Spirit'],    // Player protocols
            ['Fire', 'Light', 'Gravity'],    // Opponent protocols
            'player',
            'action'
        );

        // Player: Death-2 in Hand
        newState.player.hand = [
            createCard('Death', 2, true),
            createCard('Spirit', 3, true),
        ];
		

        newState.opponent.hand = [
            createCard('Fire', 3, true),
            createCard('Light', 5, true),
        ];

        // Player Lane 0: Water-5 unten (wird uncovered), Water-1 oben (wird gelöscht)
        newState = placeCard(newState, 'player', 0, createCard('Water', 5, true));   // Unten - bleibt
        newState = placeCard(newState, 'player', 0, createCard('Water', 1, true));   // Oben - wird gelöscht

        // Opponent Lane 0: Fire-5 unten (wird uncovered), Fire-2 oben (wird gelöscht)
        newState = placeCard(newState, 'opponent', 0, createCard('Fire', 5, true));  // Unten - bleibt
        newState = placeCard(newState, 'opponent', 0, createCard('Fire', 2, true));  // Oben - wird gelöscht

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 54: Life-1 Uncover Double Flip Bug Test
 *
 * Setup:
 * - PLAYER's Turn, START Phase
 * - Player hat Death-1 bereits auf dem Board (Start-Effekt triggert!)
 * - Opponent Lane 0: Life-1 (unten, covered) + beliebige Karte (oben - wird gelöscht)
 * - Beide Spieler haben weitere Karten zum Flippen
 *
 * Test:
 * 1. Death-1 Start-Effekt triggert: "Draw 1. Delete 1 other card. Delete this."
 * 2. Player wählt Draw (optional)
 * 3. Player wählt Opponent's obere Karte zum Löschen
 * 4. Life-1 wird uncovered → Effekt triggert: "Flip 1 card. Flip 1 card."
 * 5. Opponent muss ZWEIMAL flippen (nicht nur einmal!)
 *
 * Bug vorher: Nur der erste Flip wurde ausgeführt, der zweite wurde übersprungen
 * Erwartet: Beide Flip-Aktionen werden nacheinander ausgeführt
 */
export const scenario54_Life1UncoverDoubleFlip: TestScenario = {
    name: "Life-1 Uncover → Double Flip Bug",
    description: "Death-1 Start löscht → Life-1 uncovered → BEIDE Flips müssen ausgeführt werden",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Death', 'Fire', 'Water'],    // Player protocols - Death für Death-1!
            ['Life', 'Metal', 'Spirit'],   // Opponent protocols - Life für Life-1!
            'player',                       // PLAYER's turn
            'start'                         // START Phase - Death-1 Effekt triggert!
        );

        // Player: Leere Hand (nicht relevant für Start-Effekt)
        newState.player.hand = [
            createCard('Fire', 2, true),
        ];

        // Opponent: Einige Karten in Hand (nicht relevant)
        newState.opponent.hand = [
            createCard('Metal', 3, true),
            createCard('Spirit', 2, true),
        ];

        // Player Lane 0: Death-1 (face-up, Start-Effekt wird triggern!)
        newState = placeCard(newState, 'player', 0, createCard('Death', 1, true));

        // Opponent Lane 0: Life-1 (unten, covered) + Metal-0 (oben - wird gelöscht)
        // Life-1 wird uncovered nachdem Metal-0 gelöscht wird
        newState = placeCard(newState, 'opponent', 0, createCard('Life', 1, true));  // UNTEN - wird uncovered
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 0, true)); // OBEN - wird gelöscht

        // Weitere Karten zum Flippen (Life-1 braucht Ziele für beide Flips!)
        newState = placeCard(newState, 'player', 1, createCard('Water', 1, true));    // Flip target 1
        newState = placeCard(newState, 'opponent', 1, createCard('Metal', 1, true));  // Flip target 2
        newState = placeCard(newState, 'opponent', 2, createCard('Spirit', 0, true)); // Flip target 3

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 55: Smoke Playground
 *
 * Test all Smoke cards (values 0-5)
 * - Smoke-0: Play the top card of your deck face-down in each line with a face-down card.
 * - Smoke-1: Flip 1 of your cards. You may shift that card.
 * - Smoke-2: [Top] Your total value in this line is increased by 1 for each face-down card in this line.
 * - Smoke-3: Play 1 card face-down in a line with a face-down card.
 * - Smoke-4: Shift 1 covered face-down card.
 * - Smoke-5: You discard 1 card.
 */
export const scenario55_SmokeCustomPlayground: TestScenario = {
    name: "Smoke Test Playground",
    description: "🆕 All Smoke cards on hand - shroud your cards in mystery",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Smoke', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Smoke cards in hand (0-5)
        newState.player.hand = [
            createCard('Smoke', 0, true),
            createCard('Smoke', 1, true),
            createCard('Smoke', 2, true),
            createCard('Smoke', 3, true),
            createCard('Smoke', 4, true),
            createCard('Smoke', 5, true),
        ];

        // Setup for Smoke-0 and Smoke-3 testing (lines with face-down cards)
        // Lane 0: Face-down card for Smoke-0/Smoke-3 targeting
        newState = placeCard(newState, 'player', 0, createCard('Water', 2, false)); // Face-down for Smoke-0/3

        // Lane 1: Face-down card + another card for Smoke-4 (covered face-down)
        newState = placeCard(newState, 'opponent', 1, createCard('Metal', 3, false)); // Face-down (covered)
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 2, true));  // Face-up on top

        // Lane 2: Face-up only (no face-down cards - Smoke-0/3 should NOT target this)
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 2, true));
        newState = placeCard(newState, 'player', 2, createCard('Spirit', 3, true));

        // Setup for Smoke-1 testing (flip own cards)
        newState = placeCard(newState, 'player', 1, createCard('Spirit', 4, true)); // Own card to flip

        // Setup for Smoke-2 testing (value boost per face-down)
        // Playing Smoke-2 in lane 0 should get +1 value from the face-down Water-2

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 56: Smoke AI Test
 *
 * Test AI playing Smoke cards
 * Setup: AI has all Smoke cards in hand and Smoke protocol
 * - Opponent's Turn (AI plays)
 * - AI has face-down cards to target with Smoke-0 and Smoke-3
 */
export const scenario56_SmokeAITest: TestScenario = {
    name: "Smoke AI Test",
    description: "🆕 AI spielt Smoke Karten - test all Smoke card effects with AI",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Water', 'Spirit', 'Light'],
            ['Smoke', 'Metal', 'Death'],
            'opponent',  // AI's turn
            'action'
        );

        // Opponent (AI): All Smoke cards in hand (0-5)
        newState.opponent.hand = [
            createCard('Smoke', 0, true),
            createCard('Smoke', 1, true),
            createCard('Smoke', 2, true),
            createCard('Smoke', 3, true),
            createCard('Smoke', 4, true),
            createCard('Smoke', 5, true),
        ];

        // Setup for AI Smoke-0 and Smoke-3 testing (lines with face-down cards)
        // Lane 0: Face-down card for AI targeting
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 2, false)); // AI's face-down
        newState = placeCard(newState, 'player', 0, createCard('Water', 3, true));    // Player's face-up

        // Lane 1: Covered face-down card for Smoke-4
        newState = placeCard(newState, 'player', 1, createCard('Spirit', 2, false));  // Player's face-down (covered)
        newState = placeCard(newState, 'player', 1, createCard('Spirit', 4, true));   // Face-up on top

        // Lane 2: No face-down cards (to test Smoke-0/3 NOT playing here)
        newState = placeCard(newState, 'opponent', 2, createCard('Death', 3, true));
        newState = placeCard(newState, 'player', 2, createCard('Light', 2, true));

        // AI cards to flip with Smoke-1
        newState = placeCard(newState, 'opponent', 1, createCard('Metal', 4, true)); // AI's card to flip

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 57: Clarity Playground
 *
 * Test all Clarity cards (values 0-5)
 * - Clarity-0: [Top] Value +1 for each card in your hand.
 * - Clarity-1: [Start] Reveal top card of deck. You may discard it.
 *              [Middle] Your opponent reveals their hand.
 *              [Bottom] Draw 3 cards.
 * - Clarity-2: [Middle] Reveal your deck. Draw all cards with value 1. Shuffle. Play 1 card with value 1 in each other line.
 * - Clarity-3: [Middle] Reveal your deck. Draw all cards with value 5. Shuffle.
 * - Clarity-4: [Middle] You may shuffle your trash into your deck.
 * - Clarity-5: [Middle] Discard 1 card.
 */
export const scenario57_ClarityCustomPlayground: TestScenario = {
    name: "Clarity Test Playground",
    description: "All Clarity cards on hand - see through the fog of war",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Clarity', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Clarity cards in hand (0-5)
        newState.player.hand = [
            createCard('Clarity', 0, true),
            createCard('Clarity', 1, true),
            createCard('Clarity', 2, true),
            createCard('Clarity', 3, true),
            createCard('Clarity', 4, true),
            createCard('Clarity', 5, true),
        ];

        // Add some value-1 and value-5 cards to deck for Clarity-2/3 testing
        newState.player.deck = [
            createCard('Clarity', 1, true),  // Value 1 for draw/play
            createCard('Water', 1, true),    // Value 1 for draw/play
            createCard('Spirit', 5, true),   // Value 5 for Clarity-3
            createCard('Spirit', 3, true),   // Regular card
            createCard('Water', 2, true),    // Regular card
            createCard('Fire', 4, true),     // Regular card
        ];

        // Put some cards in discard for Clarity-4 testing
        newState.player.discard = [
            createCard('Water', 4, true),
            createCard('Spirit', 1, true),
        ];

        // Board setup for covering Clarity-1 (trigger bottom effect)
        newState = placeCard(newState, 'player', 0, createCard('Water', 2, true));  // Can cover with Clarity-1

        // Opponent's hand for reveal testing
        newState.opponent.hand = [
            createCard('Metal', 3, true),
            createCard('Death', 2, true),
            createCard('Fire', 4, true),
        ];

        // Board setup
        newState = placeCard(newState, 'opponent', 1, createCard('Metal', 3, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 2, true));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 58: Clarity AI Test
 *
 * Test AI playing Clarity cards
 * Setup: AI has all Clarity cards in hand and Clarity protocol
 * - Opponent's Turn (AI plays)
 */
export const scenario58_ClarityAITest: TestScenario = {
    name: "Clarity AI Test",
    description: "AI spielt Clarity Karten - test all Clarity card effects with AI",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Water', 'Spirit', 'Light'],
            ['Clarity', 'Metal', 'Death'],
            'opponent',  // AI's turn
            'action'
        );

        // Opponent (AI): All Clarity cards in hand (0-5)
        newState.opponent.hand = [
            createCard('Clarity', 0, true),
            createCard('Clarity', 1, true),
            createCard('Clarity', 2, true),
            createCard('Clarity', 3, true),
            createCard('Clarity', 4, true),
            createCard('Clarity', 5, true),
        ];

        // AI deck with value-1 and value-5 cards for testing
        newState.opponent.deck = [
            createCard('Clarity', 1, true),  // Value 1
            createCard('Metal', 1, true),    // Value 1
            createCard('Death', 5, true),    // Value 5
            createCard('Death', 3, true),    // Regular
            createCard('Metal', 2, true),    // Regular
        ];

        // AI discard for Clarity-4 testing
        newState.opponent.discard = [
            createCard('Metal', 4, true),
            createCard('Death', 2, true),
        ];

        // Player's hand for reveal testing
        newState.player.hand = [
            createCard('Water', 3, true),
            createCard('Spirit', 2, true),
            createCard('Light', 4, true),
        ];

        // Board setup
        newState = placeCard(newState, 'player', 0, createCard('Water', 3, true));
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 2, true));
        newState = placeCard(newState, 'player', 1, createCard('Spirit', 4, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Death', 3, true));

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Szenario 59: Corruption Playground
 *
 * Test all Corruption cards (values 0,1,2,3,5,6)
 * - Corruption-0: [Top Start] Flip 1 of your cards in this line. [Bottom] May play on opponent's side.
 * - Corruption-1: [Middle] Return 1 card. [Bottom] Opponent's returned cards go to deck face-down.
 * - Corruption-2: [Top] After you discard: Opponent discards 1. [Middle] Draw 1, discard 1.
 * - Corruption-3: [Middle] May flip 1 covered face-up card.
 * - Corruption-5: [Middle] Discard 1 card.
 * - Corruption-6: [Top End] Choice: Discard 1 OR delete this card.
 */
export const scenario60_CourageCustomPlayground: TestScenario = {
    name: 'Courage Custom Playground',
    description: 'Test all Courage effects: empty hand draw, opponent higher value delete, conditional draw/flip, highest value shift',
    setup: (state: GameState): GameState => {
        // Player has Courage protocol
        // Opponent has higher value in lanes 0 and 1
        // Opponent has lower value in lane 2
        const playerProtocols = ['Courage', 'Fire', 'Speed'];
        const opponentProtocols = ['Spirit', 'Water', 'Darkness'];

        let newState = initScenarioBase(state, playerProtocols, opponentProtocols, 'player', 'action');

        // Player hand - all Courage cards
        newState.player.hand = [
            createCard('Courage', 0, true),
            createCard('Courage', 1, true),
            createCard('Courage', 2, true),
            createCard('Courage', 3, true),
            createCard('Courage', 5, true),
            createCard('Courage', 6, true),
        ];

        // Board setup:
        // Lane 0: Opponent has 8, Player has 3 → Opponent higher (test Courage-1, Courage-2 End, Courage-6)
        newState = placeCard(newState, 'opponent', 0, createCard('Spirit', 3, true));
        newState = placeCard(newState, 'opponent', 0, createCard('Spirit', 5, true));
        newState = placeCard(newState, 'player', 0, createCard('Fire', 3, true));

        // Lane 1: Opponent has 6, Player has 4 → Opponent higher
        newState = placeCard(newState, 'opponent', 1, createCard('Water', 6, true));
        newState = placeCard(newState, 'player', 1, createCard('Speed', 4, true));

        // Lane 2: Opponent has 2, Player has 5 → Player higher (not valid for opponent_higher_value)
        newState = placeCard(newState, 'opponent', 2, createCard('Darkness', 2, true));
        newState = placeCard(newState, 'player', 2, createCard('Fire', 5, true));

        return finalizeScenario(newState);
    }
};

export const scenario61_CourageAITest: TestScenario = {
    name: 'Courage AI Test',
    description: 'Test AI with Courage protocol: lane-restricted delete, self-shift to highest value lane',
    setup: (state: GameState): GameState => {
        // AI (opponent) has Courage protocol
        // Player has varying values in lanes
        const playerProtocols = ['Spirit', 'Water', 'Fire'];
        const opponentProtocols = ['Courage', 'Speed', 'Darkness'];

        let newState = initScenarioBase(state, playerProtocols, opponentProtocols, 'opponent', 'action');

        // AI hand - key Courage cards for testing
        newState.opponent.hand = [
            createCard('Courage', 0, true),
            createCard('Courage', 1, true),
            createCard('Courage', 2, true),
            createCard('Courage', 3, true),
            createCard('Courage', 5, true),
            createCard('Courage', 6, true),
        ];

        // Board setup:
        // Lane 0: Player has 10 (highest), AI has 3 → Player higher
        newState = placeCard(newState, 'player', 0, createCard('Spirit', 5, true));
        newState = placeCard(newState, 'player', 0, createCard('Spirit', 5, true));
        newState = placeCard(newState, 'opponent', 0, createCard('Speed', 3, true));

        // Lane 1: Player has 6, AI has 4 → Player higher
        newState = placeCard(newState, 'player', 1, createCard('Water', 6, true));
        newState = placeCard(newState, 'opponent', 1, createCard('Darkness', 2, true));
        newState = placeCard(newState, 'opponent', 1, createCard('Darkness', 2, false)); // Face-down

        // Lane 2: Player has 3, AI has 5 → AI higher (not valid for opponent_higher_value)
        newState = placeCard(newState, 'player', 2, createCard('Fire', 3, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Speed', 5, true));

        return finalizeScenario(newState);
    }
};

export const scenario59_CorruptionCustomPlayground: TestScenario = {
    name: "Corruption Test Playground",
    description: "☠️ All Corruption cards on hand - corrupt your opponent's plans",
    setup: (state: GameState) => {
        let newState = initScenarioBase(
            state,
            ['Corruption', 'Water', 'Spirit'],
            ['Metal', 'Death', 'Fire'],
            'player',
            'action'
        );

        // Player: All Corruption cards in hand (0,1,2,3,5,6)
        newState.player.hand = [
            createCard('Corruption', 0, true),
            createCard('Corruption', 1, true),
            createCard('Corruption', 2, true),
            createCard('Corruption', 3, true),
            createCard('Corruption', 5, true),
            createCard('Corruption', 6, true),
        ];

        // Setup for Corruption-0 testing (flip own card in this lane at start)
        // Player Lane 0: Own card to flip when Corruption-0 starts
        newState = placeCard(newState, 'player', 0, createCard('Water', 2, true)); // Face-up - can flip

        // Setup for Corruption-1 testing (return 1 card + redirect to deck)
        // Opponent cards that can be returned
        newState = placeCard(newState, 'opponent', 0, createCard('Metal', 3, true));   // Can return
        newState = placeCard(newState, 'opponent', 1, createCard('Death', 4, true));   // Can return
        newState = placeCard(newState, 'opponent', 2, createCard('Fire', 2, true));    // Can return

        // Setup for Corruption-3 testing (flip covered face-up cards)
        // Create covered cards that can be flipped
        newState = placeCard(newState, 'player', 1, createCard('Spirit', 3, true));    // Bottom - covered
        newState = placeCard(newState, 'player', 1, createCard('Spirit', 5, true));    // Top - covers Spirit-3

        // Opponent has cards to discard (for Corruption-2 trigger)
        newState.opponent.hand = [
            createCard('Fire', 3, true),
            createCard('Metal', 4, true),
            createCard('Death', 5, true),
        ];

        newState = recalculateAllLaneValues(newState);
        return finalizeScenario(newState);
    }
};

/**
 * Fear Custom Protocol Playground
 *
 * Fear Cards:
 * - Fear-0: [Top Passive] During your turn, opponent's cards don't have middle commands. [Middle] Shift or flip 1 card.
 * - Fear-1: [Middle] Draw 2. Opponent discards hand, draws discarded - 1.
 * - Fear-2: [Middle] Return 1 of opponent's cards.
 * - Fear-3: [Middle] Shift 1 of opponent's covered or uncovered cards in this line.
 * - Fear-4: [Middle] Opponent discards 1 random card.
 * - Fear-5: [Middle] You discard 1 card.
 */
export const scenario62_FearCustomPlayground: TestScenario = {
    name: 'Fear Custom Playground',
    description: 'Test all Fear effects: passive ignore middle, choice shift/flip, chain discard, return, random discard',
    setup: (state: GameState): GameState => {
        const playerProtocols = ['Fear', 'Fire', 'Speed'];
        const opponentProtocols = ['Spirit', 'Water', 'Darkness'];

        let newState = initScenarioBase(state, playerProtocols, opponentProtocols, 'player', 'action');

        // Player hand - all Fear cards
        newState.player.hand = [
            createCard('Fear', 0, true),
            createCard('Fear', 1, true),
            createCard('Fear', 2, true),
            createCard('Fear', 3, true),
            createCard('Fear', 4, true),
            createCard('Fear', 5, true),
        ];

        // Board setup for testing:
        // Lane 0: Opponent cards for return/shift tests
        newState = placeCard(newState, 'opponent', 0, createCard('Spirit', 2, true));  // Covered
        newState = placeCard(newState, 'opponent', 0, createCard('Spirit', 3, true));  // Uncovered - can return
        newState = placeCard(newState, 'player', 0, createCard('Fire', 3, true));

        // Lane 1: Opponent cards with middle effects (for Fear-0 passive test)
        newState = placeCard(newState, 'opponent', 1, createCard('Water', 4, true));  // Has middle effect
        newState = placeCard(newState, 'player', 1, createCard('Speed', 4, true));

        // Lane 2: Face-down cards for flip tests
        newState = placeCard(newState, 'opponent', 2, createCard('Darkness', 2, false));  // Face-down
        newState = placeCard(newState, 'player', 2, createCard('Fire', 5, true));

        // Opponent needs hand for discard tests
        newState.opponent.hand = [
            createCard('Spirit', 1, true),
            createCard('Water', 2, true),
            createCard('Darkness', 3, true),
            createCard('Spirit', 4, true),
        ];

        return finalizeScenario(newState);
    }
};

export const scenario63_FearAITest: TestScenario = {
    name: 'Fear AI Test',
    description: 'Test AI with Fear protocol: random discard execution, passive rule handling',
    setup: (state: GameState): GameState => {
        // AI (opponent) has Fear protocol
        const playerProtocols = ['Spirit', 'Water', 'Fire'];
        const opponentProtocols = ['Fear', 'Speed', 'Darkness'];

        let newState = initScenarioBase(state, playerProtocols, opponentProtocols, 'opponent', 'action');

        // AI hand - key Fear cards for testing
        newState.opponent.hand = [
            createCard('Fear', 0, true),
            createCard('Fear', 1, true),
            createCard('Fear', 2, true),  // Random discard
            createCard('Fear', 3, true),
            createCard('Fear', 4, true),
            createCard('Fear', 5, true),
        ];

        // Board setup:
        // Lane 0: Player cards for AI to target
        newState = placeCard(newState, 'player', 0, createCard('Spirit', 3, true));
        newState = placeCard(newState, 'player', 0, createCard('Spirit', 5, true));
        newState = placeCard(newState, 'opponent', 0, createCard('Speed', 3, true));

        // Lane 1: Player covered card for shift test
        newState = placeCard(newState, 'player', 1, createCard('Water', 2, true));  // Covered
        newState = placeCard(newState, 'player', 1, createCard('Water', 4, true));  // Uncovered

        // Lane 2: Mixed setup
        newState = placeCard(newState, 'player', 2, createCard('Fire', 3, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Darkness', 5, true));

        // Player needs hand for discard tests
        newState.player.hand = [
            createCard('Spirit', 1, true),
            createCard('Water', 3, true),
            createCard('Fire', 4, true),
        ];

        return finalizeScenario(newState);
    }
};

/**
 * Ice Custom Protocol Playground
 *
 * Ice Cards:
 * - Ice-1: [Middle] You may shift this card. [Bottom Reactive] After opponent plays in this line: Opponent discards 1 card.
 * - Ice-2: [Middle] Shift 1 other card.
 * - Ice-3: [Top End] If this card is covered, you may shift it.
 * - Ice-4: [Bottom Passive] This card cannot be flipped.
 * - Ice-5: [Middle] You discard 1 card.
 * - Ice-6: [Top Passive] If you have any cards in hand, you cannot draw cards.
 */
export const scenario64_IceCustomPlayground: TestScenario = {
    name: 'Ice Custom Playground',
    description: '❄️ Test all Ice effects: conditional shift, flip block, draw block, lane-reactive discard',
    setup: (state: GameState): GameState => {
        const playerProtocols = ['Ice', 'Fire', 'Speed'];
        const opponentProtocols = ['Spirit', 'Water', 'Darkness'];

        let newState = initScenarioBase(state, playerProtocols, opponentProtocols, 'player', 'action');

        // Player hand - all Ice cards
        newState.player.hand = [
            createCard('Ice', 1, true),
            createCard('Ice', 2, true),
            createCard('Ice', 3, true),
            createCard('Ice', 4, true),
            createCard('Ice', 5, true),
            createCard('Ice', 6, true),
            createCard('Fire', 0, true),
        ];

        // Board setup for testing:
        // Lane 0: Player cards for Ice-3 (covered card) testing
        newState = placeCard(newState, 'player', 0, createCard('Fire', 3, true));  // Bottom - to cover Ice-3
        newState = placeCard(newState, 'player', 0, createCard('Fire', 5, true));  // Top - covers Fire-3

        // Lane 1: Opponent cards for shift and discard tests
        newState = placeCard(newState, 'opponent', 1, createCard('Water', 4, true));
        newState = placeCard(newState, 'player', 1, createCard('Speed', 4, true));

        // Lane 2: Cards for Ice-2 shift test
        newState = placeCard(newState, 'opponent', 2, createCard('Darkness', 2, true));
        newState = placeCard(newState, 'player', 2, createCard('Fire', 5, true));

        // Opponent needs hand for discard tests
        newState.opponent.hand = [
            createCard('Spirit', 1, true),
            createCard('Water', 2, true),
            createCard('Darkness', 3, true),
        ];

        return finalizeScenario(newState);
    }
};

export const scenario65_IceAITest: TestScenario = {
    name: 'Ice AI Test',
    description: '❄️ Test AI with Ice protocol: shift self, shift others, passive rules',
    setup: (state: GameState): GameState => {
        // AI (opponent) has Ice protocol
        const playerProtocols = ['Spirit', 'Water', 'Fire'];
        const opponentProtocols = ['Ice', 'Speed', 'Darkness'];

        let newState = initScenarioBase(state, playerProtocols, opponentProtocols, 'opponent', 'action');

        // AI hand - key Ice cards for testing
        newState.opponent.hand = [
            createCard('Ice', 1, true),
            createCard('Ice', 2, true),
            createCard('Ice', 3, true),
            createCard('Ice', 4, true),
            createCard('Ice', 5, true),
            createCard('Ice', 6, true),
        ];

        // Board setup:
        // Lane 0: Player cards for AI to interact with
        newState = placeCard(newState, 'player', 0, createCard('Spirit', 3, true));
        newState = placeCard(newState, 'player', 0, createCard('Spirit', 5, true));
        newState = placeCard(newState, 'opponent', 0, createCard('Speed', 3, true));

        // Lane 1: Covered AI card for Ice-3 test
        newState = placeCard(newState, 'opponent', 1, createCard('Darkness', 2, true));  // Bottom
        newState = placeCard(newState, 'opponent', 1, createCard('Darkness', 4, true));  // Top
        newState = placeCard(newState, 'player', 1, createCard('Water', 4, true));

        // Lane 2: Mixed setup
        newState = placeCard(newState, 'player', 2, createCard('Fire', 3, true));
        newState = placeCard(newState, 'opponent', 2, createCard('Speed', 5, true));

        // Player needs hand for discard tests
        newState.player.hand = [
            createCard('Spirit', 1, true),
            createCard('Water', 3, true),
            createCard('Fire', 4, true),
        ];

        return finalizeScenario(newState);
    }
};

export const scenario66_endPhasePlayground: TestScenario = {
    name: 'End Phase Test',
    description: 'Test the game rule for the end or start phase, only 1 trigger',
    setup: (state: GameState): GameState => {
        const playerProtocols = ['Light', 'Fire', 'Speed'];
        const opponentProtocols = ['Spirit', 'Water', 'Darkness'];

        let newState = initScenarioBase(state, playerProtocols, opponentProtocols, 'player', 'action');

        // Player hand - all Ice cards
        newState.player.hand = [
            createCard('Light', 5, true),
            createCard('Fire', 0, true),
        ];

        // Board setup for testing:
        newState = placeCard(newState, 'player', 0, createCard('Light', 1, true));  // 
        newState = placeCard(newState, 'player', 0, createCard('Light', 2, true));  // 


        newState = placeCard(newState, 'player', 1, createCard('Fire', 3, true));  // 
        //newState = placeCard(newState, 'player', 1, createCard('Fire', 2, true));  // 

        newState = placeCard(newState, 'player', 2, createCard('Speed', 3, true));

        // Opponent needs hand for discard tests
        newState.opponent.hand = [
            createCard('Spirit', 1, true),
            createCard('Water', 2, true),
            createCard('Darkness', 3, true),
        ];

        return finalizeScenario(newState);
    }
};

export const scenario67_startPhasePlayground: TestScenario = {
    name: 'Start Phase Test',
    description: 'Test the game rule for the end or start phase, only 1 trigger',
    setup: (state: GameState): GameState => {
        const playerProtocols = ['Spirit', 'Death', 'Psychic'];
        const opponentProtocols = ['Light', 'Water', 'Darkness'];

        let newState = initScenarioBase(state, playerProtocols, opponentProtocols, 'player', 'action');

        // Player hand - all Ice cards
        newState.player.hand = [
            createCard('Spirit', 5, true),
            createCard('Death', 0, true),
        ];

        // Board setup for testing:
        newState = placeCard(newState, 'player', 0, createCard('Spirit', 1, true));  // 
		newState = placeCard(newState, 'player', 0, createCard('Spirit', 2, true));  // 


        newState = placeCard(newState, 'player', 1, createCard('Death', 1, true));  // 
		newState = placeCard(newState, 'player', 1, createCard('Spirit', 3, true));  // 
        //newState = placeCard(newState, 'player', 1, createCard('Fire', 2, true));  // 

        newState = placeCard(newState, 'player', 2, createCard('Psychic', 1, true));

        // Opponent needs hand for discard tests
        newState.opponent.hand = [
            createCard('Light', 1, true),
            createCard('Water', 2, true),
            createCard('Darkness', 3, true),
        ];

        return finalizeScenario(newState);
    }
};

export const scenario68_CommittedCardPlayground: TestScenario = {
    name: 'Committed Card Test',
    description: 'Committed Card Test',
    setup: (state: GameState): GameState => {
        const playerProtocols = ['Spirit', 'Darkness', 'Psychic'];
        const opponentProtocols = ['Light', 'Water', 'Fire'];

        let newState = initScenarioBase(state, playerProtocols, opponentProtocols, 'player', 'action');

        // Player hand - all Ice cards
        newState.player.hand = [
            createCard('Darkness', 0, true),
            createCard('Death', 0, true),
        ];

        // Board setup for testing:
        newState = placeCard(newState, 'player', 0, createCard('Spirit', 0, true));  // 
		newState = placeCard(newState, 'player', 0, createCard('Spirit', 3, true));  // 

		newState = placeCard(newState, 'opponent', 0, createCard('Light', 1, true));  // 
		newState = placeCard(newState, 'opponent', 0, createCard('Light', 2, true));  // 


        // Opponent needs hand for discard tests
        newState.opponent.hand = [
            createCard('Light', 5, true),
            createCard('Water', 2, true),
            createCard('Darkness', 3, true),
        ];

        return finalizeScenario(newState);
    }
};

// Export all scenarios
export const allScenarios: TestScenario[] = [
    scenario1_Psychic3Uncover,
    scenario2_Psychic4EndEffect,
    scenario3_Spirit3EndPhase,
    scenario4_Plague2Actor,
    scenario5_Darkness1Interrupt,
    scenario8_Plague4Owner,
    scenario9_Water,
    scenario10_Hate1Interrupt,
    scenario11_Darkness1HateChain,
    scenario12_Water4TurnEnd,
    scenario13_Psychic3ShiftTest,
    scenario14_Death1UncoverTest,
    scenario15_Gravity2ShiftInterrupt,
    scenario16_Hate2PlayerPlays,
    scenario17_Hate2AIPlays,
	scenario171_Hate2AIPlays,
    scenario18_Hate2SelfDelete,
    scenario19_Hate2MultipleTies,
    scenario20_Hate2FaceDown,
    scenario21_Hate2AIValidation,
    scenario22_Hate2AIPlaysOpen,
    scenario23_Chaos3ProtocolFree,
    scenario24_Frost3BlocksShift,
    scenario25_Water0SoftlockFix,
    scenario26_DarkCust1FlipShift,
    scenario27_DarkCust1FlipSpeed3,
    scenario28_Darkness1FlipSpeed3,
    scenario29_FireCustomConditional,
    scenario30_AnarchyCustomPlayground,
    scenario31_DarkCustPlayground,
    scenario32_ApathyCustomPlayground,
    scenario33_DeathCustomPlayground,
    scenario34_WaterCustomPlayground,
    scenario35_SpiritCustomPlayground,
    scenario36_ChaosCustomPlayground,
    scenario37_GravityCustomPlayground,
    scenario38_FrostCustomPlayground,
    scenario39_HateCustomPlayground,
    scenario40_LifeCustomPlayground,
    scenario41_LightCustomPlayground,
    scenario42_Death2UncoverInterruptTurn,
    scenario43_Apathy5DoubleUncover,
    scenario44_Psychic1Darkness2Test,
    scenario45_SpeedCustomPlayground,
    scenario46_MetalCustomPlayground,
    scenario47_PlagueCustomPlayground,
    scenario48_LoveCustomPlayground,
    scenario49_PsychicCustomPlayground,
    scenario50_Gravity2SingleCardBug,
    scenario51_Speed3EndEffectSoftlock,
    scenario52_UncoverAfterBulkDelete,
    scenario53_MultiUncoverAfterBulkDelete,
    scenario54_Life1UncoverDoubleFlip,
    scenario55_SmokeCustomPlayground,
    scenario56_SmokeAITest,
    scenario57_ClarityCustomPlayground,
    scenario58_ClarityAITest,
    scenario59_CorruptionCustomPlayground,
    scenario60_CourageCustomPlayground,
    scenario61_CourageAITest,
    scenario62_FearCustomPlayground,
    scenario63_FearAITest,
    scenario64_IceCustomPlayground,
    scenario65_IceAITest,
	scenario66_endPhasePlayground,
	scenario67_startPhasePlayground,
	scenario68_CommittedCardPlayground,
];
