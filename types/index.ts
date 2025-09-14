/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { Card } from "../data/cards";

export type Player = 'player' | 'opponent';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface PlayedCard extends Card {
    id: string;
    isFaceUp: boolean;
    isRevealed?: boolean;
}

export interface PlayerState {
    protocols: string[];
    deck: Card[];
    hand: PlayedCard[];
    lanes: PlayedCard[][];
    discard: Card[];
    compiled: boolean[];
    laneValues: number[];
    cannotCompile: boolean;
}

export type GamePhase = 'start' | 'control' | 'compile' | 'action' | 'hand_limit' | 'end';

export type ActionRequired = {
    type: 'discard';
    player: Player;
    count: number;
    sourceCardId?: string;
    sourceEffect?: 'fire_1' | 'fire_2' | 'fire_3' | 'spirit_1_start';
} | {
    type: 'select_opponent_face_up_card_to_flip';
    count: number;
    sourceCardId: string;
} | {
    type: 'select_own_face_up_covered_card_to_flip';
    count: number;
    optional: true;
    sourceCardId: string;
} | {
    type: 'select_opponent_covered_card_to_shift';
    sourceCardId: string;
} | {
    type: 'select_lane_for_shift';
    cardToShiftId: string;
    cardOwner: Player;
    originalLaneIndex: number;
    sourceCardId: string;
    actor: Player;
    sourceEffect?: 'speed_3_end';
} | {
    type: 'select_opponent_card_to_flip';
    sourceCardId: string;
} | {
    type: 'shift_flipped_card_optional';
    cardId: string;
    sourceCardId: string;
    optional: true;
} | {
    type: 'select_own_covered_card_in_lane_to_flip';
    laneIndex: number;
    sourceCardId:string;
    optional: true;
} | {
    type: 'select_card_from_hand_to_play';
    disallowedLaneIndex: number;
    sourceCardId: string;
    isFaceDown?: boolean;
} | {
    type: 'select_lane_for_play';
    cardInHandId: string;
    disallowedLaneIndex: number;
    sourceCardId: string;
    isFaceDown?: boolean;
} | {
    type: 'select_face_down_card_to_shift_for_darkness_4';
    sourceCardId: string;
} | {
    type: 'select_cards_to_delete';
    count: number;
    sourceCardId: string;
    disallowedIds: string[];
} | {
    type: 'select_face_down_card_to_delete';
    sourceCardId: string;
} | {
    type: 'select_low_value_card_to_delete';
    sourceCardId: string;
} | {
    type: 'select_card_from_other_lanes_to_delete';
    sourceCardId: string;
    disallowedLaneIndex: number;
    lanesSelected: number[];
    count: number;
} | {
    type: 'select_lane_for_death_2';
    sourceCardId: string;
} | {
    type: 'prompt_death_1_effect';
    sourceCardId: string;
    optional: true;
} | {
    type: 'select_card_to_delete_for_death_1';
    sourceCardId: string;
} | {
    type: 'prompt_give_card_for_love_1';
    sourceCardId: string;
    optional: true;
} | {
    type: 'select_card_from_hand_to_give';
    sourceCardId: string;
    sourceEffect: 'love_1_end' | 'love_3';
} | {
    type: 'select_card_from_hand_to_reveal';
    sourceCardId: string;
} | {
    type: 'plague_2_player_discard';
    sourceCardId: string;
} | {
    type: 'plague_2_opponent_discard';
    sourceCardId: string;
} | {
    type: 'plague_4_opponent_delete';
    sourceCardId: string;
} | {
    type: 'plague_4_player_flip_optional';
    sourceCardId: string;
    optional: true;
} | {
    type: 'select_any_other_card_to_flip';
    sourceCardId: string;
    draws: number;
} | {
    type: 'select_card_to_return';
    sourceCardId: string;
} | {
    type: 'prompt_fire_3_discard';
    sourceCardId: string;
    optional: true;
} | {
    type: 'select_card_to_flip_for_fire_3';
    sourceCardId: string;
} | {
    type: 'select_cards_from_hand_to_discard_for_fire_4';
    sourceCardId: string;
} | {
    type: 'select_cards_from_hand_to_discard_for_hate_1';
    sourceCardId: string;
    count: number;
} | {
    type: 'select_card_to_shift_for_gravity_1';
    sourceCardId: string;
    sourceLaneIndex: number;
} | {
    type: 'select_card_to_flip_and_shift_for_gravity_2';
    sourceCardId: string;
    targetLaneIndex: number;
} | {
    type: 'select_face_down_card_to_shift_for_gravity_4';
    sourceCardId: string;
    targetLaneIndex: number;
} | {
    type: 'select_any_card_to_flip';
    count: number;
    sourceCardId: string;
} | {
    type: 'select_any_face_down_card_to_flip_optional';
    sourceCardId: string;
    optional: true;
} | {
    type: 'select_any_card_to_flip_optional';
    sourceCardId: string;
    optional: true;
} | {
    type: 'prompt_spirit_1_start';
    sourceCardId: string;
} | {
    type: 'prompt_shift_for_spirit_3';
    sourceCardId: string;
    optional: true;
} | {
    type: 'prompt_swap_protocols';
    sourceCardId: string;
} | {
    type: 'select_lane_for_life_3_play';
    sourceCardId: string;
    disallowedLaneIndex: number;
} | {
    type: 'select_card_to_flip_for_light_0';
    sourceCardId: string;
} | {
    type: 'select_face_down_card_to_reveal_for_light_2';
    sourceCardId: string;
} | {
    type: 'prompt_shift_or_flip_for_light_2';
    sourceCardId: string;
    revealedCardId: string;
    optional: true;
} | {
    type: 'select_lane_to_shift_revealed_card_for_light_2';
    sourceCardId: string;
    revealedCardId: string;
} | {
    type: 'select_lane_to_shift_cards_for_light_3';
    sourceCardId: string;
    sourceLaneIndex: number;
} | {
    type: 'select_lane_for_metal_3_delete';
    sourceCardId: string;
    disallowedLaneIndex: number;
} | {
    type: 'select_any_other_card_to_flip_for_water_0';
    sourceCardId: string;
} | {
    type: 'prompt_rearrange_protocols';
    sourceCardId: string;
    target: Player;
} | {
    type: 'select_lane_for_water_3';
    sourceCardId: string;
} | {
    type: 'select_own_card_to_return_for_water_4';
    sourceCardId: string;
} | {
    type: 'select_own_other_card_to_shift';
    sourceCardId: string;
} | {
    type: 'prompt_shift_for_speed_3';
    sourceCardId: string;
    optional: true;
} | {
    type: 'select_own_card_to_shift_for_speed_3';
    sourceCardId: string;
} | {
    type: 'select_opponent_face_down_card_to_shift';
    sourceCardId: string;
} | {
    type: 'reveal_opponent_hand';
    sourceCardId: string;
} | {
    type: 'select_any_opponent_card_to_shift';
    sourceCardId: string;
} | {
    type: 'prompt_return_for_psychic_4';
    sourceCardId: string;
    optional: true;
} | {
    type: 'select_opponent_card_to_return';
    sourceCardId: string;
} | null;

