/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player, PlayedCard } from '../../../types';
import { log } from '../../utils/log';
import { findAndFlipCards, drawForPlayer } from '../../../utils/gameStateModifiers';
import { findCardOnBoard } from '../helpers/actionUtils';
import { recalculateAllLaneValues } from '../stateManager';

export const resolveDeath1Prompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_death_1_effect') return prevState;

    const { sourceCardId, actor } = prevState.actionRequired;
    let newState = { ...prevState };

    if (accept) {
        newState = log(newState, actor, "Death-1: Player chooses to draw and delete.");
        // The actor draws one card.
        newState = drawForPlayer(newState, actor, 1);
        newState.actionRequired = {
            type: 'select_card_to_delete_for_death_1',
            sourceCardId,
            actor,
        };
    } else {
        newState = log(newState, actor, "Death-1: Player skips the effect.");
        newState.actionRequired = null;
    }
    return newState;
};

export const resolveLove1Prompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_give_card_for_love_1') return prevState;

    const { actor } = prevState.actionRequired;
    let newState = { ...prevState };

    if (accept) {
        newState = log(newState, actor, "Love-1 End: Player chooses to give 1 card to draw 2.");
        newState.actionRequired = {
            type: 'select_card_from_hand_to_give',
            sourceCardId: prevState.actionRequired.sourceCardId,
            sourceEffect: 'love_1_end',
            actor,
        };
    } else {
        newState = log(newState, actor, "Love-1 End: Player skips the effect.");
        newState.actionRequired = null;
    }
    return newState;
};

export const resolvePlague4Flip = (prevState: GameState, accept: boolean, player: Player): GameState => {
    if (prevState.actionRequired?.type !== 'plague_4_player_flip_optional') return prevState;
    
    let newState = { ...prevState, actionRequired: null };

    if (accept) {
        const { sourceCardId } = prevState.actionRequired;
        const actorName = player === 'player' ? 'Player' : 'Opponent';
        newState = log(newState, player, `Plague-4: ${actorName} chooses to flip the card.`);
        newState = findAndFlipCards(new Set([sourceCardId]), newState);
        newState.animationState = { type: 'flipCard', cardId: sourceCardId };
    } else {
        const actorName = player === 'player' ? 'Player' : 'Opponent';
        newState = log(newState, player, `Plague-4: ${actorName} skips flipping the card.`);
    }

    return newState;
};

export const resolveFire3Prompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_fire_3_discard') return prevState;
    
    const { actor } = prevState.actionRequired;
    let newState = { ...prevState };

    if (accept) {
        newState = log(newState, actor, "Fire-3 End: Player chooses to discard 1 to flip 1.");
        newState.actionRequired = {
            type: 'discard',
            actor: actor,
            count: 1,
            sourceCardId: prevState.actionRequired.sourceCardId,
            sourceEffect: 'fire_3',
        };
    } else {
        newState = log(newState, actor, "Fire-3 End: Player skips the effect.");
        newState.actionRequired = null;
    }
    return newState;
};

export const resolveSpeed3Prompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_shift_for_speed_3') return prevState;

    const { actor } = prevState.actionRequired;
    let newState = { ...prevState };

    if (accept) {
        newState = log(newState, actor, "Speed-3 End: Player chooses to shift a card.");
        newState.actionRequired = {
            type: 'select_own_card_to_shift_for_speed_3',
            sourceCardId: prevState.actionRequired.sourceCardId,
            actor,
        };
    } else {
        newState = log(newState, actor, "Speed-3 End: Player skips the shift.");
        newState.actionRequired = null;
    }
    return newState;
};

export const resolveLight2Prompt = (prevState: GameState, choice: 'shift' | 'flip' | 'skip'): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_shift_or_flip_for_light_2') return prevState;

    const { actor, sourceCardId, revealedCardId } = prevState.actionRequired;
    let newState = { ...prevState };

    switch (choice) {
        case 'shift':
            newState = log(newState, actor, "Light-2: Player chooses to shift the revealed card.");
            newState.actionRequired = {
                type: 'select_lane_to_shift_revealed_card_for_light_2',
                sourceCardId,
                revealedCardId,
                actor,
            };
            break;
        case 'flip':
            newState = log(newState, actor, "Light-2: Player chooses to flip the card back face-down.");
            newState = findAndFlipCards(new Set([revealedCardId]), newState);
            newState.animationState = { type: 'flipCard', cardId: revealedCardId };
            newState.actionRequired = null;
            break;
        case 'skip':
            newState = log(newState, actor, "Light-2: Player chooses to do nothing with the revealed card.");
            newState.actionRequired = null;
            break;
    }
    return newState;
};

