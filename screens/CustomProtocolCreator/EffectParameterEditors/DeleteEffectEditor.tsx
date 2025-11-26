/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { DeleteEffectParams } from '../../../types/customProtocol';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

interface DeleteEffectEditorProps {
    params: DeleteEffectParams;
    onChange: (params: DeleteEffectParams) => void;
}

export const DeleteEffectEditor: React.FC<DeleteEffectEditorProps> = ({ params, onChange }) => {
    // Ensure targetFilter exists
    const targetFilter = params.targetFilter || { position: 'uncovered', faceState: 'any' };

    return (
        <div className="param-editor delete-effect-editor">
            <h4>Delete Effect Parameters</h4>

            <label>
                Anzahl
                <select
                    value={typeof params.count === 'number' ? params.count.toString() : 'all'}
                    onChange={e => onChange({ ...params, count: e.target.value === 'all' ? 'all_in_lane' : parseInt(e.target.value) })}
                >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="all">All in a lane</option>
                </select>
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={params.excludeSelf}
                    onChange={e => onChange({ ...params, excludeSelf: e.target.checked })}
                />
                Exclude self (other cards only)
            </label>

            <label>
                <input
                    type="checkbox"
                    checked={params.deleteSelf || false}
                    onChange={e => onChange({ ...params, deleteSelf: e.target.checked })}
                />
                Delete this card (ignores all other settings)
            </label>

            <h5>Target Filter</h5>

            <label>
                Position
                <select
                    value={targetFilter.position}
                    onChange={e =>
                        onChange({ ...params, targetFilter: { ...targetFilter, position: e.target.value as any } })
                    }
                >
                    <option value="any">Any</option>
                    <option value="uncovered">Uncovered</option>
                    <option value="covered">Covered</option>
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
                Owner
                <select
                    value={targetFilter.owner || 'any'}
                    onChange={e => {
                        const val = e.target.value;
                        const newFilter = { ...targetFilter };
                        if (val === 'any') {
                            delete newFilter.owner;
                        } else {
                            newFilter.owner = val as any;
                        }
                        onChange({ ...params, targetFilter: newFilter });
                    }}
                >
                    <option value="any">Any (own or opponent)</option>
                    <option value="own">Own cards only</option>
                    <option value="opponent">Opponent's cards only</option>
                </select>
            </label>

            <label>
                Calculation
                <select
                    value={targetFilter.calculation || 'none'}
                    onChange={e => {
                        const val = e.target.value;
                        const newFilter = { ...targetFilter };
                        if (val === 'none') {
                            delete newFilter.calculation;
                        } else {
                            newFilter.calculation = val as any;
                        }
                        onChange({ ...params, targetFilter: newFilter });
                    }}
                >
                    <option value="none">None</option>
                    <option value="highest_value">Highest value</option>
                    <option value="lowest_value">Lowest value</option>
                </select>
            </label>

            <label>
                Value Range (specific values to target)
                <select
                    value={targetFilter.valueRange ? `${targetFilter.valueRange.min}-${targetFilter.valueRange.max}` : 'none'}
                    onChange={e => {
                        const val = e.target.value;
                        const newFilter = { ...targetFilter };
                        if (val === 'none') {
                            delete newFilter.valueRange;
                        } else if (val === '0-1') {
                            newFilter.valueRange = { min: 0, max: 1 };
                        } else if (val === '1-2') {
                            newFilter.valueRange = { min: 1, max: 2 };
                        } else if (val === '0-0') {
                            newFilter.valueRange = { min: 0, max: 0 };
                        }
                        onChange({ ...params, targetFilter: newFilter });
                    }}
                >
                    <option value="none">Any value</option>
                    <option value="0-0">Value 0 only</option>
                    <option value="0-1">Values 0 or 1</option>
                    <option value="1-2">Values 1 or 2</option>
                </select>
            </label>

            <h5>Scope</h5>

            <label>
                Lane Scope
                <select
                    value={params.scope?.type || 'any'}
                    onChange={e => {
                        const val = e.target.value;
                        if (val === 'any') {
                            const { scope, ...rest } = params;
                            onChange(rest as DeleteEffectParams);
                        } else {
                            onChange({ ...params, scope: { type: val as any } });
                        }
                    }}
                >
                    <option value="any">Any lane</option>
                    <option value="this_line">This line only</option>
                    <option value="other_lanes">Other lanes</option>
                    <option value="each_other_line">Each other line (1 per line)</option>
                    <option value="each_lane">Each lane (flexible, 1 per line)</option>
                </select>
            </label>

            {(params.scope?.type === 'other_lanes' || params.scope?.type === 'any') && (
                <label>
                    Minimum Cards in Lane
                    <select
                        value={params.scope?.minCardsInLane || 0}
                        onChange={e => {
                            const val = parseInt(e.target.value);
                            if (val === 0) {
                                const newScope = { ...params.scope };
                                delete newScope.minCardsInLane;
                                onChange({ ...params, scope: newScope as any });
                            } else {
                                onChange({
                                    ...params,
                                    scope: { ...params.scope!, minCardsInLane: val }
                                });
                            }
                        }}
                    >
                        <option value={0}>No minimum</option>
                        <option value={8}>8 or more cards (Metal-3)</option>
                        <option value={6}>6 or more cards</option>
                        <option value={4}>4 or more cards</option>
                    </select>
                    {params.scope?.minCardsInLane && (
                        <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                            Only delete from lanes with {params.scope.minCardsInLane}+ cards total.
                        </small>
                    )}
                </label>
            )}

            <label>
                Who Chooses Target?
                <select
                    value={params.actorChooses || 'effect_owner'}
                    onChange={e => {
                        const val = e.target.value as 'effect_owner' | 'card_owner';
                        if (val === 'effect_owner') {
                            const { actorChooses, ...rest } = params;
                            onChange(rest as DeleteEffectParams);
                        } else {
                            onChange({ ...params, actorChooses: val });
                        }
                    }}
                >
                    <option value="effect_owner">Effect owner chooses (default)</option>
                    <option value="card_owner">Card owner chooses (Plague-4: opponent deletes their own)</option>
                </select>
                {params.actorChooses === 'card_owner' && (
                    <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                        The owner of the targeted card chooses which card to delete.
                    </small>
                )}
            </label>

            <div className="effect-preview">
                <strong>Preview:</strong> {getEffectSummary({ id: 'preview', trigger: 'on_play', position: 'middle', params })}
            </div>
        </div>
    );
};

