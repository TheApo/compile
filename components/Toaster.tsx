/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Player } from '../types';

interface ToasterProps {
  message: string;
  player: Player;
}

export function Toaster({ message, player }: ToasterProps) {
  return (
    <div className={`toaster toaster-${player}`}>
      {message}
    </div>
  );
}