export const resolveRearrangeProtocols = (prevState: GameState, newOrder: string[]): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_rearrange_protocols') return prevState;

    const { target, actor } = prevState.actionRequired;
    let newState = { ...prevState };
    const targetState = { ...newState[target] };

    // Create a map to preserve the compiled status of each protocol.
    const compiledStatusMap: { [protocol: string]: boolean } = {};
    targetState.protocols.forEach((proto, index) => {
        compiledStatusMap[proto] = targetState.compiled[index];
    });

    // Create the new array of compiled statuses based on the new protocol order.
    const newCompiled: boolean[] = newOrder.map(proto => compiledStatusMap[proto]);

    // Update only the protocols and their compiled status. The lanes (cards) remain in place.
    targetState.protocols = newOrder;
    targetState.compiled = newCompiled;

    newState[target] = targetState;
    newState.actionRequired = null;

    const actorName = actor === 'player' ? 'Player' : 'Opponent';
    const targetName = target === 'player' ? 'Player' : 'Opponent';
    newState = log(newState, actor, `${actorName} rearranges ${targetName}'s protocols.`);

    // Recalculating all values will correctly update laneValues based on the new protocol-to-lane mapping.
    return recalculateAllLaneValues(newState);
};


export const resolvePsychic4Prompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_return_for_psychic_4') return prevState;
    
    const { actor } = prevState.actionRequired;
    let newState = { ...prevState };

    if (accept) {
        newState = log(newState, actor, "Psychic-4 End: Player chooses to return an opponent's card.");
        newState.actionRequired = {
            type: 'select_opponent_card_to_return',
            sourceCardId: prevState.actionRequired.sourceCardId,
            actor,
        };
    } else {
        newState = log(newState, actor, "Psychic-4 End: Player skips the effect.");
        newState.actionRequired = null;
    }
    return newState;
};

export const resolveSpirit1Prompt = (prevState: GameState, choice: 'discard' | 'flip'): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_spirit_1_start') return prevState;

    const { actor, sourceCardId } = prevState.actionRequired;
    let newState = { ...prevState };

    if (choice === 'discard') {
        newState = log(newState, actor, "Spirit-1 Start: Player chooses to discard 1 card.");
        newState.actionRequired = {
            type: 'discard',
            actor: actor,
            count: 1,
            sourceCardId,
            sourceEffect: 'spirit_1_start',
        };
    } else { // flip
        newState = log(newState, actor, "Spirit-1 Start: Player chooses to flip the card.");
        newState = findAndFlipCards(new Set([sourceCardId]), newState);
        newState.animationState = { type: 'flipCard', cardId: sourceCardId };
        newState.actionRequired = null;
    }
    return newState;
};

export const resolveSpirit3Prompt = (prevState: GameState, accept: boolean): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_shift_for_spirit_3') return prevState;

    const { actor, sourceCardId } = prevState.actionRequired;
    let newState = { ...prevState };

    if (accept) {
        const cardInfo = findCardOnBoard(newState, sourceCardId);
        if (cardInfo) {
            const { owner, card } = cardInfo;
            let originalLaneIndex = -1;
            for (let i = 0; i < newState[owner].lanes.length; i++) {
                if (newState[owner].lanes[i].some(c => c.id === card.id)) {
                    originalLaneIndex = i;
                    break;
                }
            }
            if (originalLaneIndex !== -1) {
                newState = log(newState, actor, "Spirit-3 Trigger: Player chooses to shift the card.");
                newState.actionRequired = {
                    type: 'select_lane_for_shift',
                    cardToShiftId: sourceCardId,
                    cardOwner: owner,
                    originalLaneIndex: originalLaneIndex,
                    sourceCardId: sourceCardId,
                    actor: actor,
                    sourceEffect: 'speed_3_end', // Not exactly, but it's a shift from an end effect
                };
            }
        }
    } else {
        newState = log(newState, actor, "Spirit-3 Trigger: Player skips the shift.");
        newState.actionRequired = null;
    }
    return newState;
};

export const resolveSwapProtocols = (prevState: GameState, indices: [number, number]): GameState => {
    if (prevState.actionRequired?.type !== 'prompt_swap_protocols') return prevState;
    
    const { actor } = prevState.actionRequired;
    const playerState = { ...prevState[actor] };
    const [index1, index2] = indices.sort((a,b) => a-b);

    const newProtocols = [...playerState.protocols];
    const newCompiled = [...playerState.compiled];
    
    // Swap protocols and compiled status, but NOT the lanes themselves.
    [newProtocols[index1], newProtocols[index2]] = [newProtocols[index2], newProtocols[index1]];
    [newCompiled[index1], newCompiled[index2]] = [newCompiled[index2], newCompiled[index1]];

    playerState.protocols = newProtocols;
    playerState.compiled = newCompiled;
    
    let newState = { ...prevState, [actor]: playerState, actionRequired: null };
    newState = log(newState, actor, `${actor === 'player' ? 'Player' : 'Opponent'} swaps protocols ${newProtocols[index2]} and ${newProtocols[index1]}.`);

    return recalculateAllLaneValues(newState);
};