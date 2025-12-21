/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PassiveRuleParams } from '../../../types/customProtocol';
import { CollapsibleSection } from './shared';

interface PassiveRuleEditorProps {
    params: PassiveRuleParams;
    onChange: (params: PassiveRuleParams) => void;
}

export const PassiveRuleEditor: React.FC<PassiveRuleEditorProps> = ({ params, onChange }) => {
    const ruleType = params.rule?.type || 'block_all_play';
    const target = params.rule?.target || 'opponent';
    const scope = params.rule?.scope || 'this_lane';
    const onlyDuringYourTurn = params.rule?.onlyDuringYourTurn || false;
    const conditionTarget = (params.rule as any)?.conditionTarget || 'self';
    const blockTarget = (params.rule as any)?.blockTarget || 'self';

    const hasDrawBlockConfig = ruleType === 'block_draw_conditional';
    const hasMiddleCommandConfig = ruleType === 'ignore_middle_commands' && onlyDuringYourTurn;

    return (
        <div className="param-editor passive-rule-editor">
            <h4>Passive Rule</h4>
            <small className="hint-text">Active while card is face-up. Modifies game behavior.</small>

            {/* Basic Options */}
            <div className="effect-editor-basic">
                <label>
                    Rule Type
                    <select
                        value={ruleType}
                        onChange={e => onChange({
                            ...params,
                            rule: { ...params.rule, type: e.target.value as any, target, scope }
                        })}
                    >
                        <optgroup label="Play Restrictions">
                            <option value="block_face_down_play">Block Face-Down</option>
                            <option value="block_face_up_play">Block Face-Up</option>
                            <option value="block_all_play">Block All</option>
                            <option value="require_face_down_play">Require Face-Down</option>
                        </optgroup>
                        <optgroup label="Protocol Matching">
                            <option value="allow_any_protocol_play">Allow Any Protocol</option>
                            <option value="allow_play_on_opponent_side">Allow Opponent Side</option>
                            <option value="allow_same_protocol_face_up_play">Same Protocol Face-Up</option>
                            <option value="require_non_matching_protocol">Non-Matching Only</option>
                        </optgroup>
                        <optgroup label="Action Blocks">
                            <option value="block_flips">Block Flips</option>
                            <option value="block_protocol_rearrange">Block Rearrange</option>
                            <option value="block_shifts_from_lane">Block Shift From</option>
                            <option value="block_shifts_to_lane">Block Shift To</option>
                            <option value="block_flip_this_card">Can't Flip This Card</option>
                        </optgroup>
                        <optgroup label="Other">
                            <option value="block_draw_conditional">Conditional Draw Block</option>
                            <option value="ignore_middle_commands">Ignore Middle Commands</option>
                            <option value="skip_check_cache_phase">Skip Check Cache</option>
                        </optgroup>
                    </select>
                </label>

                <label>
                    Target
                    <select
                        value={target}
                        onChange={e => onChange({
                            ...params,
                            rule: { ...params.rule, type: ruleType, target: e.target.value as any, scope }
                        })}
                    >
                        <option value="self">Self</option>
                        <option value="opponent">Opponent</option>
                        <option value="all">All</option>
                    </select>
                </label>

                <label>
                    Scope
                    <select
                        value={scope}
                        onChange={e => onChange({
                            ...params,
                            rule: { ...params.rule, type: ruleType, target, scope: e.target.value as any, onlyDuringYourTurn }
                        })}
                    >
                        <option value="this_lane">This Lane</option>
                        <option value="global">Global</option>
                    </select>
                </label>
            </div>

            {/* Conditional Draw Block Options */}
            {ruleType === 'block_draw_conditional' && (
                <CollapsibleSection title="Draw Block Settings" forceOpen={hasDrawBlockConfig}>
                    <div className="filter-row">
                        <label>
                            Condition (who must have cards)
                            <select
                                value={conditionTarget}
                                onChange={e => onChange({
                                    ...params,
                                    rule: { ...params.rule, type: ruleType, target: 'this_card', scope: 'global', conditionTarget: e.target.value, blockTarget } as any
                                })}
                            >
                                <option value="self">Card owner</option>
                                <option value="opponent">Opponent</option>
                            </select>
                        </label>

                        <label>
                            Block Target (who can't draw)
                            <select
                                value={blockTarget}
                                onChange={e => onChange({
                                    ...params,
                                    rule: { ...params.rule, type: ruleType, target: 'this_card', scope: 'global', conditionTarget, blockTarget: e.target.value } as any
                                })}
                            >
                                <option value="self">Card owner</option>
                                <option value="opponent">Opponent</option>
                                <option value="all">Both</option>
                            </select>
                        </label>
                    </div>
                </CollapsibleSection>
            )}

            {/* Ignore Middle Commands Option */}
            {ruleType === 'ignore_middle_commands' && (
                <CollapsibleSection title="Timing" forceOpen={hasMiddleCommandConfig}>
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={onlyDuringYourTurn}
                            onChange={e => onChange({
                                ...params,
                                rule: { ...params.rule, type: ruleType, target, scope, onlyDuringYourTurn: e.target.checked }
                            })}
                        />
                        Only during your turn
                    </label>
                </CollapsibleSection>
            )}
        </div>
    );
};
