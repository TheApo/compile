/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, Player, EffectResult, AnimationRequest, ActionRequired, EffectContext } from "../../../types";
import { getEffectiveCardValue } from "../../game/stateManager";
import { log } from "../../utils/log";
import { deleteCardFromBoard } from '../../utils/boardModifiers';
import { handleUncoverEffect } from '../../game/helpers/actionUtils';

/**
 * Hate-2: Delete your highest value uncovered card. Delete your opponent's highest value uncovered card.
 *
 * NOTE: This effect now requires manual selection. The card owner must choose which of their highest
 * value uncovered cards to delete, then which of the opponent's highest value uncovered cards to delete.
 * If there are multiple cards tied for highest value, the player/AI must choose one.
 * If Hate-2 deletes itself in the first step, the second step does not occur.
 */
export const execute = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext): EffectResult => {
    const { cardOwner } = context;
    let newState = { ...state };

    // FIRST ACTION: Card owner selects their own highest value uncovered card to delete
    newState.actionRequired = {
        type: 'select_own_highest_card_to_delete_for_hate_2',
        actor: cardOwner,
        sourceCardId: card.id,
        count: 1
    };

    return { newState };
};