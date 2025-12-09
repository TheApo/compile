/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GameState, PlayedCard, Player } from '../types';

interface PhaseControllerProps {
    gameState: GameState;
    onFillHand: () => void;
    onSkipAction: () => void;
    onResolvePlague2Discard: (cardIds: string[]) => void;
    onResolvePlague4Flip: (accept: boolean) => void;
    onResolveFire3Prompt: (accept: boolean) => void;
    onResolveOptionalDiscardCustomPrompt: (accept: boolean) => void;
    onResolveOptionalEffectPrompt: (accept: boolean) => void;
    onResolveFire4Discard: (cardIds: string[]) => void;
    onResolveHate1Discard: (cardIds: string[]) => void;
    onResolveRevealBoardCardPrompt: (choice: 'shift' | 'flip' | 'skip') => void;
    onResolveOptionalDrawPrompt: (accept: boolean) => void;
    onResolveDeath1Prompt: (accept: boolean) => void;
    onResolveLove1Prompt: (accept: boolean) => void;
    onResolvePsychic4Prompt: (accept: boolean) => void;
    onResolveSpirit1Prompt: (choice: 'discard' | 'flip') => void;
    onResolveControlMechanicPrompt: (choice: 'player' | 'opponent' | 'skip') => void;
    onResolveCustomChoice: (optionIndex: number) => void;
    selectedCardId: string | null;
    multiSelectedCardIds: string[];
    actionRequiredClass: string;
}

