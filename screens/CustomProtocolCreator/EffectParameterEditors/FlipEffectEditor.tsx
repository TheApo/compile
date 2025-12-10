/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { FlipEffectParams } from '../../../types/customProtocol';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

interface FlipEffectEditorProps {
    params: FlipEffectParams;
    onChange: (params: FlipEffectParams) => void;
}

export const FlipEffectEditor: React.FC<FlipEffectEditorProps> = ({ params, onChange }) => {
    // Ensure targetFilter exists
    const targetFilter = params.targetFilter || { owner: 'any', position: 'uncovered', faceState: 'any', excludeSelf: false };
    // Ensure count exists with default value
    const count = params.count ?? 1;

    return (
        <div className="param-editor flip-effect-editor">
            <h4>Flip Effect Parameters</h4>

            <label>
                Card Count/Scope
                <select
                    value={count === 'all' ? 'all' : count === 'each' ? 'each' : count.toString()}
                    onChange={e => {
                        const val = e.target.value;
                        if (val === 'all') {
                            onChange({ ...params, count: 'all' as any });
                        } else if (val === 'each') {
                            onChange({ ...params, count: 'each' as any });
                        } else {
                            onChange({ ...params, count: parseInt(val) });
                        }
                    }}
                >
                    <option value="1">1 card</option>
                    <option value="2">2 cards</option>
                    <option value="3">3 cards</option>
                    <option value="all">All matching cards</option>
                    <option value="each">Each matching card</option>
                </select>
            </label>

            {/* NEW: Scope selector for each_lane (Chaos-0: "In each line, flip 1 covered card") */}
            {typeof params.count === 'number' && (
                <label>
                    Scope
                    <select
                        value={params.scope || 'any'}
                        onChange={e => onChange({ ...params, scope: e.target.value as any })}
                    >
                        <option value="any">Any lane</option>
                        <option value="this_lane">This lane only</option>
                        <option value="each_lane">Each lane (Chaos-0: "In each line...")</option>
                    </select>
                </label>
            )}

            <label>
                <input
                    type="checkbox"
                    checked={params.optional}
                    onChange={e => onChange({ ...params, optional: e.target.checked })}
                />
                Optional ("May flip" instead of "Flip")
            </label>

            {(params.count === 'each') && (
                <label>
                    Each Line Scope
                    <select
                        value={(params as any).eachLineScope || 'all_lines'}
                        onChange={e => onChange({ ...params, eachLineScope: e.target.value as any })}
                    >
                        <option value="all_lines">Each card on board</option>
                        <option value="each_line">1 card in each line</option>
                    </select>
                </label>
            )}

            <label>
                <input
                    type="checkbox"
                    checked={params.flipSelf || false}
                    onChange={e => onChange({ ...params, flipSelf: e.target.checked })}
                />
                Flip ONLY this card (no target selection)
                <small style={{ display: 'block', marginLeft: '24px', color: '#8A79E8' }}>
                    The card flips itself, ignoring count and target filter.
                </small>
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={params.selfFlipAfter || false}
                    onChange={e => onChange({ ...params, selfFlipAfter: e.target.checked })}
                />
                ALSO flip this card after flipping targets
                <small style={{ display: 'block', marginLeft: '24px', color: '#8A79E8' }}>
                    After flipping target(s), also flip this card as bonus.
                </small>
            </label>

            <h5>Advanced Conditional</h5>

            <label>
                Conditional Type
                <select
                    value={params.advancedConditional?.type || ''}
                    onChange={e => {
                        if (e.target.value === '') {
                            const { advancedConditional, ...rest } = params;
                            onChange(rest as FlipEffectParams);
                        } else if (e.target.value === 'protocol_match') {
                            onChange({
                                ...params,
                                advancedConditional: { type: 'protocol_match', protocol: '' }
                            });
                        } else {
                            onChange({
                                ...params,
                                advancedConditional: { type: e.target.value as any }
                            });
                        }
                    }}
                >
                    <option value="">None</option>
                    <option value="protocol_match">Only if in specific protocol line</option>
                    <option value="opponent_higher_value_in_lane">Only if opponent has higher value in this lane</option>
                </select>
            </label>

            {params.advancedConditional?.type === 'protocol_match' && (
                <label>
                    Required Protocol
                    <input
                        type="text"
                        value={params.advancedConditional.protocol || ''}
                        onChange={e =>
                            onChange({
                                ...params,
                                advancedConditional: {
                                    ...params.advancedConditional!,
                                    protocol: e.target.value
                                }
                            })
                        }
                        placeholder="e.g., Anarchy, Fire, Death"
                    />
                </label>
            )}

            <h5>Target Filter</h5>

            <label>
                Owner
                <select
                    value={targetFilter.owner}
                    onChange={e =>
                        onChange({ ...params, targetFilter: { ...targetFilter, owner: e.target.value as any } })
                    }
                >
                    <option value="any">Any</option>
                    <option value="own">Own</option>
                    <option value="opponent">Opponent</option>
                </select>
            </label>

            <label>
                Position
                <select
                    value={targetFilter.position}
                    onChange={e =>
                        onChange({ ...params, targetFilter: { ...targetFilter, position: e.target.value as any } })
                    }
                >
                    <option value="any">Any</option>
                    <option value="uncovered">Uncovered (top card)</option>
                    <option value="covered">Covered</option>
                    <option value="covered_in_this_line">Covered in this line</option>
                </select>
            </label>

            <label>
                Face State
                <select
                    value={targetFilter.faceState}
                    onChange={e =>
                        onChange({ ...params, targetFilter: { ...targetFilter, faceState: e.target.value as any } })
                    }
                >
                    <option value="any">Any</option>
                    <option value="face_up">Face-up</option>
                    <option value="face_down">Face-down</option>
                </select>
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={targetFilter.excludeSelf}
                    onChange={e =>
                        onChange({ ...params, targetFilter: { ...targetFilter, excludeSelf: e.target.checked } })
                    }
                />
                Exclude self ("other cards")
            </label>

        </div>
    );
};

