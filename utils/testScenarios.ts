/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player } from "../types";
import { v4 as uuidv4 } from 'uuid';
import { recalculateAllLaneValues } from '../logic/game/stateManager';
import { cards } from '../data/cards';

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
    // Find the card in the database to get texts
    const cardData = cards.find(c => c.protocol === protocol && c.value === value);

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

// Helper: Initialize common scenario setup
function initScenarioBase(state: GameState, playerProtocols: string[], opponentProtocols: string[], turn: Player, phase: GameState['phase']): GameState {
    let newState = { ...state };

    // ALWAYS set protocols (override existing ones for test scenarios)
    newState.player.protocols = playerProtocols;
    newState.opponent.protocols = opponentProtocols;

    // ALWAYS reset lanes (clear existing cards for test scenarios)
    newState.player.lanes = [[], [], []];
    newState.opponent.lanes = [[], [], []];

    // ALWAYS reset hands (will be filled by scenario)
    newState.player.hand = [];
    newState.opponent.hand = [];

    // Set turn and phase
    newState.turn = turn;
    newState.phase = phase;
    newState.actionRequired = null;
    newState.queuedActions = [];

    // Initialize effect tracking arrays
    newState.processedStartEffectIds = [];
    newState.processedEndEffectIds = [];
    newState.processedUncoverEventIds = [];

    return newState;
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

        return newState;
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
        return newState;
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
        const fireCard = cards.find(c => c.protocol === 'Fire' && c.value === 1);
        const waterCard = cards.find(c => c.protocol === 'Water' && c.value === 1);
        const spiritCard = cards.find(c => c.protocol === 'Spirit' && c.value === 1);
        newState.player.deck = [
            fireCard!,
            waterCard!,
            spiritCard!,
        ];

        newState = recalculateAllLaneValues(newState);
        return newState;
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
        return newState;
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
        return newState;
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
        return newState;
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
        return newState;
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
        return newState;
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
];
