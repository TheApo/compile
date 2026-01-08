/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Zentrale Animation-Helper für AI-Aktionen.
 *
 * Dieses Modul folgt dem Prinzip "Capture → Change → Enqueue":
 * 1. Animation VOR State-Änderung erstellen (Snapshot korrekt)
 * 2. Resolver ausführen (State ändert sich)
 * 3. Animation(s) enqueuen
 *
 * DRY: Eine zentrale Stelle für alle AI-Animation-Erstellung.
 */

import { GameState, Player, PlayedCard, AnimationRequest, AIAction, ActionRequired } from '../../types';
import { AnimationQueueItem } from '../../types/animation';
import {
    findCardInLanes,
    createFlipAnimation,
    createDeleteAnimation,
    createReturnAnimation,
    createSequentialDrawAnimations,
    createSequentialDiscardAnimations,
    createShiftAnimation,
    createPlayAnimation,
    createCompileDeleteAnimations,
} from './animationHelpers';
import {
    flipCardMessage,
    deleteCardMessage,
    returnCardMessage,
    discardCardMessage,
    shiftCardMessage,
    playCardMessage,
    compileProtocolMessage,
} from '../utils/logMessages';

// Type für die enqueueAnimation-Funktion
type EnqueueFn = (item: Omit<AnimationQueueItem, 'id'>) => void;

// =============================================================================
// HELPER: Card Owner finden
// =============================================================================

/**
 * Findet den Owner einer Karte auf dem Board.
 * Sucht in beiden Spieler-Lanes.
 * @returns Player wenn gefunden, null wenn nicht
 */
function findCardOwner(state: GameState, cardId: string): Player | null {
    if (state.player.lanes.flat().some(c => c.id === cardId)) return 'player';
    if (state.opponent.lanes.flat().some(c => c.id === cardId)) return 'opponent';
    return null;
}

// =============================================================================
// SINGLE-CARD ANIMATIONS
// =============================================================================

/**
 * Erstellt und enqueued eine Flip-Animation.
 * @returns true wenn Animation erstellt wurde, false wenn Karte nicht gefunden
 */
export function createAndEnqueueFlipAnimation(
    state: GameState,
    cardId: string,
    enqueueAnimation: EnqueueFn,
    isOpponentAction: boolean = true
): boolean {
    const owner = findCardOwner(state, cardId);
    if (!owner) return false;

    const position = findCardInLanes(state, cardId, owner);
    if (!position) return false;

    const card = state[owner].lanes[position.laneIndex][position.cardIndex];
    if (!card) return false;

    const toFaceUp = !card.isFaceUp;
    const logMsg = flipCardMessage(card, toFaceUp);
    const animation = createFlipAnimation(
        state, card, owner, position.laneIndex, position.cardIndex, toFaceUp, isOpponentAction
    );
    enqueueAnimation({ ...animation, logMessage: { message: logMsg, player: owner } });
    return true;
}

/**
 * Erstellt und enqueued eine Delete-Animation.
 * @returns true wenn Animation erstellt wurde, false wenn Karte nicht gefunden
 */
export function createAndEnqueueDeleteAnimation(
    state: GameState,
    cardId: string,
    enqueueAnimation: EnqueueFn,
    isOpponentAction: boolean = true
): boolean {
    const owner = findCardOwner(state, cardId);
    if (!owner) return false;

    const position = findCardInLanes(state, cardId, owner);
    if (!position) return false;

    const card = state[owner].lanes[position.laneIndex][position.cardIndex];
    if (!card) return false;

    const logMsg = deleteCardMessage(card);
    const animation = createDeleteAnimation(
        state, card, owner, position.laneIndex, position.cardIndex, isOpponentAction
    );
    enqueueAnimation({ ...animation, logMessage: { message: logMsg, player: owner } });
    return true;
}

/**
 * Erstellt und enqueued eine Return-Animation.
 * @returns true wenn Animation erstellt wurde, false wenn Karte nicht gefunden
 */
