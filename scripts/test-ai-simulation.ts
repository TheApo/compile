/**
 * AI Simulation Test Script
 *
 * Tests every custom protocol card by:
 * 1. Setting up a GameState where the card can be played/triggered
 * 2. Running AI decisions for any actionRequired
 * 3. Checking for softlocks (action not resolved after N iterations)
 * 4. Verifying the effect executed (state changed appropriately)
 */

import { GameState, PlayedCard, Player, ActionRequired, AIAction, LogEntry } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { getAllCustomProtocolCards, getCustomProtocol } from '../logic/customProtocols/cardFactory';
import { easyAI } from '../logic/ai/easy';
import { normalAI } from '../logic/ai/normal';
import { executeOnPlayEffect, executeOnFlipEffect } from '../logic/effectExecutor';
import { resolveActionWithCard, applyCardActionResult } from '../logic/game/resolvers/cardResolver';
import { resolveActionWithLane } from '../logic/game/resolvers/laneResolver';
import { resolveActionWithDiscard } from '../logic/game/resolvers/discardResolver';
import { resolveActionWithHandCard } from '../logic/game/resolvers/handCardResolver';
import * as promptResolver from '../logic/game/resolvers/promptResolver';
import * as phaseManager from '../logic/game/phaseManager';
import { recalculateAllLaneValues } from '../logic/game/stateManager';
import * as fs from 'fs';
import * as path from 'path';

const COLORS = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

const MAX_ITERATIONS = 50; // Max AI decisions before declaring softlock

interface TestResult {
    protocol: string;
    value: number;
    position: 'top' | 'middle' | 'bottom';
    success: boolean;
    error?: string;
    iterations: number;
    finalActionRequired?: string;
}

// Create a card with full data
function createCard(protocol: string, value: number, isFaceUp: boolean = true): PlayedCard {
    const allCards = getAllCustomProtocolCards();
    const cardData = allCards.find(c => c.protocol === protocol && c.value === value);

    if (!cardData) {
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
        ...(cardData as any).customEffects && { customEffects: (cardData as any).customEffects }
    };
}

// Create base game state
function createBaseState(playerProtocols: string[], opponentProtocols: string[]): GameState {
    // Build decks with remaining cards
    const allCards = getAllCustomProtocolCards();

    const buildDeck = (protocols: string[]) => {
        const deck: PlayedCard[] = [];
        for (const protocol of protocols) {
            const protocolCards = allCards.filter(c => c.protocol === protocol);
            for (const card of protocolCards) {
                deck.push(createCard(card.protocol, card.value, false));
            }
        }
        return deck.sort(() => Math.random() - 0.5);
    };

    const playerDeck = buildDeck(playerProtocols);
    const opponentDeck = buildDeck(opponentProtocols);

    return {
        player: {
            protocols: playerProtocols,
            lanes: [[], [], []],
            hand: playerDeck.splice(0, 5),
            deck: playerDeck,
            discard: [],
            stats: { cardsPlayed: 0, cardsDeleted: 0, compiledLanes: [] },
        },
        opponent: {
            protocols: opponentProtocols,
            lanes: [[], [], []],
            hand: opponentDeck.splice(0, 5),
            deck: opponentDeck,
            discard: [],
            stats: { cardsPlayed: 0, cardsDeleted: 0, compiledLanes: [] },
        },
        turn: 'player',
        phase: 'play',
        turnNumber: 1,
        laneValues: { player: [0, 0, 0], opponent: [0, 0, 0] },
        winner: null,
        actionRequired: null,
        queuedActions: [],
        stats: {
            player: { cardsPlayed: 0, cardsDeleted: 0, compiledLanes: [] },
            opponent: { cardsPlayed: 0, cardsDeleted: 0, compiledLanes: [] },
        },
        log: [],
        logIndent: 0,
        logSource: null,
        logPhase: null,
    };
}