export type AnimationState = 
    | { type: 'playCard', cardId: string; owner: Player } 
    | { type: 'compile', laneIndex: number }
    | { type: 'flipCard', cardId: string }
    | { type: 'deleteCard', cardId: string, owner: Player }
    | { type: 'drawCard', owner: Player, cardIds: string[] }
    | { type: 'discardCard', owner: Player, cardIds: string[], originalAction?: ActionRequired }
    | null;

export interface LogEntry {
    player: Player;
    message: string;
}

export interface GameState {
    player: PlayerState;
    opponent: PlayerState;
    turn: Player;
    phase: GamePhase;
    controlCardHolder: Player | null;
    winner: Player | null;
    log: LogEntry[];
    actionRequired: ActionRequired;
    queuedActions: ActionRequired[];
    queuedEffect?: { card: PlayedCard; laneIndex: number };
    animationState: AnimationState;
    compilableLanes: number[];
    processedStartEffectIds?: string[];
    processedEndEffectIds?: string[];
    lastPlayedCardId?: string;
    _interruptedTurn?: Player;
}

export type AIAction = 
    | { type: 'playCard'; cardId: string; laneIndex: number; isFaceUp: boolean; }
    | { type: 'fillHand'; }
    | { type: 'discardCards'; cardIds: string[]; }
    | { type: 'compile', laneIndex: number; }
    | { type: 'deleteCard', cardId: string }
    | { type: 'flipCard', cardId: string }
    | { type: 'returnCard', cardId: string }
    | { type: 'selectLane', laneIndex: number }
    | { type: 'skip' }
    | { type: 'resolveDeath1Prompt', accept: boolean }
    | { type: 'resolveLove1Prompt', accept: boolean }
    | { type: 'giveCard', cardId: string }
    | { type: 'revealCard', cardId: string }
    | { type: 'resolvePlague2Discard', cardIds: string[] }
    | { type: 'resolvePlague4Flip', accept: boolean }
    | { type: 'resolveFire3Prompt', accept: boolean }
    | { type: 'resolveFire4Discard', cardIds: string[] }
    | { type: 'resolveHate1Discard', cardIds: string[] }
    | { type: 'resolveLight2Prompt', choice: 'shift' | 'flip' | 'skip' }
    | { type: 'rearrangeProtocols', newOrder: string[] }
    | { type: 'resolveSpirit1Prompt', choice: 'discard' | 'flip' }
    | { type: 'resolveSpirit3Prompt', accept: boolean }
    | { type: 'resolveSwapProtocols', indices: [number, number] }
    | { type: 'resolveSpeed3Prompt', accept: boolean }
    | { type: 'resolvePsychic4Prompt', accept: boolean };


export type AnimationRequest = {
    type: 'delete';
    cardId: string;
    owner: Player;
};

export type EffectResult = {
    newState: GameState;
    animationRequests?: AnimationRequest[];
};
