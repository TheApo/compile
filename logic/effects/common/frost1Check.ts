/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GameState } from "../../../types";
import { getActivePassiveRules } from "../../game/passiveRuleChecker";

/**
 * GENERIC: Checks if any card has an active "block_flips" passive rule.
 * This replaces hardcoded Frost-1 checks with generic passive rule logic.
 * Works for ANY custom protocol with block_flips rule (e.g., Frost-1, Frost_custom-1, future cards).
 *
 * @returns true if any face-up card has an active block_flips rule
 */
export const isFrost1Active = (state: GameState): boolean => {
    const rules = getActivePassiveRules(state);
    return rules.some(({ rule }) => rule.type === 'block_flips');
};

/**
 * GENERIC: Checks if any card has an active "block_protocol_rearrange" passive rule.
 * This replaces hardcoded Frost-1 bottom checks with generic passive rule logic.
 * Works for ANY custom protocol with block_protocol_rearrange rule (e.g., Frost-1, Frost_custom-1, future cards).
 *
 * @returns true if any uncovered face-up card has an active block_protocol_rearrange rule
 */
export const isFrost1BottomActive = (state: GameState): boolean => {
    const rules = getActivePassiveRules(state);
    return rules.some(({ rule }) => rule.type === 'block_protocol_rearrange');
};