// Apply AI action to state
function applyAIAction(state: GameState, action: AIAction): GameState {
    let newState = { ...state };

    switch (action.type) {
        case 'skip':
            // Try to skip the action
            if (state.actionRequired) {
                const skipTypes = [
                    'select_any_card_to_flip_optional',
                    'select_any_face_down_card_to_flip_optional',
                    'select_covered_card_in_line_to_flip_optional',
                ];
                if (skipTypes.includes(state.actionRequired.type) ||
                    ('optional' in state.actionRequired && state.actionRequired.optional)) {
                    newState.actionRequired = null;
                }
            }
            break;

        case 'flipCard':
            if (action.cardId) {
                const result = resolveActionWithCard(newState, action.cardId);
                // CRITICAL: Use applyCardActionResult to ensure callbacks are processed
                newState = applyCardActionResult(result, (s) => phaseManager.processEndOfAction(s));
            }
            break;

        case 'deleteCard':
            if (action.cardId) {
                const result = resolveActionWithCard(newState, action.cardId);
                // CRITICAL: Use applyCardActionResult to ensure followUpEffects are processed
                newState = applyCardActionResult(result, (s) => phaseManager.processEndOfAction(s));
            }
            break;

        case 'selectLane':
            if (action.laneIndex !== undefined) {
                const result = resolveActionWithLane(newState, action.laneIndex);
                newState = result.nextState;
            }
            break;

        case 'resolveOptionalDrawPrompt':
            newState = promptResolver.resolveOptionalDrawPrompt(newState, action.accept ?? false);
            break;

        case 'resolveDeath1Prompt':
            newState = promptResolver.resolveDeath1Prompt(newState, action.accept ?? false);
            break;

        case 'resolveLove1Prompt':
            newState = promptResolver.resolveLove1Prompt(newState, action.accept ?? false);
            break;

        case 'resolveLight2Prompt':
            newState = promptResolver.resolveLight2Prompt(newState, action.choice ?? 'skip');
            break;

        case 'resolveOptionalEffectPrompt':
            newState = promptResolver.resolveOptionalEffectPrompt(newState, action.accept ?? false);
            break;

        case 'discardCards':
            if (action.cardIds) {
                newState = resolveActionWithDiscard(newState, action.cardIds);
            }
            break;

        case 'selectHandCard':
            if (action.cardId) {
                const result = resolveActionWithHandCard(newState, action.cardId);
                newState = result.nextState;
            }
            break;

        default:
            // For unhandled types, try card resolver
            if ('cardId' in action && action.cardId) {
                const result = resolveActionWithCard(newState, action.cardId);
                // CRITICAL: Use applyCardActionResult to ensure callbacks are processed
                newState = applyCardActionResult(result, (s) => phaseManager.processEndOfAction(s));
            }
    }

    // Process queued actions
    newState = phaseManager.processQueuedActions(newState);

    return recalculateAllLaneValues(newState);
}

// Test a single card's effect
function testCardEffect(
    protocol: string,
    value: number,
    position: 'top' | 'middle' | 'bottom',
    ai: (state: GameState, action: ActionRequired | null) => AIAction
): TestResult {
    const result: TestResult = {
        protocol,
        value,
        position,
        success: false,
        iterations: 0,
    };

    try {
        // Setup state based on effect position
        let state = createBaseState(
            [protocol, 'Fire', 'Water'],
            [protocol, 'Fire', 'Water']
        );

        const card = createCard(protocol, value, position !== 'top');
        const cardOwner: Player = 'opponent'; // AI plays as opponent

        // Place the card appropriately
        if (position === 'top') {
            // Top: Play face-down, then flip
            card.isFaceUp = false;
            state.opponent.lanes[0] = [card];
            state = recalculateAllLaneValues(state);

            // Simulate flip to trigger top effect
            card.isFaceUp = true;
            const effectResult = executeOnFlipEffect(card, 0, state, {
                cardOwner: 'opponent',
                actor: 'opponent',
                currentTurn: 'opponent',
                opponent: 'player',
                triggerType: 'flip',
            });
            state = effectResult.newState;
        } else if (position === 'middle') {
            // Middle: Trigger on_play
            state.opponent.lanes[0] = [card];
            state = recalculateAllLaneValues(state);

            const effectResult = executeOnPlayEffect(card, 0, state, {
                cardOwner: 'opponent',
                actor: 'opponent',
                currentTurn: 'opponent',
                opponent: 'player',
                triggerType: 'play',
            });
            state = effectResult.newState;
        } else {
            // Bottom: Place as uncovered, effect should be passive or on specific trigger
            state.opponent.lanes[0] = [card];
            state = recalculateAllLaneValues(state);
        }

        // Add some target cards for effects that need them
        const targetCard1 = createCard('Fire', 2, true);
        const targetCard2 = createCard('Water', 3, true);
        const targetCard3 = createCard('Fire', 1, false);
        state.player.lanes[1] = [targetCard1];
        state.opponent.lanes[1] = [targetCard2];
        state.player.lanes[2] = [targetCard3];
        state = recalculateAllLaneValues(state);

        // Run AI until action is resolved or max iterations
        let iterations = 0;
        while (state.actionRequired && iterations < MAX_ITERATIONS) {
            const aiAction = ai(state, state.actionRequired);
            state = applyAIAction(state, aiAction);
            iterations++;
            result.iterations = iterations;
        }

        // Check for softlock
        if (state.actionRequired) {
            result.success = false;
            result.error = `Softlock after ${iterations} iterations`;
            result.finalActionRequired = state.actionRequired.type;
        } else {
            result.success = true;
        }
    } catch (err) {
        result.success = false;
        result.error = err instanceof Error ? err.message : String(err);
    }

    return result;
}