export function createAndEnqueueReturnAnimation(
    state: GameState,
    cardId: string,
    enqueueAnimation: EnqueueFn,
    isOpponentAction: boolean = true
): boolean {
    const owner = findCardOwner(state, cardId);
    if (!owner) return false;

    const position = findCardInLanes(state, cardId, owner);
    if (!position) return false;

    const card = state[owner].lanes[position.laneIndex][position.cardIndex];
    if (!card) return false;

    const logMsg = returnCardMessage(card);
    const animation = createReturnAnimation(
        state, card, owner, position.laneIndex, position.cardIndex, true, isOpponentAction
    );
    enqueueAnimation({ ...animation, logMessage: { message: logMsg, player: owner } });
    return true;
}

/**
 * Erstellt und enqueued eine Shift-Animation.
 * CRITICAL: Muss VOR resolveActionWithLane aufgerufen werden für korrekten Snapshot.
 *
 * @param action Die ActionRequired mit Shift-Informationen
 * @param targetLaneIndex Die Ziel-Lane
 * @returns true wenn Animation erstellt wurde, false wenn keine Shift-Action oder Karte nicht gefunden
 */
export function createAndEnqueueShiftAnimation(
    state: GameState,
    action: ActionRequired,
    targetLaneIndex: number,
    enqueueAnimation: EnqueueFn,
    isOpponentAction: boolean = true
): boolean {
    const actionType = action.type || '';
    const isShiftAction = actionType.toLowerCase().includes('shift');

    if (!isShiftAction) return false;

    // Extract card info based on action type - different action types use different field names
    const req = action as any;
    let cardToShiftId: string | undefined;
    let cardOwner: Player | undefined;
    let originalLaneIndex: number | undefined;

    if (req.cardToShiftId) {
        // select_lane_for_shift, select_lane_for_shift_all
        cardToShiftId = req.cardToShiftId;
        cardOwner = req.cardOwner;
        originalLaneIndex = req.originalLaneIndex;
    } else if (req.cardId) {
        // shift_flipped_card_optional
        cardToShiftId = req.cardId;
        // Find owner and lane
        for (const player of ['player', 'opponent'] as Player[]) {
            const foundInLane = state[player].lanes.findIndex(lane =>
                lane.some(c => c.id === cardToShiftId)
            );
            if (foundInLane >= 0) {
                cardOwner = player;
                originalLaneIndex = foundInLane;
                break;
            }
        }
    } else if (req.revealedCardId) {
        // select_lane_to_shift_revealed_card
        cardToShiftId = req.revealedCardId;
        for (const player of ['player', 'opponent'] as Player[]) {
            const foundInLane = state[player].lanes.findIndex(lane =>
                lane.some(c => c.id === cardToShiftId)
            );
            if (foundInLane >= 0) {
                cardOwner = player;
                originalLaneIndex = foundInLane;
                break;
            }
        }
    }

    // Don't animate if shifting to same lane
    if (!cardToShiftId || !cardOwner || originalLaneIndex === undefined || originalLaneIndex === targetLaneIndex) {
        return false;
    }

    const cardToShift = state[cardOwner].lanes[originalLaneIndex]?.find((c: any) => c.id === cardToShiftId);
    const cardIndex = state[cardOwner].lanes[originalLaneIndex]?.findIndex((c: any) => c.id === cardToShiftId) ?? -1;

    if (!cardToShift || cardIndex < 0) {
        return false;
    }

    const fromProtocol = state[cardOwner].protocols[originalLaneIndex];
    const toProtocol = state[cardOwner].protocols[targetLaneIndex];
    const logMsg = shiftCardMessage(cardOwner, cardToShift, fromProtocol, toProtocol);

    const animation = createShiftAnimation(
        state,
        cardToShift,
        cardOwner,
        originalLaneIndex,
        cardIndex,
        targetLaneIndex,
        isOpponentAction
    );
    enqueueAnimation({ ...animation, logMessage: { message: logMsg, player: cardOwner } });
    return true;
}

