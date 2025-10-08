/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../types";
import { execute as death1 } from './death/Death-1';
import { execute as psychic1 } from './psychic/Psychic-1-start';
import { execute as spirit1start } from './spirit/Spirit-1-start';


type StartEffectExecutor = (card: PlayedCard, state: GameState, context: EffectContext) => EffectResult;

export const effectRegistryStart: Record<string, StartEffectExecutor> = {
    'Death-1': death1,
    'Psychic-1': psychic1,
    'Spirit-1': spirit1start,
};