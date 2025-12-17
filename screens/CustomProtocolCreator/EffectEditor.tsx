/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { EffectDefinition, EffectActionType } from '../../types/customProtocol';
import { v4 as uuidv4 } from 'uuid';
import { DrawEffectEditor } from './EffectParameterEditors/DrawEffectEditor';
import { RefreshEffectEditor } from './EffectParameterEditors/RefreshEffectEditor';
import { MutualDrawEffectEditor } from './EffectParameterEditors/MutualDrawEffectEditor';
import { FlipEffectEditor } from './EffectParameterEditors/FlipEffectEditor';
import { ShiftEffectEditor } from './EffectParameterEditors/ShiftEffectEditor';
import { DeleteEffectEditor } from './EffectParameterEditors/DeleteEffectEditor';
import { DiscardEffectEditor } from './EffectParameterEditors/DiscardEffectEditor';
import { ReturnEffectEditor } from './EffectParameterEditors/ReturnEffectEditor';
import { PlayEffectEditor } from './EffectParameterEditors/PlayEffectEditor';
import { ProtocolEffectEditor } from './EffectParameterEditors/ProtocolEffectEditor';
import { RevealEffectEditor } from './EffectParameterEditors/RevealEffectEditor';
import { TakeEffectEditor } from './EffectParameterEditors/TakeEffectEditor';
import { ChoiceEffectEditor } from './EffectParameterEditors/ChoiceEffectEditor';
import { PassiveRuleEditor } from './EffectParameterEditors/PassiveRuleEditor';
import { ValueModifierEditor } from './EffectParameterEditors/ValueModifierEditor';
import { BlockCompileEffectEditor } from './EffectParameterEditors/BlockCompileEffectEditor';
import { DeleteAllInLaneEffectEditor } from './EffectParameterEditors/DeleteAllInLaneEffectEditor';
import { ShuffleTrashEffectEditor, ShuffleDeckEffectEditor } from './EffectParameterEditors/ShuffleEffectEditor';
import { StateNumberEffectEditor } from './EffectParameterEditors/StateNumberEffectEditor';
import { StateProtocolEffectEditor } from './EffectParameterEditors/StateProtocolEffectEditor';
import { generateEffectText } from '../../logic/customProtocols/cardFactory';

interface EffectEditorProps {
    effect: EffectDefinition;
    onChange: (effect: EffectDefinition) => void;
    readOnly?: boolean;
}

const createDefaultParams = (action: EffectActionType): any => {
    switch (action) {
        case 'draw':
            return { action: 'draw', count: 1, target: 'self', source: 'own_deck' };
        case 'refresh':
            return { action: 'refresh', target: 'self' };
        case 'mutual_draw':
            return { action: 'mutual_draw', count: 1 };
        case 'flip':
            return {
                action: 'flip',
                count: 1,
                targetFilter: { owner: 'any', position: 'any', faceState: 'any', excludeSelf: false },
                optional: false,
            };
        case 'shift':
            return {
                action: 'shift',
                targetFilter: { owner: 'any', position: 'any', faceState: 'any' },
                destinationRestriction: { type: 'any' },
            };
        case 'delete':
            return {
                action: 'delete',
                count: 1,
                targetFilter: { position: 'any', faceState: 'any' },
                scope: { type: 'anywhere' },
                excludeSelf: false,
            };
        case 'discard':
            return { action: 'discard', count: 1, actor: 'self' };
        case 'return':
            return { action: 'return', count: 1, targetFilter: {}, scope: { type: 'any_card' } };
        case 'play':
            return {
                action: 'play',
                source: 'hand',
                count: 1,
                faceDown: false,
                destinationRule: { type: 'other_lines' },
            };
        case 'rearrange_protocols':
            return { action: 'rearrange_protocols', target: 'own' };
        case 'swap_protocols':
            return { action: 'swap_protocols', target: 'own' };
        case 'reveal':
        case 'give':
            return { action, source: 'own_hand', count: 1 };
        case 'take':
            return { action: 'take', source: 'opponent_hand', count: 1, random: true };
        case 'choice':
            return { action: 'choice', options: [] };
        case 'passive_rule':
            return { action: 'passive_rule', rule: { type: 'block_all_play', target: 'opponent', scope: 'this_lane' } };
        case 'value_modifier':
            return { action: 'value_modifier', modifier: { type: 'add_per_condition', value: 1, condition: 'per_face_down_card', target: 'own_total', scope: 'this_lane' } };
        case 'block_compile':
            return { action: 'block_compile', target: 'opponent' };
        case 'delete_all_in_lane':
            return { action: 'delete_all_in_lane', laneCondition: { type: 'min_cards', count: 8 }, excludeCurrentLane: true };
        case 'shuffle_trash':
            return { action: 'shuffle_trash', optional: true };
        case 'shuffle_deck':
            return { action: 'shuffle_deck' };
        case 'redirect_return_to_deck':
            return { action: 'redirect_return_to_deck', faceDown: true };
        case 'state_number':
            return { action: 'state_number', numberSource: 'own_protocol_values' };
        case 'state_protocol':
            return { action: 'state_protocol', protocolSource: 'opponent_cards' };
        case 'swap_stacks':
            return { action: 'swap_stacks', target: 'own' };
        case 'copy_opponent_middle':
            return { action: 'copy_opponent_middle', optional: true };
        default:
            return {};
    }
};