// Keeping for reference but using getEffectSummary from cardFactory instead
const _generateFlipText = (params: FlipEffectParams): string => {
    // NEW: Flip self mode
    if (params.flipSelf) {
        let text = params.optional ? 'May flip this card' : 'Flip this card';

        // Add conditional
        if (params.advancedConditional?.type === 'protocol_match') {
            text += `, if this card is in the line with the ${params.advancedConditional.protocol || '[Protocol]'} protocol`;
        }

        text += '.';
        return text;
    }

    // Ensure targetFilter and count exist
    const targetFilter = params.targetFilter || { owner: 'any', position: 'uncovered', faceState: 'any', excludeSelf: false };
    const count = params.count ?? 1;

    const may = params.optional ? 'May flip' : 'Flip';
    let targetDesc = '';

    if (targetFilter.owner === 'opponent') targetDesc = "opponent's ";
    if (targetFilter.position === 'covered') targetDesc += 'covered ';
    if (targetFilter.position === 'uncovered') targetDesc += 'uncovered ';
    if (targetFilter.faceState === 'face_down') targetDesc += 'face-down ';
    if (targetFilter.faceState === 'face_up') targetDesc += 'face-up ';
    if (targetFilter.excludeSelf) targetDesc += 'other ';

    let countText = '';
    if (count === 'all') {
        countText = 'all';
    } else if (count === 'each') {
        const eachScope = (params as any).eachLineScope;
        if (eachScope === 'each_line') {
            countText = '1';
            targetDesc = targetDesc + '(in each line) ';
        } else {
            countText = 'each';
        }
    } else {
        countText = count.toString();
    }

    const cardWord = (count === 1) ? 'card' : 'cards';
    let text = `${may} ${countText} ${targetDesc}${cardWord}`;

    // NEW: Add scope text (Chaos-0: "In each line, flip 1 covered card")
    if (params.scope === 'this_lane') {
        text += ' in this line';
    } else if (params.scope === 'each_lane') {
        // Rephrase for "In each line, flip..." format
        text = `In each line, ${may.toLowerCase()} ${countText} ${targetDesc}${cardWord}`;
    }

    text += '.';

    if (params.selfFlipAfter) {
        text += ' Then flip this card.';
    }

    return text;
};