/**
 * Erstellt und enqueued eine Play-Animation.
 * @param cardId Die ID der Karte die gespielt wird
 * @param laneIndex Die Ziel-Lane
 * @param isFaceUp Ob die Karte face-up gespielt wird
 * @param owner Wer die Karte spielt
 * @returns true wenn Animation erstellt wurde, false wenn Karte nicht gefunden
 */
export function createAndEnqueuePlayAnimation(
    state: GameState,
    cardId: string,
    laneIndex: number,
    isFaceUp: boolean,
    owner: Player,
    enqueueAnimation: EnqueueFn,
    isOpponentAction: boolean = true
): boolean {
    const card = state[owner].hand.find(c => c.id === cardId);
    const handIndex = state[owner].hand.findIndex(c => c.id === cardId);

    if (!card || handIndex < 0) return false;

    const protocolName = state[owner].protocols[laneIndex];
    const logMsg = playCardMessage(owner, card, protocolName, isFaceUp);
    const animation = createPlayAnimation(
        state, card, owner, laneIndex, true, handIndex, isFaceUp, isOpponentAction
    );
    enqueueAnimation({ ...animation, logMessage: { message: logMsg, player: owner } });
    return true;
}

// =============================================================================
// MULTI-CARD ANIMATIONS
// =============================================================================

// Type for batch enqueue function
type EnqueueBatchFn = (items: Omit<AnimationQueueItem, 'id'>[]) => void;

/**
 * Erstellt und enqueued Delete-Animationen für lane-basierte Deletes.
 * Unterstützt: select_lane_for_delete (Death-2) und select_lane_for_delete_all (Metal-3)
 * CRITICAL: Muss VOR resolveActionWithLane aufgerufen werden für korrekten Snapshot.
 * DRY: Eine zentrale Stelle für Player und AI.
 *
 * @param state - State VOR der Änderung (für korrekten Snapshot)
 * @param action - Die ActionRequired mit targetFilter, count, etc.
 * @param targetLaneIndex - Die ausgewählte Lane
 * @param enqueueAnimations - Funktion zum Enqueuen der Animationen (batch)
 * @param isOpponentAction - true wenn AI-Aktion
 * @returns true wenn Animationen erstellt wurden, false wenn keine passenden Karten oder falsche Action-Type
 */