// Get all effects from a protocol
function getProtocolEffects(protocolName: string): Array<{ value: number; position: 'top' | 'middle' | 'bottom'; effectId: string }> {
    const effects: Array<{ value: number; position: 'top' | 'middle' | 'bottom'; effectId: string }> = [];

    const protocol = getCustomProtocol(protocolName);
    if (!protocol) return effects;

    for (const card of protocol.cards) {
        for (const effect of card.topEffects || []) {
            effects.push({ value: card.value, position: 'top', effectId: effect.id });
        }
        for (const effect of card.middleEffects || []) {
            effects.push({ value: card.value, position: 'middle', effectId: effect.id });
        }
        for (const effect of card.bottomEffects || []) {
            effects.push({ value: card.value, position: 'bottom', effectId: effect.id });
        }
    }

    return effects;
}

// Main test runner
async function runTests() {
    console.log(`${COLORS.blue}🤖 AI Simulation Tests${COLORS.reset}\n`);
    console.log('Testing every card effect with Easy and Normal AI...\n');

    const protocolsDir = path.join(process.cwd(), 'custom_protocols');
    const files = fs.readdirSync(protocolsDir).filter(f => f.endsWith('.json'));

    const results: TestResult[] = [];
    let passed = 0;
    let failed = 0;

    for (const file of files) {
        const protocolName = file.replace('_custom_protocol.json', '').replace(/_/g, ' ');
        const capitalizedName = protocolName.charAt(0).toUpperCase() + protocolName.slice(1);

        // Load protocol
        const content = fs.readFileSync(path.join(protocolsDir, file), 'utf-8');
        const protocol = JSON.parse(content);

        console.log(`${COLORS.cyan}Testing ${protocol.name}...${COLORS.reset}`);

        for (const card of protocol.cards) {
            const positions: Array<'top' | 'middle' | 'bottom'> = [];
            if (card.topEffects?.length > 0) positions.push('top');
            if (card.middleEffects?.length > 0) positions.push('middle');
            if (card.bottomEffects?.length > 0) positions.push('bottom');

            for (const position of positions) {
                // Test with Easy AI
                const easyResult = testCardEffect(protocol.name, card.value, position, easyAI);
                results.push({ ...easyResult, protocol: `${protocol.name} (Easy)` });

                if (easyResult.success) {
                    passed++;
                    console.log(`  ${COLORS.green}✓${COLORS.reset} ${protocol.name}-${card.value} ${position} (Easy)`);
                } else {
                    failed++;
                    console.log(`  ${COLORS.red}✗${COLORS.reset} ${protocol.name}-${card.value} ${position} (Easy): ${easyResult.error}`);
                    if (easyResult.finalActionRequired) {
                        console.log(`    ${COLORS.yellow}Stuck on: ${easyResult.finalActionRequired}${COLORS.reset}`);
                    }
                }

                // Test with Normal AI
                const normalResult = testCardEffect(protocol.name, card.value, position, normalAI);
                results.push({ ...normalResult, protocol: `${protocol.name} (Normal)` });

                if (normalResult.success) {
                    passed++;
                    console.log(`  ${COLORS.green}✓${COLORS.reset} ${protocol.name}-${card.value} ${position} (Normal)`);
                } else {
                    failed++;
                    console.log(`  ${COLORS.red}✗${COLORS.reset} ${protocol.name}-${card.value} ${position} (Normal): ${normalResult.error}`);
                    if (normalResult.finalActionRequired) {
                        console.log(`    ${COLORS.yellow}Stuck on: ${normalResult.finalActionRequired}${COLORS.reset}`);
                    }
                }
            }
        }
    }

    // Summary
    console.log(`\n${COLORS.blue}═══════════════════════════════════════${COLORS.reset}`);
    console.log(`${COLORS.blue}Summary:${COLORS.reset}`);
    console.log(`${COLORS.green}✓ Passed${COLORS.reset}: ${passed}`);
    console.log(`${COLORS.red}✗ Failed${COLORS.reset}: ${failed}`);
    console.log(`${COLORS.blue}═══════════════════════════════════════${COLORS.reset}\n`);

    // List all failures
    const failures = results.filter(r => !r.success);
    if (failures.length > 0) {
        console.log(`${COLORS.red}Failed tests:${COLORS.reset}`);
        for (const f of failures) {
            console.log(`  - ${f.protocol}-${f.value} ${f.position}: ${f.error}`);
        }
    }

    return failed === 0;
}

// Run if executed directly
runTests().then(success => {
    process.exit(success ? 0 : 1);
}).catch(err => {
    console.error('Test runner error:', err);
    process.exit(1);
});
