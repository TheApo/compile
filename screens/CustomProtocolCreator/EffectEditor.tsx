/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { EffectDefinition } from '../../types/customProtocol';
import { DrawEffectEditor } from './EffectParameterEditors/DrawEffectEditor';
import { FlipEffectEditor } from './EffectParameterEditors/FlipEffectEditor';
import { ShiftEffectEditor } from './EffectParameterEditors/ShiftEffectEditor';
import { DeleteEffectEditor } from './EffectParameterEditors/DeleteEffectEditor';
import { DiscardEffectEditor } from './EffectParameterEditors/DiscardEffectEditor';
import { ReturnEffectEditor } from './EffectParameterEditors/ReturnEffectEditor';
import { PlayEffectEditor } from './EffectParameterEditors/PlayEffectEditor';
import { ProtocolEffectEditor } from './EffectParameterEditors/ProtocolEffectEditor';
import { RevealEffectEditor } from './EffectParameterEditors/RevealEffectEditor';

interface EffectEditorProps {
    effect: EffectDefinition;
    onChange: (effect: EffectDefinition) => void;
}

export const EffectEditor: React.FC<EffectEditorProps> = ({ effect, onChange }) => {
    const handleParamsChange = (newParams: any) => {
        onChange({ ...effect, params: newParams });
    };

    const renderEditor = () => {
        switch (effect.params.action) {
            case 'draw':
                return <DrawEffectEditor params={effect.params} onChange={handleParamsChange} />;
            case 'flip':
                return <FlipEffectEditor params={effect.params} onChange={handleParamsChange} />;
            case 'shift':
                return <ShiftEffectEditor params={effect.params} onChange={handleParamsChange} />;
            case 'delete':
                return <DeleteEffectEditor params={effect.params} onChange={handleParamsChange} />;
            case 'discard':
                return <DiscardEffectEditor params={effect.params} onChange={handleParamsChange} />;
            case 'return':
                return <ReturnEffectEditor params={effect.params} onChange={handleParamsChange} />;
            case 'play':
                return <PlayEffectEditor params={effect.params} onChange={handleParamsChange} />;
            case 'rearrange_protocols':
            case 'swap_protocols':
                return <ProtocolEffectEditor params={effect.params} onChange={handleParamsChange} />;
            case 'reveal':
            case 'give':
                return <RevealEffectEditor params={effect.params} onChange={handleParamsChange} />;
            default:
                return <div>Unbekannter Effekt-Typ</div>;
        }
    };

    return <div className="effect-editor">{renderEditor()}</div>;
};