export function createAndEnqueueLaneDeleteAnimations(
    state: GameState,
    action: ActionRequired,
    targetLaneIndex: number,
    enqueueAnimations: EnqueueBatchFn,
    isOpponentAction: boolean = false
): boolean {
    // Handle both delete action types
    const isDeleteAction = action.type === 'select_lane_for_delete';
    const isDeleteAllAction = action.type === 'select_lane_for_delete_all';

    if (!isDeleteAction && !isDeleteAllAction) return false;

    const req = action as any;
    const actor = req.actor || (isOpponentAction ? 'opponent' : 'player');

    // Collect matching cards from BOTH players' lanes
    const matchingCards: { card: PlayedCard; owner: Player; cardIndex: number }[] = [];

    if (isDeleteAllAction) {
        // select_lane_for_delete_all: Delete ALL cards in lane (Metal-3)
        for (const owner of ['player', 'opponent'] as Player[]) {
            const lane = state[owner].lanes[targetLaneIndex];
            for (let cardIndex = 0; cardIndex < lane.length; cardIndex++) {
                matchingCards.push({ card: lane[cardIndex], owner, cardIndex });
            }
        }
    } else {
        // select_lane_for_delete: Use targetFilter (Death-2, Courage-1)
        const targetFilter = req.targetFilter || {};
        const deleteAll = req.deleteAll === true;
        const deleteCount = req.count || 1;

        for (const owner of ['player', 'opponent'] as Player[]) {
            const lane = state[owner].lanes[targetLaneIndex];
            // Darkness-2 rule: face-down cards have value 4 if Darkness-2 is in lane
            const faceDownValueInLane = lane.some(c => c.isFaceUp && c.protocol === 'Darkness' && c.value === 2) ? 4 : 2;

            for (let cardIndex = 0; cardIndex < lane.length; cardIndex++) {
                const card = lane[cardIndex];
                const isUncovered = cardIndex === lane.length - 1;
                const value = card.isFaceUp ? card.value : faceDownValueInLane;

                // Apply targetFilter (same logic as laneResolver.ts)
                if (targetFilter.valueRange) {
                    const { min, max } = targetFilter.valueRange;
                    if (value < min || value > max) continue;
                }
                if (targetFilter.faceState === 'face_up' && !card.isFaceUp) continue;
                if (targetFilter.faceState === 'face_down' && card.isFaceUp) continue;
                if (targetFilter.owner === 'own' && owner !== actor) continue;
                if (targetFilter.owner === 'opponent' && owner === actor) continue;
                if (targetFilter.position === 'uncovered' && !isUncovered) continue;
                if (targetFilter.position === 'covered' && isUncovered) continue;

                matchingCards.push({ card, owner, cardIndex });

                // Respect count limit (unless deleteAll is true)
                if (!deleteAll && matchingCards.length >= deleteCount) break;
            }
            // Break outer loop too if we hit count limit
            if (!deleteAll && matchingCards.length >= deleteCount) break;
        }
    }

    if (matchingCards.length === 0) return false;

    // CRITICAL: Sort by cardIndex DESCENDING (uncovered cards first)
    matchingCards.sort((a, b) => b.cardIndex - a.cardIndex);

    // Create delete animations
    const animations: Omit<AnimationQueueItem, 'id'>[] = [];
    const hiddenCardIds = new Set<string>();

    matchingCards.forEach(({ card, owner, cardIndex }, idx) => {
        const animation = createDeleteAnimation(
            state,
            card,
            owner,
            targetLaneIndex,
            cardIndex,
            isOpponentAction,
            hiddenCardIds
        );
        hiddenCardIds.add(card.id);

        // Add logMessage to first card only
        if (idx === 0) {
            const logMsg = deleteCardMessage(card);
            animations.push({ ...animation, logMessage: { message: logMsg, player: owner } });
        } else {
            animations.push(animation);
        }
    });

    if (animations.length > 0) {
        enqueueAnimations(animations);
    }
    return true;
}

/**
 * Erstellt und enqueued sequentielle Discard-Animationen.
 * @returns true wenn Animationen erstellt wurden, false wenn keine gültigen Karten
 */
export function createAndEnqueueDiscardAnimations(
    state: GameState,
    cardIds: string[],
    owner: Player,
    enqueueAnimation: EnqueueFn
): boolean {
    const cardsToDiscard = cardIds
        .map(id => state[owner].hand.find(c => c.id === id))
        .filter((c): c is PlayedCard => c !== undefined);

    if (cardsToDiscard.length === 0) return false;

    const animations = createSequentialDiscardAnimations(state, cardsToDiscard, owner);
    if (animations.length > 0 && cardsToDiscard[0]) {
        const logMsg = discardCardMessage(owner, cardsToDiscard[0]);
        animations[0] = { ...animations[0], logMessage: { message: logMsg, player: owner } };
    }
    animations.forEach(anim => enqueueAnimation(anim));
    return true;
}

/**
 * Erstellt und enqueued sequentielle Draw-Animationen.
 * @param preDrawState State VOR dem Draw (für korrekten Snapshot)
 * @param newCards Die gezogenen Karten
 * @param owner Wer die Karten gezogen hat
 * @param startingHandIndex Index in der Hand wo die erste neue Karte erscheint
 * @param logMessage Optionale Log-Nachricht für die erste Animation
 * @returns true wenn Animationen erstellt wurden, false wenn keine Karten
 */
export function createAndEnqueueDrawAnimations(
    preDrawState: GameState,
    newCards: PlayedCard[],
    owner: Player,
    startingHandIndex: number,
    enqueueAnimation: EnqueueFn,
    logMessage?: string
): boolean {
    if (newCards.length === 0) return false;

    const animations = createSequentialDrawAnimations(preDrawState, newCards, owner, startingHandIndex);
    if (animations.length > 0 && logMessage) {
        animations[0] = { ...animations[0], logMessage: { message: logMessage, player: owner } };
    }
    animations.forEach(anim => enqueueAnimation(anim));
    return true;
}

