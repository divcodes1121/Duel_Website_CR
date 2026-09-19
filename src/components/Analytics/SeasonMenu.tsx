import { Dropdown } from '../ui/dropdown-menu-14';
import { CalendarIcon } from '../Dashboard/icons';
import { SEASONS, type Season } from './playerData';

/* The season control — the shared `Dropdown` now (2026-09-20).
 *
 * It was the first hand-built dropdown in the app, made because a native
 * <select>'s OPEN list is drawn by the operating system and ignored the theme.
 * Every select-style control uses one component now, so this is a thin
 * wrapper that keeps its name and props: the caller did not have to change.
 *
 * `align="end"`: it sits at the right end of the query row, so a panel pinned
 * to its left edge would hang off a narrow window. The component clamps to the
 * viewport either way.
 */

const WHAT: Record<Season, string> = {
  /* Seasons are calendar months keyed to the player's LATEST STORED battle,
     not to today — see `seasonWindow` — and the rows say so. */
  'Current Season': 'The month of their latest stored battle',
  'Last Season': 'The calendar month before that',
  'All Time': 'Every battle stored for this player',
};

export function SeasonMenu({
  value,
  onChange,
  className,
}: {
  value: Season;
  onChange: (s: Season) => void;
  className?: string;
}) {
  return (
    <Dropdown<Season>
      className={className}
      size="sm"
      align="end"
      caption="Season"
      icon={<CalendarIcon />}
      heading="Season"
      subheading="Which window of battles every figure is read from"
      value={value}
      onChange={onChange}
      options={SEASONS.map((s) => ({ value: s, label: s, description: WHAT[s] }))}
    />
  );
}
