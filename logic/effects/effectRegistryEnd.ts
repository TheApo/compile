/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../types";
import { execute as chaos4end } from './chaos/Chaos-4-end';
import { execute as plague4 } from './plague/Plague-4';
import { execute as light1 } from './light/Light-1-end';
import { execute as fire3 } from './fire/Fire-3-end';
import { execute as speed3 } from './speed/Speed-3-end';
import { execute as love1 } from './love/Love-1-end';
import { execute as psychic4 } from './psychic/Psychic-4-end';


type EndEffectExecutor = (card: PlayedCard, state: GameState, context: EffectContext) => EffectResult;

export const effectRegistryEnd: Record<string, EndEffectExecutor> = {
    'Chaos-4': chaos4end,
    'Plague-4': plague4,
    'Light-1': light1,
    'Fire-3': fire3,
    'Speed-3': speed3,
    'Love-1': love1,
    'Psychic-4': psychic4,
};