export const EffectEditor: React.FC<EffectEditorProps> = ({ effect, onChange, readOnly = false }) => {
    const handleParamsChange = (newParams: any) => {
        if (readOnly) return;
        onChange({ ...effect, params: newParams });
    };

    const handleToggleConditional = (enabled: boolean) => {
        if (enabled) {
            // Create default follow-up effect
            const thenEffect: EffectDefinition = {
                id: uuidv4(),
                params: createDefaultParams('draw'),
                position: effect.position,
                trigger: effect.trigger,
            };
            onChange({
                ...effect,
                conditional: {
                    type: 'then', // Default to 'then'
                    thenEffect,
                },
            });
        } else {
            // Remove conditional
            const { conditional, ...rest } = effect;
            onChange(rest as EffectDefinition);
        }
    };

    const handleConditionalTypeChange = (newType: 'then' | 'if_executed') => {
        if (!effect.conditional) return;
        onChange({
            ...effect,
            conditional: {
                ...effect.conditional,
                type: newType,
            },
        });
    };

    const handleConditionalEffectChange = (updatedThenEffect: EffectDefinition) => {
        if (!effect.conditional) return;
        onChange({
            ...effect,
            conditional: {
                ...effect.conditional,
                thenEffect: updatedThenEffect,
            },
        });
    };

    const handleConditionalActionChange = (action: EffectActionType) => {
        if (!effect.conditional) return;
        const newParams = createDefaultParams(action);
        const updatedThenEffect: EffectDefinition = {
            ...effect.conditional.thenEffect,
            params: newParams,
        };
        onChange({
            ...effect,
            conditional: {
                ...effect.conditional,
                thenEffect: updatedThenEffect,
            },
        });
    };

    const handleToggleNestedConditional = (enabled: boolean) => {
        if (!effect.conditional) return;
        if (enabled) {
            const nestedThenEffect: EffectDefinition = {
                id: uuidv4(),
                params: createDefaultParams('delete'),
                position: effect.position,
                trigger: effect.trigger,
            };
            onChange({
                ...effect,
                conditional: {
                    ...effect.conditional,
                    thenEffect: {
                        ...effect.conditional.thenEffect,
                        conditional: {
                            type: 'then',
                            thenEffect: nestedThenEffect,
                        },
                    },
                },
            });
        } else {
            const { conditional: nestedConditional, ...rest } = effect.conditional.thenEffect;
            onChange({
                ...effect,
                conditional: {
                    ...effect.conditional,
                    thenEffect: rest as EffectDefinition,
                },
            });
        }
    };

    const handleNestedConditionalTypeChange = (newType: 'then' | 'if_executed') => {
        if (!effect.conditional?.thenEffect.conditional) return;
        onChange({
            ...effect,
            conditional: {
                ...effect.conditional,
                thenEffect: {
                    ...effect.conditional.thenEffect,
                    conditional: {
                        ...effect.conditional.thenEffect.conditional,
                        type: newType,
                    },
                },
            },
        });
    };

    const handleNestedConditionalEffectChange = (updatedNestedEffect: EffectDefinition) => {
        if (!effect.conditional?.thenEffect.conditional) return;
        onChange({
            ...effect,
            conditional: {
                ...effect.conditional,
                thenEffect: {
                    ...effect.conditional.thenEffect,
                    conditional: {
                        ...effect.conditional.thenEffect.conditional,
                        thenEffect: updatedNestedEffect,
                    },
                },
            },
        });
    };

    const handleNestedConditionalActionChange = (action: EffectActionType) => {
        if (!effect.conditional?.thenEffect.conditional) return;
        const newParams = createDefaultParams(action);
        const updatedNestedEffect: EffectDefinition = {
            ...effect.conditional.thenEffect.conditional.thenEffect,
            params: newParams,
        };
        onChange({
            ...effect,
            conditional: {
                ...effect.conditional,
                thenEffect: {
                    ...effect.conditional.thenEffect,
                    conditional: {
                        ...effect.conditional.thenEffect.conditional,
                        thenEffect: updatedNestedEffect,
                    },
                },
            },
        });
    };

    const renderEffectParams = (effectToRender: EffectDefinition, onChange: (params: any) => void) => {
        switch (effectToRender.params.action) {
            case 'draw':
                return <DrawEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'refresh':
                return <RefreshEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'mutual_draw':
                return <MutualDrawEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'flip':
                return <FlipEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'shift':
                return <ShiftEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'delete':
                return <DeleteEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'discard':
                return <DiscardEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'return':
                return <ReturnEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'play':
                return <PlayEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'rearrange_protocols':
            case 'swap_protocols':
                return <ProtocolEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'reveal':
            case 'give':
                return <RevealEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'take':
                return <TakeEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'choice':
                return <ChoiceEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'passive_rule':
                return <PassiveRuleEditor params={effectToRender.params} onChange={onChange} />;
            case 'value_modifier':
                return <ValueModifierEditor params={effectToRender.params} onChange={onChange} />;
            case 'block_compile':
                return <BlockCompileEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'delete_all_in_lane':
                return <DeleteAllInLaneEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'shuffle_trash':
                return <ShuffleTrashEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'shuffle_deck':
                return <ShuffleDeckEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'state_number':
                return <StateNumberEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'state_protocol':
                return <StateProtocolEffectEditor params={effectToRender.params} onChange={onChange} />;
            case 'swap_stacks':
                // Simple effect with no parameters to configure
                return <div className="param-editor swap-stacks-editor">
                    <h4>Swap Stacks</h4>
                    <p style={{ color: '#8A79E8' }}>
                        Swap all of your cards in one of your stacks with another one of your stacks.
                    </p>
                </div>;
            case 'copy_opponent_middle':
                return <div className="param-editor copy-opponent-middle-editor">
                    <h4>Copy Opponent's Middle Command</h4>
                    <label>
                        <input
                            type="checkbox"
                            checked={(effectToRender.params as any).optional ?? true}
                            onChange={e => onChange({ ...effectToRender.params, optional: e.target.checked })}
                        />
                        Optional ("You may resolve..." instead of "Resolve...")
                    </label>
                    <p style={{ color: '#8A79E8', marginTop: '10px' }}>
                        Select one of your opponent's face-up uncovered cards and execute its middle commands as if they were on this card.
                    </p>
                </div>;
            default:
                return <div>Unknown effect type: {effectToRender.params.action}</div>;
        }
    };

    // Get trigger label for display (includes reactiveTriggerActor and reactiveScope context)
    const getTriggerLabel = (trigger: string, eff?: EffectDefinition): string => {
        const triggerActor = eff?.reactiveTriggerActor || 'self';
        const reactiveScope = (eff as any)?.reactiveScope || 'global';

        // Special handling for after_play with actor and scope
        if (trigger === 'after_play') {
            const actorText = triggerActor === 'opponent' ? 'opponent plays' :
                             triggerActor === 'any' ? 'any player plays' : 'you play';
            const scopeText = reactiveScope === 'this_lane' ? ' in this line' : '';
            return `After ${actorText} a card${scopeText}`;
        }

        // Other reactive triggers with actor context
        if (['after_delete', 'after_discard', 'after_draw', 'after_shift', 'after_flip', 'after_shuffle'].includes(trigger)) {
            const actionMap: Record<string, string> = {
                'after_delete': 'cards are deleted',
                'after_discard': 'cards are discarded',
                'after_draw': 'cards are drawn',
                'after_shift': 'cards are shifted',
                'after_flip': 'cards are flipped',
                'after_shuffle': 'deck is shuffled',
            };
            const actorPrefix = triggerActor === 'opponent' ? 'After opponent: ' :
                               triggerActor === 'any' ? 'After anyone: ' : 'After you: ';
            const scopeSuffix = reactiveScope === 'this_lane' ? ' (this line)' : '';
            return actorPrefix + actionMap[trigger] + scopeSuffix;
        }

        const triggerLabels: Record<string, string> = {
            'on_play': 'On Play',
            'passive': 'Passive (always active)',
            'start': 'Start Phase',
            'end': 'End Phase',
            'on_cover': 'When Covered',
            'on_flip': 'When Flipped',
            'on_cover_or_flip': 'When Covered or Flipped',
            'after_clear_cache': 'After Clear Cache',
            'after_opponent_discard': 'After Opponent Discards',
            'after_opponent_draw': 'After Opponent Draws',
            'after_refresh': 'After Refresh',
            'after_opponent_refresh': 'After Opponent Refreshes',
            'after_compile': 'After Compile',
            'after_opponent_compile': 'After Opponent Compiles',
            'before_compile_delete': 'Before Compile Delete',
            'when_card_returned': 'When Card Returned',
        };
        return triggerLabels[trigger] || trigger;
    };

    return (
        <div className={`effect-editor ${readOnly ? 'read-only-mode' : ''}`}>
            {/* Trigger & Position Info */}
            <div className="trigger-info" style={{ marginBottom: '15px', padding: '10px', backgroundColor: '#1A113B', borderRadius: '4px', border: '1px solid rgba(97, 239, 255, 0.3)' }}>
                <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <label style={{ flex: 1, minWidth: '200px' }}>
                        <strong>Trigger:</strong>
                        <select
                            value={effect.trigger}
                            onChange={(e) => !readOnly && onChange({ ...effect, trigger: e.target.value as any })}
                            disabled={readOnly}
                            style={{
                                width: '100%',
                                padding: '6px',
                                marginTop: '4px',
                                backgroundColor: '#2c1d63',
                                color: '#F0F0F0',
                                border: '1px solid rgba(97, 239, 255, 0.3)',
                                borderRadius: '4px',
                            }}
                        >
                            <optgroup label="Immediate">
                                <option value="on_play">On Play</option>
                            </optgroup>
                            <optgroup label="Passive (Top Box)">
                                <option value="passive">Passive (always active)</option>
                            </optgroup>
                            <optgroup label="Phase Triggers (Bottom Box)">
                                <option value="start">Start Phase</option>
                                <option value="end">End Phase</option>
                                <option value="on_cover">When Covered</option>
                            </optgroup>
                            <optgroup label="Reactive (Top Box)">
                                <option value="on_flip">When this card would be flipped</option>
                                <option value="on_cover_or_flip">When covered or flipped</option>
                                <option value="after_delete">After cards are deleted</option>
                                <option value="after_discard">After cards are discarded</option>
                                <option value="after_draw">After cards are drawn</option>
                                <option value="after_shift">After cards are shifted</option>
                                <option value="after_flip">After cards are flipped</option>
                                <option value="after_play">After a card is played</option>
                                <option value="after_shuffle">After deck is shuffled</option>
                                <option value="after_clear_cache">After cache is cleared</option>
                                <option value="after_refresh">After you refresh</option>
                                <option value="after_opponent_refresh">After opponent refreshes</option>
                                <option value="after_compile">After you compile</option>
                                <option value="after_opponent_compile">After opponent compiles</option>
                                <option value="after_opponent_discard">After opponent discards</option>
                                <option value="after_opponent_draw">After opponent draws</option>
                                <option value="before_compile_delete">Before deleted by compile</option>
                                <option value="when_card_returned">When card returned to hand</option>
                            </optgroup>
                        </select>
                    </label>
                    <div style={{ color: '#8A79E8', fontSize: '13px' }}>
                        <strong>Position:</strong> {effect.position.charAt(0).toUpperCase() + effect.position.slice(1)} Box
                    </div>
                </div>
            </div>

            {/* Main Effect */}
            <div className="main-effect">
                <h3>Main Effect</h3>
                {renderEffectParams(effect, handleParamsChange)}

                {/* Full Effect Preview */}
                <div className="effect-preview">
                    <strong>Preview:</strong>{' '}
                    <span dangerouslySetInnerHTML={{ __html: generateEffectText([effect]) }} />
                </div>
            </div>

            {/* Use Card from Previous Effect */}
            <div style={{ marginTop: '15px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                        type="checkbox"
                        checked={!!effect.useCardFromPreviousEffect}
                        onChange={(e) => onChange({ ...effect, useCardFromPreviousEffect: e.target.checked })}
                    />
                    <span>Use card from previous effect (for "shift THAT card", "draw equal to THAT card's value", etc.)</span>
                </label>
                {effect.useCardFromPreviousEffect && (
                    <small style={{ display: 'block', marginLeft: '24px', marginTop: '4px', color: '#8A79E8' }}>
                        This effect will target/use the card selected by the previous effect in the chain.
                    </small>
                )}
            </div>

            {/* Reactive Trigger Actor (only for reactive triggers) */}
            {(effect.trigger === 'after_draw' || effect.trigger === 'after_delete' || effect.trigger === 'after_discard' || effect.trigger === 'after_shift' || effect.trigger === 'after_flip' || effect.trigger === 'after_shuffle' || effect.trigger === 'after_clear_cache' || effect.trigger === 'after_opponent_discard' || effect.trigger === 'after_play') && (
                <div style={{ marginTop: '15px' }}>
                    <label>
                        Trigger Actor (who triggers this effect?)
                        <select
                            value={effect.reactiveTriggerActor || 'self'}
                            onChange={(e) => onChange({ ...effect, reactiveTriggerActor: e.target.value as any })}
                            style={{
                                width: '100%',
                                padding: '8px',
                                marginTop: '5px',
                                backgroundColor: '#1A113B',
                                color: '#F0F0F0',
                                border: '1px solid rgba(97, 239, 255, 0.3)',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            <option value="self">Only when YOU perform the action (default)</option>
                            <option value="opponent">Only when OPPONENT performs the action</option>
                            <option value="any">When ANYONE performs the action</option>
                        </select>
                    </label>
                    <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                        {effect.reactiveTriggerActor === 'self' || !effect.reactiveTriggerActor
                            ? 'Effect triggers only when YOU delete/draw/etc.'
                            : effect.reactiveTriggerActor === 'opponent'
                            ? 'Effect triggers only when OPPONENT deletes/draws/etc.'
                            : 'Effect triggers when ANYONE deletes/draws/etc.'}
                    </small>
                </div>
            )}

            {/* Reactive Scope (for lane-based reactive triggers) */}
            {(effect.trigger === 'after_play' || effect.trigger === 'after_shift' || effect.trigger === 'after_flip' || effect.trigger === 'after_delete') && (
                <div style={{ marginTop: '15px' }}>
                    <label>
                        Reactive Scope
                        <select
                            value={(effect as any).reactiveScope || 'global'}
                            onChange={(e) => onChange({ ...effect, reactiveScope: e.target.value as any })}
                            style={{
                                width: '100%',
                                padding: '8px',
                                marginTop: '5px',
                                backgroundColor: '#1A113B',
                                color: '#F0F0F0',
                                border: '1px solid rgba(97, 239, 255, 0.3)',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            <option value="global">Any lane (default)</option>
                            <option value="this_lane">This lane only</option>
                        </select>
                    </label>
                    <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                        {(effect as any).reactiveScope === 'this_lane'
                            ? 'Effect only triggers when the action happens in the same lane as this card.'
                            : 'Effect triggers when the action happens anywhere on the board.'}
                    </small>
                </div>
            )}

            {/* Only During Opponent's Turn (Peace-4) */}
            {(effect.trigger === 'after_draw' || effect.trigger === 'after_delete' || effect.trigger === 'after_discard' || effect.trigger === 'after_shift' || effect.trigger === 'after_flip' || effect.trigger === 'after_shuffle') && (
                <div style={{ marginTop: '15px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={(effect as any).onlyDuringOpponentTurn || false}
                            onChange={(e) => onChange({ ...effect, onlyDuringOpponentTurn: e.target.checked })}
                            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                        />
                        Only During Opponent's Turn
                    </label>
                    <small style={{ display: 'block', marginTop: '4px', color: '#8A79E8' }}>
                        {(effect as any).onlyDuringOpponentTurn
                            ? "Effect only triggers during your opponent's turn."
                            : 'Effect triggers during any turn.'}
                    </small>
                </div>
            )}

            {/* Conditional Follow-Up */}
            <div className="conditional-section" style={{ marginTop: '20px', borderTop: '1px solid #2c1d63', paddingTop: '15px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <input
                        type="checkbox"
                        checked={!!effect.conditional}
                        onChange={(e) => handleToggleConditional(e.target.checked)}
                    />
                    <strong>Add follow-up effect</strong>
                </label>

                {effect.conditional && (
                    <div className="follow-up-effect" style={{ marginLeft: '20px', padding: '10px', backgroundColor: '#2c1d63', borderRadius: '4px', border: '1px solid rgba(97, 239, 255, 0.2)' }}>
                        <h4 style={{ marginTop: 0 }}>Follow-Up Effect</h4>

                        <label>
                            Connection Type
                            <select
                                value={effect.conditional.type || 'then'}
                                onChange={(e) => handleConditionalTypeChange(e.target.value as 'then' | 'if_executed')}
                                style={{
                                    width: '100%',
                                    padding: '8px',
                                    marginTop: '5px',
                                    marginBottom: '15px',
                                    backgroundColor: '#1A113B',
                                    color: '#F0F0F0',
                                    border: '1px solid rgba(97, 239, 255, 0.3)',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }}
                            >
                                <option value="then">Then (always executes)</option>
                                <option value="if_executed">If you do (only if first effect succeeds)</option>
                            </select>
                        </label>

                        <label>
                            Effect Type
                            <select
                                value={effect.conditional.thenEffect.params.action}
                                onChange={(e) => handleConditionalActionChange(e.target.value as EffectActionType)}
                                style={{
                                    width: '100%',
                                    padding: '8px',
                                    marginTop: '5px',
                                    backgroundColor: '#1A113B',
                                    color: '#F0F0F0',
                                    border: '1px solid rgba(97, 239, 255, 0.3)',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }}
                            >
                                <option value="draw">Draw Cards</option>
                                <option value="refresh">Refresh Hand</option>
                                <option value="mutual_draw">Mutual Draw (Exchange)</option>
                                <option value="flip">Flip Cards</option>
                                <option value="shift">Shift Card</option>
                                <option value="delete">Delete Cards</option>
                                <option value="delete_all_in_lane">Delete All in Lane</option>
                                <option value="discard">Discard Cards</option>
                                <option value="return">Return to Hand</option>
                                <option value="play">Play from Hand/Deck</option>
                                <option value="rearrange_protocols">Rearrange Protocols</option>
                                <option value="swap_protocols">Swap Protocols</option>
                                <option value="reveal">Reveal Hand</option>
                                <option value="give">Give Cards</option>
                                <option value="take">Take from Hand</option>
                                <option value="choice">Either/Or Choice</option>
                                <option value="block_compile">Block Compile</option>
                                <option value="shuffle_trash">Shuffle Trash into Deck</option>
                                <option value="shuffle_deck">Shuffle Deck</option>
                                <option value="state_number">State a Number</option>
                                <option value="state_protocol">State a Protocol</option>
                                <option value="swap_stacks">Swap Stacks</option>
                                <option value="copy_opponent_middle">Copy Opponent's Middle</option>
                            </select>
                        </label>

                        <div style={{ marginTop: '15px' }}>
                            {renderEffectParams(
                                effect.conditional.thenEffect,
                                (newParams) => handleConditionalEffectChange({ ...effect.conditional!.thenEffect, params: newParams })
                            )}
                        </div>

                        {/* Nested Follow-Up Effect (2nd level) */}
                        <div className="nested-conditional-section" style={{ marginTop: '15px', borderTop: '1px solid rgba(97, 239, 255, 0.2)', paddingTop: '15px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                                <input
                                    type="checkbox"
                                    checked={!!effect.conditional.thenEffect.conditional}
                                    onChange={(e) => handleToggleNestedConditional(e.target.checked)}
                                />
                                <strong>Add 2nd follow-up effect</strong>
                            </label>

                            {effect.conditional.thenEffect.conditional && (
                                <div className="nested-follow-up-effect" style={{ marginLeft: '10px', padding: '10px', backgroundColor: '#1A113B', borderRadius: '4px', border: '1px solid rgba(97, 239, 255, 0.2)' }}>
                                    <h5 style={{ marginTop: 0, fontSize: '0.9rem' }}>2nd Follow-Up Effect</h5>

                                    <label>
                                        Connection Type
                                        <select
                                            value={effect.conditional.thenEffect.conditional.type || 'then'}
                                            onChange={(e) => handleNestedConditionalTypeChange(e.target.value as 'then' | 'if_executed')}
                                            style={{
                                                width: '100%',
                                                padding: '6px',
                                                marginTop: '5px',
                                                marginBottom: '10px',
                                                backgroundColor: '#0D0825',
                                                color: '#F0F0F0',
                                                border: '1px solid rgba(97, 239, 255, 0.3)',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem'
                                            }}
                                        >
                                            <option value="then">Then (always executes)</option>
                                            <option value="if_executed">If you do (only if first effect succeeds)</option>
                                        </select>
                                    </label>

                                    <label>
                                        Effect Type
                                        <select
                                            value={effect.conditional.thenEffect.conditional.thenEffect.params.action}
                                            onChange={(e) => handleNestedConditionalActionChange(e.target.value as EffectActionType)}
                                            style={{
                                                width: '100%',
                                                padding: '6px',
                                                marginTop: '5px',
                                                backgroundColor: '#0D0825',
                                                color: '#F0F0F0',
                                                border: '1px solid rgba(97, 239, 255, 0.3)',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem'
                                            }}
                                        >
                                            <option value="draw">Draw Cards</option>
                                            <option value="refresh">Refresh Hand</option>
                                            <option value="mutual_draw">Mutual Draw (Exchange)</option>
                                            <option value="flip">Flip Cards</option>
                                            <option value="shift">Shift Card</option>
                                            <option value="delete">Delete Cards</option>
                                            <option value="delete_all_in_lane">Delete All in Lane</option>
                                            <option value="discard">Discard Cards</option>
                                            <option value="return">Return to Hand</option>
                                            <option value="play">Play from Hand/Deck</option>
                                            <option value="rearrange_protocols">Rearrange Protocols</option>
                                            <option value="swap_protocols">Swap Protocols</option>
                                            <option value="reveal">Reveal Hand</option>
                                            <option value="give">Give Cards</option>
                                            <option value="take">Take from Hand</option>
                                            <option value="choice">Either/Or Choice</option>
                                            <option value="block_compile">Block Compile</option>
                                            <option value="shuffle_trash">Shuffle Trash into Deck</option>
                                            <option value="shuffle_deck">Shuffle Deck</option>
                                            <option value="state_number">State a Number</option>
                                            <option value="state_protocol">State a Protocol</option>
                                            <option value="swap_stacks">Swap Stacks</option>
                                            <option value="copy_opponent_middle">Copy Opponent's Middle</option>
                                        </select>
                                    </label>

                                    <div style={{ marginTop: '10px' }}>
                                        {renderEffectParams(
                                            effect.conditional.thenEffect.conditional.thenEffect,
                                            (newParams) => handleNestedConditionalEffectChange({ ...effect.conditional!.thenEffect.conditional!.thenEffect, params: newParams })
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
