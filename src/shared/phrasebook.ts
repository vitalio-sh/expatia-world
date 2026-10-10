/** Curated parcel-call flavour from the user's Expat Meme Phrasebook.
 * Spanish recognition phrases are paired with an English hint; none changes a
 * delivery outcome, promises a real service, or supplies a navigation fact. */
export interface DeliveryFlavor { spanish: string; translation: string; note: string }
export type DeliveryCoachMoment = 'incoming' | 'clarify' | 'lost' | 'waiting';
export type DeliveryOutcomeKind = 'received' | 'collection' | 'returned';

export const deliveryPhrasebook = {
  onboarding: { spanish: '¿Dónde estás?', translation: 'Where are you?', note: 'The classic parcel call. One clear landmark gets you started.' },
  coach: {
    incoming: { spanish: '¡Paquete!', translation: 'Parcel!', note: 'The bravest part is answering. Then it is one small direction at a time.' },
    clarify: { spanish: '¿Puede hablar más despacio?', translation: 'Can you speak more slowly?', note: 'A useful real-life lifeline. Here, ask for a sign, a corner, or what they can see.' },
    lost: { spanish: 'Vale.', translation: 'OK.', note: 'Wrong turns happen. Ask what they can see, then change one direction.' },
    waiting: { spanish: 'Un ratito.', translation: 'A little while.', note: 'The parcel is having a small city tour. Keep the next direction clear.' },
  },
  outcomes: {
    received: { spanish: '¡Paquete!', translation: 'Parcel!', note: 'One small win. One less reason to fear the intercom.' },
    collection: { spanish: 'Punto de recogida', translation: 'Pickup point', note: 'A detour, not a defeat. You still need to collect the parcel.' },
    returned: { spanish: '¿Dónde estás?', translation: 'Where are you?', note: 'The door and the parcel missed each other. Another call, another chance.' },
  },
  courier: {
    clarify: 'Una referencia clara me ahorra adivinanzas.',
    move: 'A ver si le ahorramos al paquete una visita turística.',
    received: 'Este paquete ya puede jubilarse de hacer turismo.',
  },
} as const satisfies {
  onboarding: DeliveryFlavor;
  coach: Record<DeliveryCoachMoment, DeliveryFlavor>;
  outcomes: Record<DeliveryOutcomeKind, DeliveryFlavor>;
  courier: Record<'clarify' | 'move' | 'received', string>;
};

export function deliveryCoachFlavor(moment: DeliveryCoachMoment): DeliveryFlavor { return deliveryPhrasebook.coach[moment]; }
export function deliveryOutcomeFlavor(kind: DeliveryOutcomeKind): DeliveryFlavor { return deliveryPhrasebook.outcomes[kind]; }
