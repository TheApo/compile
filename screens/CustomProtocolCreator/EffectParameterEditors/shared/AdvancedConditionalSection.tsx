/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CollapsibleSection } from './CollapsibleSection';

export interface AdvancedConditional {
    type?: 'none' | 'empty_hand' | 'opponent_higher_value_in_lane' | 'this_card_is_covered' |
           'protocol_match' | 'hand_size_greater_than' | 'same_protocol_on_field' |
           'compile_block' | 'trash_not_empty';
    protocol?: string;
    threshold?: number;
    turnDuration?: number;
}

interface AdvancedConditionalSectionProps {
    conditional: AdvancedConditional | undefined;
    onChange: (conditional: AdvancedConditional | undefined) => void;
    /** Which conditional types to show */
    availableTypes?: Array<AdvancedConditional['type']>;
    /** Show protocol input for protocol_match */
    showProtocolInput?: boolean;
    /** Show threshold input for hand_size_greater_than */
    showThresholdInput?: boolean;
    /** Show turnDuration for compile_block */
    showTurnDuration?: boolean;
}

const DEFAULT_TYPES: Array<AdvancedConditional['type']> = [
    'none',
    'empty_hand',
    'opponent_higher_value_in_lane',
    'this_card_is_covered'
];

const TYPE_LABELS: Record<string, string> = {
    'none': 'None',
    'empty_hand': 'Only if hand is empty',
    'opponent_higher_value_in_lane': 'Only if opponent has higher value in lane',
    'this_card_is_covered': 'Only if this card is covered',
    'protocol_match': 'Only in lane with specific protocol',
    'hand_size_greater_than': 'Only if hand size greater than...',
    'same_protocol_on_field': 'Only if same protocol card on field (Unity)',
    'compile_block': 'Block opponent compile next turn',
    'trash_not_empty': 'Only if trash is not empty'
};

export const AdvancedConditionalSection: React.FC<AdvancedConditionalSectionProps> = ({
    conditional,
    onChange,
    availableTypes = DEFAULT_TYPES,
    showProtocolInput = false,
    showThresholdInput = false,
    showTurnDuration = false
}) => {
    const currentType = conditional?.type || 'none';

    // Check if any conditional is configured (for forceOpen)
    const hasConfig = currentType !== 'none';

    const handleTypeChange = (type: string) => {
        if (type === 'none') {
            onChange(undefined);
        } else {
            onChange({
                ...conditional,
                type: type as AdvancedConditional['type']
            });
        }
    };

    return (
        <CollapsibleSection title="Conditionals" forceOpen={hasConfig}>
            <div className="filter-row">
                <label>
                    Condition
                    <select
                        value={currentType}
                        onChange={e => handleTypeChange(e.target.value)}
                    >
                        {availableTypes.map(type => (
                            <option key={type} value={type}>
                                {TYPE_LABELS[type || 'none']}
                            </option>
                        ))}
                    </select>
                </label>

                {currentType === 'protocol_match' && showProtocolInput && (
                    <label>
                        Protocol
                        <input
                            type="text"
                            value={conditional?.protocol || ''}
                            onChange={e => onChange({
                                ...conditional,
                                type: 'protocol_match',
                                protocol: e.target.value
                            })}
                            placeholder="e.g., Fire, Water..."
                        />
                    </label>
                )}

                {currentType === 'hand_size_greater_than' && showThresholdInput && (
                    <label>
                        Threshold
                        <input
                            type="number"
                            min={0}
                            max={10}
                            value={conditional?.threshold || 0}
                            onChange={e => onChange({
                                ...conditional,
                                type: 'hand_size_greater_than',
                                threshold: parseInt(e.target.value)
                            })}
                        />
                    </label>
                )}

                {currentType === 'compile_block' && showTurnDuration && (
                    <label>
                        Turns
                        <select
                            value={conditional?.turnDuration || 1}
                            onChange={e => onChange({
                                ...conditional,
                                type: 'compile_block',
                                turnDuration: parseInt(e.target.value)
                            })}
                        >
                            <option value={1}>1 turn</option>
                            <option value={2}>2 turns</option>
                            <option value={3}>3 turns</option>
                        </select>
                    </label>
                )}
            </div>

            {currentType !== 'none' && (
                <small className="hint-text">
                    Effect only triggers when condition is met
                </small>
            )}
        </CollapsibleSection>
    );
};
