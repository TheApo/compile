/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState, PlayedCard, EffectResult, EffectContext } from "../../types";
import { drawForPlayer } from "../../utils/gameStateModifiers";
import { log } from "../utils/log";
import { execute as apathy1 } from './apathy/Apathy-1';
import { execute as apathy3 } from './apathy/Apathy-3';
import { execute as apathy4 } from './apathy/Apathy-4';
import { execute as discardOne } from './common/discard-one';
import { execute as chaos0 } from './chaos/Chaos-0';
import { execute as chaos1 } from './chaos/Chaos-1';
import { execute as chaos2 } from './chaos/Chaos-2';
import { execute as chaos5 } from './chaos/Chaos-5';
import { execute as darkness0 } from "./darkness/Darkness-0";
import { execute as darkness1 } from "./darkness/Darkness-1";
import { execute as darkness2 } from "./darkness/Darkness-2";
import { execute as darkness3 } from "./darkness/Darkness-3";
import { execute as darkness4 } from "./darkness/Darkness-4";
import { execute as life0 } from "./life/Life-0";
import { execute as life1 } from "./life/Life-1";
import { execute as life2 } from "./life/Life-2";
import { execute as life4 } from "./life/Life-4";
import { execute as love1 } from "./love/Love-1";
import { execute as love2 } from "./love/Love-2";
import { execute as love3 } from "./love/Love-3";
import { execute as love4 } from "./love/Love-4";
import { execute as love6 } from "./love/Love-6";
import { execute as metal0 } from './metal/Metal-0';
import { execute as metal1 } from "./metal/Metal-1";
import { execute as metal3 } from './metal/Metal-3';
import { execute as plague0 } from "./plague/Plague-0";
import { execute as plague1 } from "./plague/Plague-1";
import { execute as plague2 } from "./plague/Plague-2";
import { execute as plague3 } from "./plague/Plague-3";
import { execute as psychic0 } from "./psychic/Psychic-0";
import { execute as psychic2 } from "./psychic/Psychic-2";
import { execute as psychic3 } from "./psychic/Psychic-3";
import { execute as speed0 } from "./speed/Speed-0";
import { execute as speed1 } from "./speed/Speed-1";
import { execute as speed3 } from "./speed/Speed-3";
import { execute as speed4 } from "./speed/Speed-4";
import { execute as spirit0 } from "./spirit/Spirit-0";
import { execute as spirit1 } from "./spirit/Spirit-1";
import { execute as spirit2 } from "./spirit/Spirit-2";
import { execute as spirit4 } from "./spirit/Spirit-4";
import { execute as hate0 } from "./hate/Hate-0";
import { execute as hate1 } from "./hate/Hate-1";
import { execute as hate2 } from "./hate/Hate-2";
import { execute as death0 } from "./death/Death-0";
import { execute as death2 } from "./death/Death-2";
import { execute as death3 } from "./death/Death-3";
import { execute as death4 } from "./death/Death-4";
import { execute as fire0 } from "./fire/Fire-0";
import { execute as fire1 } from "./fire/Fire-1";
import { execute as fire2 } from "./fire/Fire-2";
import { execute as fire4 } from "./fire/Fire-4";
import { execute as gravity0 } from './gravity/Gravity-0';
import { execute as gravity1 } from './gravity/Gravity-1';
import { execute as gravity2 } from './gravity/Gravity-2';
import { execute as gravity4 } from './gravity/Gravity-4';
import { execute as gravity6 } from './gravity/Gravity-6';
import { execute as light0 } from './light/Light-0';
import { execute as light2 } from './light/Light-2';
import { execute as light3 } from './light/Light-3';
import { execute as light4 } from './light/Light-4';
import { execute as water0 } from './water/Water-0';
import { execute as water1 } from './water/Water-1';
import { execute as water2 } from './water/Water-2';
import { execute as water3 } from './water/Water-3';
import { execute as water4 } from './water/Water-4';
import { execute as anarchy0 } from './anarchy/Anarchy-0';
import { execute as anarchy1 } from './anarchy/Anarchy-1';
import { execute as anarchy2 } from './anarchy/Anarchy-2';
import { execute as anarchy3 } from './anarchy/Anarchy-3';
import { execute as frost0 } from './frost/Frost-0';
import { execute as frost2 } from './frost/Frost-2';
import { execute as frost4 } from './frost/Frost-4';

type EffectExecutor = (card: PlayedCard, laneIndex: number, state: GameState, context: EffectContext) => EffectResult;

export const effectRegistry: Record<string, EffectExecutor> = {
    'Anarchy-0': anarchy0,
    'Anarchy-1': anarchy1,
    'Anarchy-2': anarchy2,
    'Anarchy-3': anarchy3,
    'Anarchy-5': discardOne,
    'Apathy-1': apathy1,
    'Apathy-3': apathy3,
    'Apathy-4': apathy4,
    'Apathy-5': discardOne,
    'Chaos-0': chaos0,
    'Chaos-1': chaos1,
    'Chaos-2': chaos2,
    'Chaos-5': chaos5,
    'Darkness-0': darkness0,
    'Darkness-1': darkness1,
    'Darkness-2': darkness2,
    'Darkness-3': darkness3,
    'Darkness-4': darkness4,
    'Darkness-5': discardOne,
    'Death-0': death0,
    'Death-2': death2,
    'Death-3': death3,
    'Death-4': death4,
    'Death-5': discardOne,
    'Fire-0': fire0,
    'Fire-1': fire1,
    'Fire-2': fire2,
    'Fire-4': fire4,
    'Fire-5': discardOne,
    'Gravity-0': gravity0,
    'Gravity-1': gravity1,
    'Gravity-2': gravity2,
    'Gravity-4': gravity4,
    'Gravity-5': discardOne,
    'Gravity-6': gravity6,
    'Hate-0': hate0,
    'Hate-1': hate1,
    'Hate-2': hate2,
    'Hate-5': discardOne,
    'Life-0': life0,
    'Life-1': life1,
    'Life-2': life2,
    'Life-4': life4,
    'Life-5': discardOne,
    'Light-0': light0,
    'Light-2': light2,
    'Light-3': light3,
    'Light-4': light4,
    'Light-5': discardOne,
    'Love-1': love1,
    'Love-2': love2,
    'Love-3': love3,
    'Love-4': love4,
    'Love-5': discardOne,
    'Love-6': love6,
    'Metal-0': metal0,
    'Metal-1': metal1,
    'Metal-3': metal3,
    'Metal-5': discardOne,
    'Plague-0': plague0,
    'Plague-1': plague1,
    'Plague-2': plague2,
    'Plague-3': plague3,
    'Plague-5': discardOne,
    'Psychic-0': psychic0,
    'Psychic-2': psychic2,
    'Psychic-3': psychic3,
    'Psychic-5': discardOne,
    'Speed-0': speed0,
    'Speed-1': speed1,
    'Speed-3': speed3,
    'Speed-4': speed4,
    'Speed-5': discardOne,
    'Spirit-0': spirit0,
    'Spirit-1': spirit1,
    'Spirit-2': spirit2,
    'Spirit-4': spirit4,
    'Spirit-5': discardOne,
    'Water-0': water0,
    'Water-1': water1,
    'Water-2': water2,
    'Water-3': water3,
    'Water-4': water4,
    'Water-5': discardOne,
    'Frost-0': frost0,
    'Frost-2': frost2,
    'Frost-4': frost4,
    'Frost-5': discardOne,
};