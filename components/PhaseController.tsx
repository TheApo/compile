/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GameState, PlayedCard } from '../types';

interface PhaseControllerProps {
    gameState: GameState;
    onFillHand: () => void;
    onSkipAction: () => void;
    onResolvePlague2Discard: (cardIds: string[]) => void;
    onResolvePlague4Flip: (accept: boolean) => void;
    onResolveFire3Prompt: (accept: boolean) => void;
    onResolveSpeed3Prompt: (accept: boolean) => void;
    onResolveFire4Discard: (cardIds: string[]) => void;
    onResolveHate1Discard: (cardIds: string[]) => void;
    onResolveLight2Prompt: (choice: 'shift' | 'flip' | 'skip') => void;
    onResolveDeath1Prompt: (accept: boolean) => void;
    onResolveLove1Prompt: (accept: boolean) => void;
    onResolvePsychic4Prompt: (accept: boolean) => void;
    onResolveSpirit1Prompt: (choice: 'discard' | 'flip') => void;
    onResolveSpirit3Prompt: (accept: boolean) => void;
    selectedCardId: string | null;
    multiSelectedCardIds: string[];
    actionRequiredClass: string;
}

export const PhaseController: React.FC<PhaseControllerProps> = ({ 
    gameState, onFillHand, onSkipAction, 
    onResolvePlague2Discard, onResolvePlague4Flip, onResolveFire3Prompt,
    onResolveSpeed3Prompt,
    onResolveFire4Discard, onResolveHate1Discard, onResolveLight2Prompt, onResolveDeath1Prompt,
    onResolveLove1Prompt, onResolvePsychic4Prompt, onResolveSpirit1Prompt, onResolveSpirit3Prompt,
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

    const sourceCardId = actionRequired?.sourceCardId;
    const sourceCard = sourceCardId ? findCardById(sourceCardId) : null;
    const turnText = turn.charAt(0).toUpperCase() + turn.slice(1);

    const renderActions = () => {
        if (turn !== 'player') {
            return <button className="btn" disabled>Processing...</button>;
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
        
        if (actionRequired?.type === 'prompt_shift_for_speed_3') {
             return (
                <>
                    <button className="btn" onClick={() => onResolveSpeed3Prompt(true)}>Shift</button>
                    <button className="btn btn-back" onClick={() => onResolveSpeed3Prompt(false)}>Skip</button>
                </>
            );
        }

        if (actionRequired?.type === 'prompt_spirit_1_start') {
            return (
               <>
                   <button className="btn" onClick={() => onResolveSpirit1Prompt('discard')}>Discard 1</button>
                   <button className="btn btn-back" onClick={() => onResolveSpirit1Prompt('flip')}>Flip Card</button>
               </>
           );
        }

        if (actionRequired?.type === 'prompt_shift_for_spirit_3') {
            return (
               <>
                   <button className="btn" onClick={() => onResolveSpirit3Prompt(true)}>Shift</button>
                   <button className="btn btn-back" onClick={() => onResolveSpirit3Prompt(false)}>Skip</button>
               </>
           );
        }
        
        if (actionRequired?.type === 'prompt_return_for_psychic_4') {
             return (
                <>
                    <button className="btn" onClick={() => onResolvePsychic4Prompt(true)}>Return Card</button>
                    <button className="btn btn-back" onClick={() => onResolvePsychic4Prompt(false)}>Skip</button>
                </>
            );
        }

        if (actionRequired?.type === 'prompt_shift_or_flip_for_light_2') {
            return (
                <>
                    <button className="btn" onClick={() => onResolveLight2Prompt('shift')}>Shift</button>
                    <button className="btn" onClick={() => onResolveLight2Prompt('flip')}>Flip Back</button>
                    <button className="btn btn-back" onClick={() => onResolveLight2Prompt('skip')}>Skip</button>
                </>
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
                 return <button className="btn" onClick={onFillHand}>Fill Hand (Required)</button>;
            }

            return (
                <button 
                    className="btn" 
                    onClick={onFillHand}
                    disabled={!canFillHand || !!selectedCardId}
                >
                    Fill Hand
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
                        return `Action: Discard ${actionRequired.count} card(s) from your hand`;
                    } else {
                        return 'Waiting for Opponent to discard...';
                    }
                case 'select_opponent_face_up_card_to_flip':
                    return 'Action: Select an opponent\'s face-up card to flip';
                case 'select_own_face_up_covered_card_to_flip':
                    return 'Action: Select one of your face-up, covered cards to flip';
                case 'select_opponent_covered_card_to_shift':
                    return 'Action: Select one of your opponent\'s covered cards to shift';
                case 'select_lane_for_shift':
                    return 'Action: Select a new lane for the card';
                case 'select_opponent_card_to_flip':
                    return 'Action: Select an opponent\'s card to flip';
                case 'shift_flipped_card_optional':
                    return 'Action: You may shift the card you just flipped. Select a lane or skip.';
                case 'select_covered_card_in_line_to_flip_optional':
                    return 'Action: You may flip one of your covered cards in this lane. Select a card or skip.';
                case 'select_card_from_hand_to_play':
                    return 'Action: Select a card from your hand to play';
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
                case 'prompt_death_1_effect':
                    return 'Start Phase: Use Death-1 effect?';
                case 'select_card_to_delete_for_death_1':
                    return 'Action: Select a card to delete';
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
                case 'select_card_to_return':
                    return 'Action: Select a card to return to its owner\'s hand';
                case 'prompt_fire_3_discard':
                    return 'End Phase: Discard 1 card to flip 1 card?';
                case 'select_card_to_flip_for_fire_3':
                    return 'Action: Select a card to flip';
                case 'prompt_shift_for_speed_3':
                    return 'End Phase: Shift 1 card?';
                case 'select_own_card_to_shift_for_speed_3':
                case 'select_own_other_card_to_shift':
                    return 'Action: Select one of your cards to shift';
                case 'select_opponent_face_down_card_to_shift':
                    return 'Action: Select an opponent\'s face-down card to shift';
                case 'prompt_spirit_1_start':
                    return 'Start Phase: Discard 1 card or flip Spirit-1?';
                case 'select_any_card_to_flip_optional':
                    return 'Action: You may flip one card. Select a card or skip.';
                case 'prompt_shift_for_spirit_3':
                    return 'Triggered: You may shift your Spirit-3. Select a lane or skip.';
                case 'prompt_swap_protocols':
                    return 'Action: Swap two of your protocols.';
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
                case 'select_face_down_card_to_reveal_for_light_2':
                    return 'Action: Select a face-down card to reveal';
                case 'prompt_shift_or_flip_for_light_2':
                    return 'Action: Choose to shift, flip back, or skip';
                case 'select_lane_to_shift_revealed_card_for_light_2':
                    return 'Action: Select a lane to shift the revealed card to';
                case 'select_lane_to_shift_cards_for_light_3':
                    return 'Action: Select a lane to shift all face-down cards to';
                case 'select_lane_for_metal_3_delete':
                    return 'Action: Select a lane with 8+ cards to delete';
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
                case 'select_opponent_card_to_return':
                    return 'Action: Select an opponent\'s card to return';
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