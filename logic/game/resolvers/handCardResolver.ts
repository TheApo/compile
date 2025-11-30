/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, EffectContext } from '../../../types';
import { log } from '../../utils/log';
import { drawForPlayer } from '../../../utils/gameStateModifiers';
import { executeCustomEffect } from '../../customProtocols/effectInterpreter';
import { findCardOnBoard } from '../helpers/actionUtils';

export const resolveActionWithHandCard = (prevState: GameState, cardId: string): GameState => {
    if (!prevState.actionRequired) return prevState;

    const { actionRequired } = prevState;
    // FIX: The actor is determined by the action, not whose turn it is. This is crucial for interrupts.
    const actor = actionRequired.actor;
    const opponent = actor === 'player' ? 'opponent' : 'player';

    switch (actionRequired.type) {
        case 'select_card_from_hand_to_give': {
            const cardToGive = prevState[actor].hand.find(c => c.id === cardId);
            if (!cardToGive) return prevState;

            let newState = { ...prevState };
            const actorState = { ...newState[actor] };
            const opponentState = { ...newState[opponent] };

            // Move card
            actorState.hand = actorState.hand.filter(c => c.id !== cardId);
            opponentState.hand = [...opponentState.hand, cardToGive];

            newState = { ...newState, [actor]: actorState, [opponent]: opponentState };

            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const cardName = `${cardToGive.protocol}-${cardToGive.value}`;
            newState = log(newState, actor, `${actorName} gives ${cardName} to the opponent.`);

            // Handle specific effect follow-ups (legacy Love-1 End support)
            if ((actionRequired as any).sourceEffect === 'love_1_end') {
                newState = log(newState, actor, `Love-1: ${actorName} draws 2 cards.`);
                newState = drawForPlayer(newState, actor, 2);
            }

            // NEW: Handle custom protocol followUpEffect (flexible conditional system)
            const followUpEffect = (actionRequired as any).followUpEffect;
            const conditionalType = (actionRequired as any).conditionalType;
            if (followUpEffect && conditionalType === 'if_executed') {
                // Find the source card to execute the followUpEffect
                const sourceCardInfo = findCardOnBoard(newState, actionRequired.sourceCardId);
                if (sourceCardInfo) {
                    const { card: sourceCard, laneIndex } = sourceCardInfo;
                    const context: EffectContext = {
                        cardOwner: actor as Player,
                        actor: actor as Player,
                        currentTurn: newState.turn,
                        opponent: opponent as Player,
                        triggerType: 'play' as const
                    };
                    // FIXED: Correct parameter order - (card, laneIndex, state, context, effectDef)
                    const result = executeCustomEffect(sourceCard, laneIndex, newState, context, followUpEffect);
                    newState = result.newState;
                }
            }

            newState.actionRequired = null;
            return newState;
        }

        case 'select_card_from_hand_to_reveal': {
            const cardToReveal = prevState[actor].hand.find(c => c.id === cardId);
            if (!cardToReveal) return prevState;

            let newState = { ...prevState };
            const actorState = { ...newState[actor] };

            // Mark the card as revealed in the hand
            const newHand = actorState.hand.map(c =>
                c.id === cardId ? { ...c, isRevealed: true } : c
            );
            actorState.hand = newHand;
            newState = { ...newState, [actor]: actorState };

            const actorName = actor === 'player' ? 'Player' : 'Opponent';
            const cardName = `${cardToReveal.protocol}-${cardToReveal.value}`;
            newState = log(newState, actor, `${actorName} reveals ${cardName} from their hand.`);

            // Check for pending custom effects (Love-4: "Reveal 1 card. Flip 1 card.")
            const pendingEffects = (newState as any)._pendingCustomEffects;
            if (pendingEffects && pendingEffects.effects.length > 0) {
                // Execute next pending effect
                const sourceCardInfo = findCardOnBoard(newState, pendingEffects.sourceCardId);
                if (sourceCardInfo) {
                    const { card: sourceCard } = sourceCardInfo;
                    const nextEffect = pendingEffects.effects[0];
                    const remainingEffects = pendingEffects.effects.slice(1);
                    const context: EffectContext = {
                        cardOwner: actor as Player,
                        actor: actor as Player,
                        currentTurn: newState.turn,
                        opponent: opponent as Player,
                        triggerType: 'play' as const
                    };
                    // FIXED: Correct parameter order - (card, laneIndex, state, context, effectDef)
                    const result = executeCustomEffect(sourceCard, pendingEffects.laneIndex, newState, context, nextEffect);
                    newState = result.newState;

                    // Store remaining effects if any
                    if (remainingEffects.length > 0) {
                        (newState as any)._pendingCustomEffects = {
                            ...pendingEffects,
                            effects: remainingEffects
                        };
                    } else {
                        delete (newState as any)._pendingCustomEffects;
                    }

                    return newState;
                }
            }

            // Legacy: Set up the next part of the effect for original Love-4: Flip 1 card
            // Only do this if there's no pending custom effects
            newState.actionRequired = {
                type: 'select_any_card_to_flip',
                count: 1,
                sourceCardId: actionRequired.sourceCardId,
                actor,
            };
            return newState;
        }

        default:
            return prevState;
    }
};
