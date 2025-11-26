/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PassiveRuleParams } from '../../../types/customProtocol';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

interface PassiveRuleEditorProps {
    params: PassiveRuleParams;
    onChange: (params: PassiveRuleParams) => void;
}

export const PassiveRuleEditor: React.FC<PassiveRuleEditorProps> = ({ params, onChange }) => {
    const ruleType = params.rule?.type || 'block_all_play';
    const target = params.rule?.target || 'opponent';
    const scope = params.rule?.scope || 'this_lane';

    return (
        <div className="param-editor passive-rule-editor">
            <h4>Passive Rule Parameters</h4>
            <p style={{ color: '#8A79E8', fontSize: '14px', marginBottom: '15px' }}>
                This rule is active while the card is face-up. It modifies game behavior.
            </p>

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
                        <option value="block_face_down_play">Block Face-Down Plays (Metal-2)</option>
                        <option value="block_face_up_play">Block Face-Up Plays</option>
                        <option value="block_all_play">Block All Plays (Plague-0)</option>
                        <option value="require_face_down_play">Require Face-Down Plays (Psychic-1)</option>
                    </optgroup>
                    <optgroup label="Protocol Matching">
                        <option value="allow_any_protocol_play">Allow Any Protocol (Spirit-1, Chaos-3)</option>
                        <option value="require_non_matching_protocol">Require Non-Matching (Anarchy-1)</option>
                    </optgroup>
                    <optgroup label="Action Blocks">
                        <option value="block_flips">Block Flips (Frost-1)</option>
                        <option value="block_protocol_rearrange">Block Protocol Rearrange (Frost-1)</option>
                        <option value="block_shifts_from_lane">Block Shifts From Lane (Frost-3)</option>
                        <option value="block_shifts_to_lane">Block Shifts To Lane (Frost-3)</option>
                    </optgroup>
                    <optgroup label="Effect Modifications">
                        <option value="ignore_middle_commands">Ignore Middle Commands (Apathy-2)</option>
                    </optgroup>
                    <optgroup label="Phase Modifications">
                        <option value="skip_check_cache_phase">Skip Check Cache Phase (Spirit-0)</option>
                    </optgroup>
                </select>
            </label>

            <label>
                Affected Player
                <select
                    value={target}
                    onChange={e => onChange({
                        ...params,
                        rule: { ...params.rule, type: ruleType, target: e.target.value as any, scope }
                    })}
                >
                    <option value="self">Self (You)</option>
                    <option value="opponent">Opponent</option>
                    <option value="all">All Players</option>
                </select>
            </label>

            <label>
                Scope
                <select
                    value={scope}
                    onChange={e => onChange({
                        ...params,
                        rule: { ...params.rule, type: ruleType, target, scope: e.target.value as any }
                    })}
                >
                    <option value="this_lane">This Lane Only</option>
                    <option value="global">Global (All Lanes)</option>
                </select>
            </label>

            <div className="effect-preview">
                <strong>Preview:</strong> {getEffectSummary({ id: 'preview', trigger: 'passive', position: 'top', params })}
            </div>
        </div>
    );
};

// Keeping for reference but using getEffectSummary from cardFactory instead
const _generatePassiveRuleText = (params: PassiveRuleParams): string => {
    const ruleType = params.rule?.type || 'block_all_play';
    const target = params.rule?.target || 'opponent';
    const scope = params.rule?.scope || 'this_lane';

    const targetText = target === 'self' ? 'You' : target === 'opponent' ? 'Your opponent' : 'All players';
    const scopeText = scope === 'this_lane' ? ' in this lane' : '';

    switch (ruleType) {
        case 'block_face_down_play':
            return `${targetText} cannot play cards face-down${scopeText}.`;
        case 'block_face_up_play':
            return `${targetText} cannot play cards face-up${scopeText}.`;
        case 'block_all_play':
            return `${targetText} cannot play cards${scopeText}.`;
        case 'require_face_down_play':
            return `${targetText} can only play cards face-down${scopeText}.`;
        case 'allow_any_protocol_play':
            return `${targetText} may play cards without matching protocols${scopeText}.`;
        case 'require_non_matching_protocol':
            return `${targetText} can only play cards without matching protocols${scopeText}.`;
        case 'block_flips':
            return `Cards cannot be flipped face-up${scopeText}.`;
        case 'block_protocol_rearrange':
            return `Protocols cannot be rearranged.`;
        case 'block_shifts_from_lane':
            return `Cards cannot shift from this lane.`;
        case 'block_shifts_to_lane':
            return `Cards cannot shift to this lane.`;
        case 'ignore_middle_commands':
            return `Ignore all middle commands of cards${scopeText}.`;
        case 'skip_check_cache_phase':
            return `Skip your check cache phase.`;
        default:
            return 'Passive rule active.';
    }
};