// Keeping for reference but using getEffectSummary from cardFactory instead
const _generateDeleteText = (params: DeleteEffectParams): string => {
    let text = 'Delete ';

    if (params.count === 'all_in_lane') {
        text += 'all ';
    } else {
        text += `${params.count} `;
    }

    // Ensure targetFilter exists
    const targetFilter = params.targetFilter || { position: 'uncovered', faceState: 'any' };

    if (targetFilter.calculation === 'highest_value') {
        text += 'highest value ';
    } else if (targetFilter.calculation === 'lowest_value') {
        text += 'lowest value ';
    }

    if (targetFilter.valueRange) {
        text += `value ${targetFilter.valueRange.min}-${targetFilter.valueRange.max} `;
    }

    if (targetFilter.position === 'covered') {
        text += 'covered ';
    } else if (targetFilter.position === 'uncovered') {
        text += 'uncovered ';
    }

    if (targetFilter.faceState === 'face_down') {
        text += 'face-down ';
    } else if (targetFilter.faceState === 'face_up') {
        text += 'face-up ';
    }

    const cardWord = params.count === 1 ? 'card' : 'cards';
    text += cardWord;

    if (params.scope?.type === 'this_line') {
        text += ' in this line';
    } else if (params.scope?.type === 'other_lanes') {
        text += ' in other lanes';
        if (params.scope.minCardsInLane) {
            text += ` with ${params.scope.minCardsInLane}+ cards`;
        }
    } else if (params.scope?.type === 'each_other_line' || (params.scope as any)?.type === 'each_other_line') {
        text += ' from each other line';
    } else if (params.scope?.type === 'each_lane') {
        text = `In each line, ${text.toLowerCase()}`;
    } else if ((params.scope as any)?.type === 'any' && (params.scope as any).minCardsInLane) {
        text += ` in lanes with ${(params.scope as any).minCardsInLane}+ cards`;
    }

    // Add owner info
    if (targetFilter.owner === 'own') {
        text += ' (your cards)';
    } else if (targetFilter.owner === 'opponent') {
        text += ' (opponent\'s cards)';
    }

    if (params.excludeSelf) {
        text += ' (excluding self)';
    }

    // Add actor info
    if (params.actorChooses === 'card_owner') {
        text += '. Card owner chooses which.';
        return text;
    }

    return text + '.';
};
