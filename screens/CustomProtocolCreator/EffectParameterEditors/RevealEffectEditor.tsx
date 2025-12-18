/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { RevealEffectParams } from '../../../types/customProtocol';
import { getEffectSummary } from '../../../logic/customProtocols/cardFactory';

export const RevealEffectEditor: React.FC<{ params: RevealEffectParams; onChange: (params: RevealEffectParams) => void }> = ({
    params,
    onChange,
}) => {
    return (
        <div className="param-editor">
            <h4>Reveal/Give Effect</h4>
            <label>
                Action
                <select value={params.action} onChange={e => onChange({ ...params, action: e.target.value as any })}>
                    <option value="reveal">Reveal</option>
                    <option value="give">Give</option>
                </select>
            </label>
            <label>
                Source
                <select value={params.source} onChange={e => onChange({ ...params, source: e.target.value as any })}>
                    <option value="own_hand">Your hand</option>
                    <option value="opponent_hand">Opponent's hand</option>
                    <option value="own_deck_top">Top of your deck</option>
                    <option value="own_deck">Your entire deck</option>
                    <option value="own_trash">Your trash (discard pile)</option>
                    <option value="board">Board card</option>
                </select>
            </label>

            {/* Count only for hand-based reveals and trash */}
            {(params.source === 'own_hand' || params.source === 'opponent_hand' || params.source === 'board' || params.source === 'own_trash') && (
                <label>
                    Anzahl
                    <input
                        type="number"
                        min={1}
                        max={6}
                        value={params.count}
                        onChange={e => onChange({ ...params, count: parseInt(e.target.value) || 1 })}
                    />
                </label>
            )}

            {/* Follow-up action only for board reveals (flip/shift the revealed card) */}
            {params.source === 'board' && (
                <label>
                    Follow-up action
                    <select
                        value={params.followUpAction || 'none'}
                        onChange={e => {
                            if (e.target.value === 'none') {
                                const { followUpAction, ...rest } = params;
                                onChange(rest as RevealEffectParams);
                            } else {
                                onChange({ ...params, followUpAction: e.target.value as any });
                            }
                        }}
                    >
                        <option value="none">None</option>
                        <option value="flip">Then flip</option>
                        <option value="shift">Then shift</option>
                    </select>
                </label>
            )}

            {/* Protocol Filter - for revealing all same-protocol cards (Unity-0 Bottom) */}
            {params.source === 'own_hand' && params.action === 'reveal' && (
                <label>
                    <input
                        type="checkbox"
                        checked={(params as any).protocolFilter?.type === 'same_as_source'}
                        onChange={e => {
                            if (e.target.checked) {
                                onChange({ ...params, protocolFilter: { type: 'same_as_source' } } as any);
                            } else {
                                const { protocolFilter, ...rest } = params as any;
                                onChange(rest as RevealEffectParams);
                            }
                        }}
                    />
                    Reveal all same-protocol cards (Unity-0)
                    <small style={{ display: 'block', marginLeft: '24px', color: '#8A79E8' }}>
                        Reveals all cards in hand that match this card's protocol.
                    </small>
                </label>
            )}

        </div>
    );
};

// Keeping for reference but using getEffectSummary from cardFactory instead
const _generateRevealText = (params: RevealEffectParams): string => {
    const cardWord = params.count === 1 ? 'card' : 'cards';
    const actionText = params.action === 'give' ? 'Give' : 'Reveal';
    const sourceText = params.source === 'opponent_hand' ? "opponent's hand" : 'your hand';

    let text = `${actionText} ${params.count} ${cardWord} from ${sourceText}`;

    if (params.followUpAction === 'flip') {
        text += '. Then flip it.';
    } else if (params.followUpAction === 'shift') {
        text += '. Then shift it.';
    } else {
        text += '.';
    }

    return text;
};