// =============================================================================
// COMPILE ANIMATION HELPER
// =============================================================================

/**
 * Verarbeitet Compile-Delete-Animationen aus dem _compileAnimations Marker.
 * DRY: Zentrale Funktion für Player und AI Compile.
 *
 * @param stateAfterCompile - State NACH dem Compile (enthält _compileAnimations Marker)
 * @param stateBeforeCompile - State VOR dem Compile (für korrekten Snapshot)
 * @param laneIndex - Index der kompilierten Lane
 * @param owner - Wer kompiliert hat ('player' oder 'opponent')
 * @param enqueueAnimations - Funktion zum Enqueuen der Animationen (batch oder einzeln)
 * @returns State mit entferntem _compileAnimations Marker
 */
export function processCompileAnimations(
    stateAfterCompile: GameState,
    stateBeforeCompile: GameState,
    laneIndex: number,
    owner: Player,
    enqueueAnimations?: EnqueueBatchFn | EnqueueFn
): GameState {
    const compileAnimationData = (stateAfterCompile as any)._compileAnimations as
        { card: PlayedCard; owner: Player; laneIndex: number; cardIndex: number }[] | undefined;

    if (compileAnimationData && compileAnimationData.length > 0 && enqueueAnimations) {
        const deleteAnims = createCompileDeleteAnimations(stateBeforeCompile, compileAnimationData);
        if (deleteAnims.length > 0) {
            const protocolName = stateBeforeCompile[owner].protocols[laneIndex];
            const logMsg = compileProtocolMessage(owner, protocolName);
            deleteAnims[0] = { ...deleteAnims[0], logMessage: { message: logMsg, player: owner } };
        }

        // Support both batch and single-item enqueue functions
        if (deleteAnims.length > 0) {
            // Try to detect if it's a batch function by checking if first param accepts array
            // Simpler: just forEach always works with single-item, and we can wrap for batch
            deleteAnims.forEach(anim => (enqueueAnimations as EnqueueFn)(anim));
        }
    }

    // Clean up animation marker
    const stateWithoutMarker = { ...stateAfterCompile };
    delete (stateWithoutMarker as any)._compileAnimations;
    return stateWithoutMarker;
}

// =============================================================================
// DISPATCHER FÜR AI-ENTSCHEIDUNGEN
// =============================================================================

/**
 * Erstellt Animation basierend auf AI-Entscheidungs-Typ.
 * Dispatcher-Funktion die zur entsprechenden Animation-Creator routet.
 *
 * @returns Set von Animation-Typen die erstellt wurden (für Filterung von AnimationRequests)
 */
export function createAnimationForAIDecision(
    state: GameState,
    aiDecision: AIAction,
    enqueueAnimation: EnqueueFn
): Set<string> {
    const createdTypes = new Set<string>();

    switch (aiDecision.type) {
        case 'flipCard':
            if (createAndEnqueueFlipAnimation(state, aiDecision.cardId, enqueueAnimation)) {
                createdTypes.add('flip');
            }
            break;
        case 'deleteCard':
            if (createAndEnqueueDeleteAnimation(state, aiDecision.cardId, enqueueAnimation)) {
                createdTypes.add('delete');
            }
            break;
        case 'returnCard':
            if (createAndEnqueueReturnAnimation(state, aiDecision.cardId, enqueueAnimation)) {
                createdTypes.add('return');
            }
            break;
    }

    return createdTypes;
}

// =============================================================================
// FILTER FÜR BEREITS ERSTELLTE ANIMATIONEN
// =============================================================================

/**
 * Filtert AnimationRequests die bereits manuell erstellt wurden.
 * Verwende nach createAnimationForAIDecision um Doppel-Animationen zu vermeiden.
 */
export function filterAlreadyCreatedAnimations(
    animationRequests: AnimationRequest[],
    createdTypes: Set<string>
): AnimationRequest[] {
    return animationRequests.filter(req => !createdTypes.has(req.type));
}