export const PhaseController: React.FC<PhaseControllerProps> = ({
    gameState, onFillHand, onSkipAction,
    onResolvePlague2Discard, onResolvePlague4Flip, onResolveFire3Prompt, onResolveOptionalDiscardCustomPrompt,
    onResolveOptionalEffectPrompt,
    onResolveFire4Discard, onResolveHate1Discard, onResolveRevealBoardCardPrompt, onResolveOptionalDrawPrompt, onResolveDeath1Prompt,
    onResolveLove1Prompt, onResolvePsychic4Prompt, onResolveSpirit1Prompt,
    onResolveControlMechanicPrompt, onResolveCustomChoice,
    selectedCardId, multiSelectedCardIds, actionRequiredClass
}) => {
    const { phase, turn, actionRequired, player, compilableLanes } = gameState;

    const findCardById = (id: string): PlayedCard | null => {
        for (const p of ['player', 'opponent'] as const) {
            for (const lane of gameState[p].lanes) {
                const card = lane.find(c => c.id === id);
                if (card) return card;
            }
        }
        return null;
    };

    // FIX: Safely access sourceCardId as it's not present on all action types.
    const sourceCardId = actionRequired?.sourceCardId;
    const sourceCard = sourceCardId ? findCardById(sourceCardId) : null;
    // FIX: When an action is required, show the actor of that action, not the current turn
    // This fixes the UI showing "Opponent's Turn" when the player needs to act on their own card's effect
    const displayTurn = actionRequired?.actor || turn;
    const turnText = displayTurn.charAt(0).toUpperCase() + displayTurn.slice(1);

    const renderActions = () => {
        if (turn !== 'player' && (!actionRequired || actionRequired.actor !== 'player')) {
            return <button className="btn" disabled>Processing...</button>;
        }

        if (actionRequired?.type === 'prompt_use_control_mechanic') {
            return (
               <>
                   <button className="btn" onClick={() => onResolveControlMechanicPrompt('player')}>Rearrange Own</button>
                   <button className="btn" onClick={() => onResolveControlMechanicPrompt('opponent')}>Rearrange Opponent's</button>
                   <button className="btn btn-back" onClick={() => onResolveControlMechanicPrompt('skip')}>Skip</button>
               </>
           );
        }

        if (actionRequired?.type === 'prompt_optional_draw') {
            return (
               <>
                   <button className="btn" onClick={() => onResolveOptionalDrawPrompt(true)}>Draw</button>
                   <button className="btn btn-back" onClick={() => onResolveOptionalDrawPrompt(false)}>Skip</button>
               </>
           );
        }

        if (actionRequired?.type === 'prompt_death_1_effect') {
             return (
                <>
                    <button className="btn" onClick={() => onResolveDeath1Prompt(true)}>Draw & Delete</button>
                    <button className="btn btn-back" onClick={() => onResolveDeath1Prompt(false)}>Skip</button>
                </>
            );
        }

        if (actionRequired?.type === 'prompt_give_card_for_love_1') {
            return (
               <>
                   <button className="btn" onClick={() => onResolveLove1Prompt(true)}>Give 1 Card</button>
                   <button className="btn btn-back" onClick={() => onResolveLove1Prompt(false)}>Skip</button>
               </>
           );
       }

        if (actionRequired?.type === 'prompt_fire_3_discard') {
             return (
                <>
                    <button className="btn" onClick={() => onResolveFire3Prompt(true)}>Discard 1 Card</button>
                    <button className="btn btn-back" onClick={() => onResolveFire3Prompt(false)}>Skip</button>
                </>
            );
        }

        if (actionRequired?.type === 'prompt_optional_discard_custom') {
             return (
                <>
                    <button className="btn" onClick={() => onResolveOptionalDiscardCustomPrompt(true)}>Discard {actionRequired.count} Card(s)</button>
                    <button className="btn btn-back" onClick={() => onResolveOptionalDiscardCustomPrompt(false)}>Skip</button>
                </>
            );
        }

        if (actionRequired?.type === 'prompt_optional_effect') {
            const effectAction = (actionRequired as any).effectDef?.params?.action || 'effect';
            const effectCount = (actionRequired as any).effectDef?.params?.count;
            const actionLabel = effectCount ? `${effectAction} ${effectCount}` : effectAction;
             return (
                <>
                    <button className="btn" onClick={() => onResolveOptionalEffectPrompt(true)}>Execute ({actionLabel})</button>
                    <button className="btn btn-back" onClick={() => onResolveOptionalEffectPrompt(false)}>Skip</button>
                </>
            );
        }

        // REMOVED: prompt_shift_for_speed_3 - Speed-3 now uses custom protocol system

        if (actionRequired?.type === 'prompt_spirit_1_start') {
            return (
               <>
                   <button className="btn" onClick={() => onResolveSpirit1Prompt('discard')}>Discard 1</button>
                   <button className="btn btn-back" onClick={() => onResolveSpirit1Prompt('flip')}>Flip Card</button>
               </>
           );
        }

        // REMOVED: prompt_shift_for_spirit_3 - Spirit-3 now uses custom protocol system

        // NEW: Custom Choice effect (Spirit_custom-1: Either discard or flip)
        if (actionRequired?.type === 'custom_choice') {
            const options = (actionRequired as any).options || [];

            if (options.length === 2) {
                // Generate button labels from effect params
                const option1Params = options[0].params;
                const option2Params = options[1].params;

                const getButtonLabel = (params: any): string => {
                    if (params.action === 'discard') return `Discard ${params.count || 1}`;
                    if (params.action === 'flip' && params.flipSelf) return 'Flip This Card';
                    if (params.action === 'draw') return `Draw ${params.count || 1}`;
                    if (params.action === 'delete' && params.deleteSelf) return 'Delete This Card';
                    if (params.action === 'delete') return `Delete ${params.count || 1}`;
                    if (params.action === 'return') return `Return ${params.count || 1}`;
                    if (params.action === 'shift') return 'Shift';
                    return params.action || 'Option';
                };

                return (
                   <>
                       <button className="btn" onClick={() => onResolveCustomChoice(0)}>
                           {getButtonLabel(option1Params)}
                       </button>
                       <button className="btn btn-back" onClick={() => onResolveCustomChoice(1)}>
                           {getButtonLabel(option2Params)}
                       </button>
                   </>
               );
            }
        }

        if (actionRequired?.type === 'prompt_return_for_psychic_4') {
             return (
                <>
                    <button className="btn" onClick={() => onResolvePsychic4Prompt(true)}>Return Card</button>
                    <button className="btn btn-back" onClick={() => onResolvePsychic4Prompt(false)}>Skip</button>
                </>
            );
        }

        // REMOVED: prompt_shift_or_flip_for_light_2 - Light-2 now uses prompt_shift_or_flip_board_card_custom

        if (actionRequired?.type === 'prompt_shift_or_flip_board_card_custom') {
            return (
                <>
                    <button className="btn" onClick={() => onResolveRevealBoardCardPrompt('shift')}>Shift</button>
                    <button className="btn" onClick={() => onResolveRevealBoardCardPrompt('flip')}>Flip</button>
                    <button className="btn btn-back" onClick={() => onResolveRevealBoardCardPrompt('skip')}>Skip</button>
                </>
            );
        }

        // NEW: Handle variable-count discard for custom protocols (Fire_custom-4)
        if (actionRequired?.type === 'discard' && (actionRequired as any).variableCount && actionRequired.actor === 'player') {
            return (
                <button
                    className="btn"
                    onClick={() => onResolveFire4Discard(multiSelectedCardIds)}
                    disabled={multiSelectedCardIds.length < 1}
                >
                    Confirm Discard ({multiSelectedCardIds.length})
                </button>
            );
        }

        if (actionRequired?.type === 'plague_2_player_discard' || actionRequired?.type === 'select_cards_from_hand_to_discard_for_fire_4' || actionRequired?.type === 'select_cards_from_hand_to_discard_for_hate_1') {
            let handler;
            let requiredCount = 0;
            if (actionRequired.type === 'plague_2_player_discard') {
                handler = onResolvePlague2Discard;
                requiredCount = 1; // At least 1
            } else if (actionRequired.type === 'select_cards_from_hand_to_discard_for_fire_4') {
                handler = onResolveFire4Discard;
                requiredCount = 1; // At least 1
            } else { // Hate-1
                handler = onResolveHate1Discard;
                requiredCount = actionRequired.count;
            }

            return (
                <button
                    className="btn"
                    onClick={() => handler(multiSelectedCardIds)}
                    disabled={multiSelectedCardIds.length < requiredCount}
                >
                    Confirm Discard ({multiSelectedCardIds.length})
                </button>
            );
        }

        if (actionRequired?.type === 'plague_4_player_flip_optional') {
            return (
                <>
                    <button className="btn" onClick={() => onResolvePlague4Flip(true)}>Flip Plague-4</button>
                    <button className="btn btn-back" onClick={() => onResolvePlague4Flip(false)}>Skip</button>
                </>
            );
        }

        if (actionRequired && 'optional' in actionRequired && actionRequired.optional) {
             return <button className="btn btn-back" onClick={onSkipAction}>Skip Action</button>;
        }

        if (actionRequired) {
             return <button className="btn" disabled>Action Required</button>;
        }
        
        if (phase === 'compile' && compilableLanes.length > 0) {
            return <button className="btn" disabled>Select Lane to Compile</button>;
        }

        if (phase === 'action') {
            const canFillHand = player.hand.length < 5;
            const mustFillHand = player.hand.length === 0;

            if (mustFillHand) {
                 return <button className="btn" onClick={onFillHand}>Refresh (Required)</button>;
            }

            return (
                <button 
                    className="btn" 
                    onClick={onFillHand}
                    disabled={!canFillHand || !!selectedCardId}
                >
                    Refresh
                </button>
            );
        }

        return <button className="btn" disabled>Processing...</button>;
    }

    const getPhaseInfo = () => {
        if (actionRequired) {
            switch (actionRequired.type) {
                case 'discard':
                    if (actionRequired.actor === 'player') {
                        // NEW: Variable count discard (Fire_custom-4)
                        if ((actionRequired as any).variableCount) {
                            return 'Action: Select 1 or more cards to discard';
                        }
                        return `Action: Discard ${actionRequired.count} card(s) from your hand`;
                    } else {
                        return 'Waiting for Opponent to discard...';
                    }
                case 'prompt_use_control_mechanic':
                    return 'Control Action: Rearrange protocols?';
                case 'select_opponent_face_up_card_to_flip':
                    return 'Action: Select an opponent\'s face-up card to flip';
                case 'select_own_face_up_covered_card_to_flip':
                    return 'Action: Select one of your face-up, covered cards to flip';
                case 'select_opponent_covered_card_to_shift':
                    return 'Action: Select one of your opponent\'s covered cards to shift';
                case 'select_own_covered_card_to_shift':
                    return 'Action: Select one of your covered cards to shift';
                case 'select_lane_for_shift':
                    return 'Action: Select a new lane for the card';
                case 'select_lane_for_shift_all':
                    return 'Action: Select a lane to shift all cards to';
                case 'select_opponent_card_to_flip':
                    return 'Action: Select an opponent\'s card to flip';
                case 'select_card_to_flip': {
                    // Generic flip handler - generate descriptive text from targetFilter
                    const targetFilter = (actionRequired as any).targetFilter || {};
                    const owner = targetFilter.owner || 'any';
                    const faceState = targetFilter.faceState || 'any';
                    const position = targetFilter.position || 'uncovered';

                    let description = 'Action: Flip ';
                    if (owner === 'own') description += 'one of your ';
                    else if (owner === 'opponent') description += "an opponent's ";
                    else description += 'a ';

                    if (faceState === 'face_down') description += 'face-down ';
                    else if (faceState === 'face_up') description += 'face-up ';

                    if (position === 'covered') description += 'covered ';
                    else if (position === 'uncovered') description += 'uncovered ';

                    description += 'card';
                    return description;
                }
                case 'shift_flipped_card_optional':
                    return 'Action: You may shift the card you just flipped. Select a lane or skip.';
                case 'select_covered_card_in_line_to_flip_optional':
                    return 'Action: You may flip one of your covered cards in this lane. Select a card or skip.';
                case 'select_card_from_hand_to_play': {
                    const valueFilter = (actionRequired as any).valueFilter;
                    if (valueFilter !== undefined) {
                        return `Action: Select a card with value ${valueFilter} from your hand to play`;
                    }
                    return 'Action: Select a card from your hand to play';
                }
                case 'select_lane_for_play':
                    return 'Action: Select another lane to play your card in';
                case 'select_face_down_card_to_shift_for_darkness_4':
                    return 'Action: Select any face-down card to shift';
                case 'select_cards_to_delete':
                    return `Action: Select a card to delete (${actionRequired.count} remaining)`;
                case 'select_face_down_card_to_delete':
                    return 'Action: Select a face-down card to delete';
                case 'select_low_value_card_to_delete':
                    return 'Action: Select a card with value 0 or 1 to delete';
                case 'select_card_from_other_lanes_to_delete':
                    return `Action: Select a card to delete (${actionRequired.count} remaining)`;
                case 'select_lane_for_death_2':
                    return 'Action: Select a lane to delete cards with value 1 or 2';
                case 'select_lane_for_delete':
                    return 'Action: Select a lane';
                case 'prompt_optional_draw':
                    return 'Optional: Draw card(s)?';
                case 'prompt_death_1_effect':
                    return 'Start Phase: Use Death-1 effect?';
                case 'select_card_to_delete_for_death_1':
                    return 'Action: Select a card to delete';
                case 'delete_self':
                    return 'Deleting card...';
                case 'prompt_give_card_for_love_1':
                    return 'End Phase: Give 1 card to draw 2?';
                case 'select_card_from_hand_to_give':
                    return 'Action: Select a card from your hand to give';
                case 'select_card_from_hand_to_reveal':
                    return 'Action: Select a card from your hand to reveal';
                case 'plague_2_player_discard':
                    return 'Action: Select 1 or more cards to discard';
                case 'plague_4_opponent_delete':
                    return 'Waiting for opponent to delete one of their face-down cards';
                case 'plague_4_player_flip_optional':
                    return 'Action: You may flip Plague-4';
                case 'select_any_other_card_to_flip':
                    return 'Action: Select any other card to flip';
                case 'select_card_to_return': {
                    // Generic return handler - generate descriptive text from targetFilter
                    const targetFilter = (actionRequired as any).targetFilter || {};
                    const owner = (actionRequired as any).targetOwner || targetFilter.owner || 'any';
                    const position = targetFilter.position || 'uncovered';

                    let description = 'Action: Select ';
                    if (owner === 'own') description += 'one of your ';
                    else if (owner === 'opponent') description += "an opponent's ";
                    else description += 'a ';

                    if (position === 'any') description += 'covered or uncovered ';
                    else if (position === 'covered') description += 'covered ';

                    description += 'card to return';
                    return description;
                }
                case 'select_covered_card_to_flip_for_chaos_0':
                    return 'Action: Select a covered card to flip in this lane';
                case 'prompt_fire_3_discard':
                    return 'End Phase: Discard 1 card to flip 1 card?';
                case 'prompt_optional_discard_custom':
                    return `Optional: Discard ${actionRequired.count} card(s) to continue?`;
                case 'prompt_optional_effect': {
                    const effectAction = (actionRequired as any).effectDef?.params?.action || 'effect';
                    const effectCount = (actionRequired as any).effectDef?.params?.count;
                    return `Optional: Execute ${effectAction}${effectCount ? ` ${effectCount}` : ''}?`;
                }
                case 'select_card_to_flip_for_fire_3':
                    return 'Action: Select a card to flip';
                // REMOVED: prompt_shift_for_speed_3, select_own_card_to_shift_for_speed_3 - now uses custom protocol
                case 'select_own_other_card_to_shift':
                    return 'Action: Select one of your cards to shift';
                case 'select_opponent_face_down_card_to_shift':
                    return 'Action: Select an opponent\'s face-down card to shift';
                case 'prompt_spirit_1_start':
                    return 'Start Phase: Discard 1 card or flip Spirit-1?';
                case 'select_any_card_to_flip_optional':
                    return 'Action: You may flip one card. Select a card or skip.';
                // REMOVED: prompt_shift_for_spirit_3 - now uses custom protocol with after_draw trigger
                case 'prompt_swap_protocols':
                    return 'Action: Swap two protocols.';
                case 'select_cards_from_hand_to_discard_for_fire_4':
                    return 'Action: Select 1 or more cards to discard';
                case 'select_cards_from_hand_to_discard_for_hate_1':
                    return `Action: Select ${actionRequired.count} card(s) to discard for Hate-1`;
                case 'select_any_card_to_flip':
                    return `Action: Select a card to flip (${actionRequired.count} remaining)`;
                case 'select_any_face_down_card_to_flip_optional':
                    return 'Action: You may flip a face-down card. Select a card or skip.';
                case 'select_lane_for_life_3_play':
                    return 'Action: Select another lane to play a card into';
                case 'select_card_to_flip_for_light_0':
                    return 'Action: Select any card to flip';
                // REMOVED: select_face_down_card_to_reveal_for_light_2 and prompt_shift_or_flip_for_light_2
                // Light-2 now uses select_board_card_to_reveal_custom and prompt_shift_or_flip_board_card_custom
                case 'prompt_shift_or_flip_board_card_custom':
                    return 'Action: Choose to shift, flip, or skip';
                case 'select_board_card_to_reveal_custom':
                    return 'Action: Select a face-down card to reveal';
                case 'select_lane_to_shift_revealed_card_for_light_2':
                    return 'Action: Select a lane to shift the revealed card to';
                case 'select_lane_to_shift_revealed_board_card_custom':
                    return 'Action: Select a lane to shift the revealed card to';
                case 'select_lane_to_shift_cards_for_light_3':
                    return 'Action: Select a lane to shift all face-down cards to';
                case 'select_lane_for_metal_3_delete':
                    return 'Action: Select a lane with 8+ cards to delete';
                case 'select_lane_for_delete_all':
                    return 'Action: Select a lane to delete all cards';
                case 'select_any_other_card_to_flip_for_water_0':
                    return 'Action: Select any other card to flip';
                case 'prompt_rearrange_protocols':
                    return 'Action: Rearrange protocols';
                case 'select_lane_for_water_3':
                    return 'Action: Select a lane to return cards from';
                case 'select_own_card_to_return_for_water_4':
                    return 'Action: Select one of your cards to return to your hand';
                case 'prompt_return_for_psychic_4':
                    return 'End Phase: Return an opponent\'s card?';
                case 'select_any_opponent_card_to_shift':
                    return 'Action: Select an opponent\'s card to shift';
                case 'select_card_to_shift': {
                    // Generic shift handler - generate descriptive text from targetFilter
                    const targetFilter = (actionRequired as any).targetFilter || {};
                    const owner = targetFilter.owner || 'any';
                    const faceState = targetFilter.faceState || 'any';
                    const position = targetFilter.position || 'uncovered';

                    let description = 'Action: Select ';
                    if (owner === 'own') description += 'one of your ';
                    else if (owner === 'opponent') description += "an opponent's ";
                    else description += 'a ';

                    if (faceState === 'face_down') description += 'face-down ';
                    else if (faceState === 'face_up') description += 'face-up ';

                    if (position === 'covered') description += 'covered ';
                    else if (position === 'uncovered') description += 'uncovered ';

                    description += 'card to shift';
                    return description;
                }
                case 'select_opponent_card_to_return':
                    return 'Action: Select an opponent\'s card to return';
                case 'select_own_highest_card_to_delete_for_hate_2':
                    return 'Action: Select your highest value uncovered card to delete';
                case 'select_opponent_highest_card_to_delete_for_hate_2':
                    return 'Action: Select opponent\'s highest value uncovered card to delete';
                case 'custom_choice': {
                    // Generate descriptive text from choice options (Spirit_custom-1: "Either discard 1 card or flip this card.")
                    const options = (actionRequired as any).options || [];
                    if (options.length === 2) {
                        const opt1 = options[0].params;
                        const opt2 = options[1].params;

                        const getOptionText = (params: any): string => {
                            if (params.action === 'discard') return `you discard ${params.count || 1} card${params.count !== 1 ? 's' : ''}`;
                            if (params.action === 'flip' && params.flipSelf) return 'flip this card';
                            if (params.action === 'draw') return `draw ${params.count || 1} card${params.count !== 1 ? 's' : ''}`;
                            if (params.action === 'delete' && params.deleteSelf) return 'delete this card';
                            if (params.action === 'delete') return `delete ${params.count || 1} card${params.count !== 1 ? 's' : ''}`;
                            if (params.action === 'return') return `return ${params.count || 1} card${params.count !== 1 ? 's' : ''}`;
                            if (params.action === 'shift') return 'shift a card';
                            return params.action || 'option';
                        };

                        return `Either ${getOptionText(opt1)} or ${getOptionText(opt2)}.`;
                    }
                    return 'Action: Make a choice';
                }
                case 'select_card_from_revealed_deck': {
                    const valueFilter = (actionRequired as any).valueFilter;
                    return `Action: Select a card with value ${valueFilter} from your revealed deck`;
                }
                default:
                    return 'Action Required';
            }
        }

        if (phase === 'compile' && compilableLanes.length > 0) {
            return 'Phase: Compile';
        }
        return `Phase: ${phase.replace('_', ' ')}`;
    }

    return (
        <div className={`phase-controller ${actionRequiredClass}`}>
             <div className="effect-source-info">
                <span>{turnText}'s Turn</span>
                {actionRequired && sourceCard && (
                    <> | Effect from: <span>{sourceCard.protocol}-{sourceCard.value}</span></>
                )}
                {actionRequired?.sourceCardId === 'CONTROL_MECHANIC' && (
                    <> | Effect from: <span>Control Component</span></>
                )}
            </div>
            <div className="phase-controller-main">
                <div className="phase-info">
                    {getPhaseInfo()}
                </div>
                <div className="phase-actions">
                    {renderActions()}
                </div>
            </div>
        </div>
    );
};