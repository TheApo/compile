/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Card {
    protocol: string;
    value: number;
    top: string;
    middle: string;
    bottom: string;
    keywords: Record<string, boolean>;
}

export const cards: Card[] = [
    {
        protocol: "Apathy",
        value: 0,
        top: "Your total value in this line is increased by 1 for each face-down card in this line.",
        middle: "",
        bottom: "",
        keywords: {}
    },
    {
        protocol: "Apathy",
        value: 1,
        top: "",
        middle: "Flip all other face-up cards in this line.",
        bottom: "",
        keywords: { flip: true }
    },
    {
        protocol: "Apathy",
        value: 2,
        top: "Ignore all middle commands of cards in this line.",
        middle: "",
        bottom: "<div><span class='emphasis'>When this card would be covered:</span> First, flip this card.</div>",
        keywords: { flip: true }
    },
    {
        protocol: "Apathy",
        value: 3,
        top: "",
        middle: "Flip 1 of your opponent's face-up cards.",
        bottom: "",
        keywords: { flip: true }
    },
    {
        protocol: "Apathy",
        value: 4,
        top: "",
        middle: "You may flip 1 of your face-up covered cards.",
        bottom: "",
        keywords: { flip: true }
    },
    {
        protocol: "Apathy",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Darkness",
        value: 0,
        top: "",
        middle: "Draw 3 cards. Shift 1 of your opponent's covered cards.",
        bottom: "",
        keywords: { draw: true, shift: true }
    },
    {
        protocol: "Darkness",
        value: 1,
        top: "",
        middle: "Flip 1 of your opponent's cards. You may shift that card.",
        bottom: "",
        keywords: { flip: true, shift: true }
    },
    {
        protocol: "Darkness",
        value: 2,
        top: "All face-down cards in this stack have a value of 4.",
        middle: "You may flip 1 covered card in this line.",
        bottom: "",
        keywords: { flip: true }
    },
    {
        protocol: "Darkness",
        value: 3,
        top: "",
        middle: "Play 1 card face-down in another line.",
        bottom: "",
        keywords: { play: true }
    },
    {
        protocol: "Darkness",
        value: 4,
        top: "",
        middle: "Shift 1 face-down card.",
        bottom: "",
        keywords: { shift: true }
    },
    {
        protocol: "Darkness",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Death",
        value: 0,
        top: "",
        middle: "Delete 1 card from each other line.",
        bottom: "",
        keywords: { delete: true }
    },
    {
        protocol: "Death",
        value: 1,
        top: "<div><span class='emphasis'>Start:</span> You may draw 1 card. If you do, delete 1 other card, then delete this card.</div>",
        middle: "",
        bottom: "",
        keywords: { draw: true, delete: true }
    },
    {
        protocol: "Death",
        value: 2,
        top: "",
        middle: "Delete all cards in 1 line with values of 1 or 2.",
        bottom: "",
        keywords: { delete: true }
    },
    {
        protocol: "Death",
        value: 3,
        top: "",
        middle: "Delete 1 face-down card.",
        bottom: "",
        keywords: { delete: true }
    },
    {
        protocol: "Death",
        value: 4,
        top: "",
        middle: "Delete a card with a value of 0 or 1.",
        bottom: "",
        keywords: { delete: true }
    },
    {
        protocol: "Death",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Fire",
        value: 0,
        top: "",
        middle: "Flip 1 other card. Draw 2 cards.",
        bottom: "<div><span class='emphasis'>When this card would be covered:</span> First, draw 1 card and flip 1 other card.</div>",
        keywords: { draw: true, flip: true }
    },
    {
        protocol: "Fire",
        value: 1,
        top: "",
        middle: "Discard 1 card. If you do, delete 1 card.",
        bottom: "",
        keywords: { delete: true, discard: true }
    },
    {
        protocol: "Fire",
        value: 2,
        top: "",
        middle: "Discard 1 card. If you do, return 1 card.",
        bottom: "",
        keywords: { discard: true, return: true }
    },
    {
        protocol: "Fire",
        value: 3,
        top: "",
        middle: "",
        bottom: "<div><span class='emphasis'>End:</span> You may discard 1 card. If you do, flip 1 card.</div>",
        keywords: { discard: true, flip: true }
    },
    {
        protocol: "Fire",
        value: 4,
        top: "",
        middle: "Discard 1 or more cards. Draw the amount discarded plus 1.",
        bottom: "",
        keywords: { discard: true, draw: true }
    },
    {
        protocol: "Fire",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Gravity",
        value: 0,
        top: "",
        middle: "For every 2 cards in this line, play the top card of your deck face-down under this card.",
        bottom: "",
        keywords: { play: true }
    },
    {
        protocol: "Gravity",
        value: 1,
        top: "",
        middle: "Draw 2 cards. Shift 1 card either to or from this line.",
        bottom: "",
        keywords: { draw: true, shift: true }
    },
    {
        protocol: "Gravity",
        value: 2,
        top: "",
        middle: "Flip 1 card. Shift that card to this line.",
        bottom: "",
        keywords: { flip: true, shift: true }
    },
    {
        protocol: "Gravity",
        value: 4,
        top: "",
        middle: "Shift 1 face-down card to this line.",
        bottom: "",
        keywords: { shift: true }
    },
    {
        protocol: "Gravity",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Gravity",
        value: 6,
        top: "",
        middle: "Your opponent plays the top card of their deck face-down in this line.",
        bottom: "",
        keywords: { play: true }
    },
    {
        protocol: "Hate",
        value: 0,
        top: "",
        middle: "Delete 1 card.",
        bottom: "",
        keywords: { delete: true }
    },
    {
        protocol: "Hate",
        value: 1,
        top: "",
        middle: "Discard 3 cards. Delete 1 card. Delete 1 card.",
        bottom: "",
        keywords: { delete: true, discard: true }
    },
    {
        protocol: "Hate",
        value: 2,
        top: "",
        middle: "Delete your highest value uncovered card. Delete your opponent's highest value uncovered card.",
        bottom: "",
        keywords: { delete: true }
    },
    {
        protocol: "Hate",
        value: 3,
        top: "<div><span class='emphasis'>After you delete cards:</span> Draw 1 card.</div>",
        middle: "",
        bottom: "",
        keywords: { draw: true }
    },
    {
        protocol: "Hate",
        value: 4,
        top: "",
        middle: "",
        bottom: "<div><span class='emphasis'>When this card would be covered:</span> First, delete the lowest value covered card in this line.</div>",
        keywords: { delete: true }
    },
    {
        protocol: "Hate",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Life",
        value: 0,
        top: "",
        middle: "Play the top card of your deck face-down in each line where you have a card.",
        bottom: "<div><span class='emphasis'>When this card would be covered:</span> First, delete this card.</div>",
        keywords: { delete: true, play: true }
    },
    {
        protocol: "Life",
        value: 1,
        top: "",
        middle: "Flip 1 card. Flip 1 card.",
        bottom: "",
        keywords: { flip: true }
    },
    {
        protocol: "Life",
        value: 2,
        top: "",
        middle: "Draw 1 card. You may flip 1 face-down card.",
        bottom: "",
        keywords: { draw: true, flip: true }
    },
    {
        protocol: "Life",
        value: 3,
        top: "",
        middle: "",
        bottom: "<div><span class='emphasis'>When this card would be covered:</span> First, play the top card of your deck face-down in another line.</div>",
        keywords: { play: true }
    },
    {
        protocol: "Life",
        value: 4,
        top: "",
        middle: "If this card is covering a card, draw 1 card.",
        bottom: "",
        keywords: { draw: true }
    },
    {
        protocol: "Life",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Light",
        value: 0,
        top: "",
        middle: "Flip 1 card. Draw cards equal to that card's value.",
        bottom: "",
        keywords: { draw: true, flip: true }
    },
    {
        protocol: "Light",
        value: 1,
        top: "",
        middle: "",
        bottom: "<div><span class='emphasis'>End:</span> Draw 1 card.</div>",
        keywords: { draw: true }
    },
    {
        protocol: "Light",
        value: 2,
        top: "",
        middle: "Draw 2 cards. Reveal 1 face-down card. You may shift or flip that card.",
        bottom: "",
        keywords: { draw: true, flip: true, reveal: true, shift: true }
    },
    {
        protocol: "Light",
        value: 3,
        top: "",
        middle: "Shift all face-down cards in this line to another line.",
        bottom: "",
        keywords: { shift: true }
    },
    {
        protocol: "Light",
        value: 4,
        top: "",
        middle: "Your opponent reveals their hand.",
        bottom: "",
        keywords: { reveal: true }
    },
    {
        protocol: "Light",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Love",
        value: 1,
        top: "",
        middle: "Draw the top card of your opponent's deck.",
        bottom: "<div><span class='emphasis'>End:</span> You may give 1 card from your hand to your opponent. If you do, draw 2 cards.</div>",
        keywords: { draw: true, give: true }
    },
    {
        protocol: "Love",
        value: 2,
        top: "",
        middle: "Your opponent draws 1 card. Refresh.",
        bottom: "",
        keywords: { draw: true, refresh: true }
    },
    {
        protocol: "Love",
        value: 3,
        top: "",
        middle: "Take 1 random card from your opponent's hand. Give 1 card from your hand to your opponent.",
        bottom: "",
        keywords: { give: true, take: true }
    },
    {
        protocol: "Love",
        value: 4,
        top: "",
        middle: "Reveal 1 card from your hand. Flip 1 card.",
        bottom: "",
        keywords: { flip: true, reveal: true }
    },
    {
        protocol: "Love",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Love",
        value: 6,
        top: "",
        middle: "Your opponent draws 2 cards.",
        bottom: "",
        keywords: { draw: true }
    },
    {
        protocol: "Metal",
        value: 0,
        top: "Your opponent's total value in this line is reduced by 2.",
        middle: "Flip 1 card.",
        bottom: "",
        keywords: { flip: true }
    },
    {
        protocol: "Metal",
        value: 1,
        top: "",
        middle: "Draw 2 cards. Your opponent cannot compile next turn.",
        bottom: "",
        keywords: { draw: true }
    },
    {
        protocol: "Metal",
        value: 2,
        top: "Your opponent cannot play cards face-down in this line.",
        middle: "",
        bottom: "",
        keywords: {}
    },
    {
        protocol: "Metal",
        value: 3,
        top: "",
        middle: "Draw 1 card. Delete all cards in 1 other line with 8 or more cards.",
        bottom: "",
        keywords: { delete: true, draw: true }
    },
    {
        protocol: "Metal",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Metal",
        value: 6,
        top: "<div><span class='emphasis'>When this card would be covered or flipped:</span> First, delete this card.</div>",
        middle: "",
        bottom: "",
        keywords: { delete: true }
    },
    {
        protocol: "Plague",
        value: 0,
        top: "",
        middle: "Your opponent discards 1 card.",
        bottom: "Your opponent cannot play cards in this line.",
        keywords: { discard: true }
    },
    {
        protocol: "Plague",
        value: 1,
        top: "<div><span class='emphasis'>After your opponent discards cards:</span> Draw 1 card.</div>",
        middle: "Your opponent discards 1 card.",
        bottom: "",
        keywords: { discard: true, draw: true }
    },
    {
        protocol: "Plague",
        value: 2,
        top: "",
        middle: "Dicard 1 or more cards. Your opponent discards the amount of cards discarded plus 1.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Plague",
        value: 3,
        top: "",
        middle: "Flip each other face-up card.",
        bottom: "",
        keywords: { flip: true }
    },
    {
        protocol: "Plague",
        value: 4,
        top: "",
        middle: "",
        bottom: "<div><span class='emphasis'>End:</span> Your opponent deletes 1 of their face-down cards. You may flip this card.</div>",
        keywords: { delete: true, flip: true }
    },
    {
        protocol: "Plague",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Psychic",
        value: 0,
        top: "",
        middle: "Draw 2 cards. Your opponent discards 2 cards, then reveals their hand.",
        bottom: "",
        keywords: { discard: true, draw: true, reveal: true }
    },
    {
        protocol: "Psychic",
        value: 1,
        top: "Your opponent can only play cards face-down.",
        middle: "",
        bottom: "<div><span class='emphasis'>Start:</span> Flip this card.</div>",
        keywords: { flip: true }
    },
    {
        protocol: "Psychic",
        value: 2,
        top: "",
        middle: "Your opponent discards 2 cards. Rearrange their protocols.",
        bottom: "",
        keywords: { discard: true, rearrange: true }
    },
    {
        protocol: "Psychic",
        value: 3,
        top: "",
        middle: "Your opponent discards 1 card. Shift 1 of their cards.",
        bottom: "",
        keywords: { discard: true, shift: true }
    },
    {
        protocol: "Psychic",
        value: 4,
        top: "",
        middle: "",
        bottom: "<div><span class='emphasis'>End:</span> You may return 1 of your opponent's cards. If you do, flip this card.</div>",
        keywords: { flip: true, return: true }
    },
    {
        protocol: "Psychic",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Speed",
        value: 0,
        top: "",
        middle: "Play 1 card.",
        bottom: "",
        keywords: { play: true }
    },
    {
        protocol: "Speed",
        value: 1,
        top: "<div><span class='emphasis'>After you clear cache:</span> Draw 1 card.</div>",
        middle: "Draw 2 cards.",
        bottom: "",
        keywords: { draw: true }
    },
    {
        protocol: "Speed",
        value: 2,
        top: "<div><span class='emphasis'>When this card would be deleted by compiling:</span> Shift this card, even if this card is covered.</div>",
        middle: "",
        bottom: "",
        keywords: { shift: true }
    },
    {
        protocol: "Speed",
        value: 3,
        top: "",
        middle: "Shift 1 of your other cards.",
        bottom: "<div><span class='emphasis'>End:</span> You may shift 1 of your cards. If you do, flip this card.</div>",
        keywords: { flip: true, shift: true }
    },
    {
        protocol: "Speed",
        value: 4,
        top: "",
        middle: "Shift 1 of your opponent's face-down cards.",
        bottom: "",
        keywords: { shift: true }
    },
    {
        protocol: "Speed",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Spirit",
        value: 0,
        top: "",
        middle: "Refresh. Draw 1 card.",
        bottom: "Skip your check cache phase.",
        keywords: { draw: true, refresh: true }
    },
    {
        protocol: "Spirit",
        value: 1,
        top: "You can play cards in any line.",
        middle: "Draw 2 cards.",
        bottom: "<div><span class='emphasis'>Start:</span> Either discard 1 card or flip this card.</div>",
        keywords: { discard: true, draw: true, flip: true }
    },
    {
        protocol: "Spirit",
        value: 2,
        top: "",
        middle: "You may flip 1 card.",
        bottom: "",
        keywords: { flip: true }
    },
    {
        protocol: "Spirit",
        value: 3,
        top: "<div><span class='emphasis'>After you draw cards:</span> You may shift this card, even if this card is covered.</div>",
        middle: "",
        bottom: "",
        keywords: { shift: true }
    },
    {
        protocol: "Spirit",
        value: 4,
        top: "",
        middle: "Swap the positions of 2 of your protocols",
        bottom: "",
        keywords: { swap: true }
    },
    {
        protocol: "Spirit",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
    {
        protocol: "Water",
        value: 0,
        top: "",
        middle: "Flip 1 other card. Flip this card.",
        bottom: "",
        keywords: { flip: true }
    },
    {
        protocol: "Water",
        value: 1,
        top: "",
        middle: "Play the top card of your deck face-down in each other line.",
        bottom: "",
        keywords: { play: true }
    },
    {
        protocol: "Water",
        value: 2,
        top: "",
        middle: "Draw 2 cards. Rearrange your protocols.",
        bottom: "",
        keywords: { draw: true, rearrange: true }
    },
    {
        protocol: "Water",
        value: 3,
        top: "",
        middle: "Return all cards with a value of 2 in 1 line.",
        bottom: "",
        keywords: { return: true }
    },
    {
        protocol: "Water",
        value: 4,
        top: "",
        middle: "Return 1 of your cards.",
        bottom: "",
        keywords: { return: true }
    },
    {
        protocol: "Water",
        value: 5,
        top: "",
        middle: "You discard 1 card.",
        bottom: "",
        keywords: { discard: true }
    },
];


const protocolSet = new Set(cards.map(card => card.protocol));
export const uniqueProtocols = Array.from(protocolSet).sort();