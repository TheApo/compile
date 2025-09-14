/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, Player } from '../../types';

export const log = (state: GameState, player: Player, message: string): GameState => {
    return { ...state, log: [...state.log, { player, message }] };
};
