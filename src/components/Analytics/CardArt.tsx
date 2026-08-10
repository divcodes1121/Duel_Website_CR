import { useState } from 'react';
import {
  CARDS_BY_KEY,
  getCardIconUrl,
  getEvolutionIconUrl,
  getHeroIconUrl,
} from '../../data/cards';

/**
 * One card icon, drawn with its EVOLUTION or HERO art when that is how the deck
 * actually fields it.
 *
 * The variant is never guessed. It comes from the bot's `player_evo` column,
 * which records what the Clash Royale payload asserted — `[card_key, level,
 * art]` with `art` already resolved to 'evolution' or 'hero'.
 *
 * A deck's first THREE positions are the special slots (evolution / hero /
 * champion), so only those can carry art: measured over 795 decks whose payload
 * carried marks, all 795 had every mark inside slots 0-2. Decks are therefore
 * rendered in payload order, not in deck-hash order — the hash is alphabetical
 * and would scatter the special slots through the row.
 *
 * Only 42 evolutions and 16 heroes have art, and a card can be marked without a
 * PNG existing, so a failed load falls back to the base card rather than
 * leaving a hole.
 */
export type ArtVariant = 'evolution' | 'hero';

function urlFor(key: string, variant: ArtVariant | undefined): string {
  if (variant === 'evolution') return getEvolutionIconUrl(key);
  if (variant === 'hero') return getHeroIconUrl(key);
  return getCardIconUrl(key);
}

export function CardArt({
  card,
  variant,
  inferred,
  className,
}: {
  card: string;
  variant?: ArtVariant;
  /** The variant was guessed from slot position, not observed. Said out loud
   *  in the tooltip rather than presented as fact. */
  inferred?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const effective = failed ? undefined : variant;
  const name = CARDS_BY_KEY.get(card)?.name ?? card.replace(/-/g, ' ');
  const label = effective
    ? `${name} (${effective}${inferred ? ', from slot position' : ''})`
    : name;

  return (
    <img
      src={urlFor(card, effective)}
      alt={label}
      title={label}
      loading="lazy"
      draggable={false}
      className={className}
      data-variant={effective}
      data-inferred={effective && inferred ? '' : undefined}
      onError={() => !failed && setFailed(true)}
    />
  );
}
