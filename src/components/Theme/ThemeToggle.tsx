import { useThemeStore } from '../../state/themeStore';
import { MoonIcon, SunIcon } from '../Dashboard/icons';
import styles from './ThemeToggle.module.css';

interface ThemeToggleProps {
  /**
   * Track height. Everything else in the control is derived from it — see the
   * header of the stylesheet — so this is the only size a caller ever sets.
   * The five call sites had five different button sizes; this is where that
   * difference now lives.
   */
  size?: string;
  /** Extra positioning from the caller. Login pins its toggle to a corner. */
  className?: string;
}

/**
 * The light/dark switch, as a skeuomorphic toggle.
 *
 * Adapted from ThreeUI's `SkeuomorphicToggle`. It replaces five separate
 * buttons that each did the same thing in a different shape — a circular icon
 * button in the topbar, two `☾`/`☀` glyph buttons, and two more besides. They
 * are one component now, and the only thing that varies between call sites is
 * the `size`.
 *
 * ── IT IS A SWITCH, SO IT IS MARKED UP AS ONE ────────────────────────────
 *
 * `role="switch"` with `aria-checked`, which is what the reference uses and
 * what the old buttons did not have. That distinction is not pedantry here: a
 * button announces "Toggle theme" and tells you nothing about where you are,
 * whereas a switch announces its state, which for a control whose entire job is
 * to be in one of two states is the whole message. The thumb slides, so a
 * sighted reader gets the same information from position.
 *
 * **Checked means dark.** The label reads the state rather than the action —
 * the toggle shows DARK when dark mode is on, where the old buttons showed a
 * sun when clicking would give you light. Both conventions exist; a switch has
 * to use the first one, or its `aria-checked` and its face disagree.
 *
 * Native `<button>` keyboard behaviour is kept rather than reimplemented: Enter
 * and Space already activate it, and the reference's own `keydown` handler
 * would double-fire on a real button. Same reasoning as `TopDock`.
 */
export function ThemeToggle({ size, className }: ThemeToggleProps) {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`${styles.toggle}${className ? ` ${className}` : ''}`}
      style={size ? ({ '--h': size } as React.CSSProperties) : undefined}
      onClick={toggleTheme}
    >
      {/* The cap. Its contents are the reference's label slot — an icon and a
          word rather than the reference's "Live Sync", because a theme switch
          that says only "on" leaves you asking on for what. */}
      <span className={styles.thumb}>
        <span className={styles.label} aria-hidden="true">
          {dark ? <MoonIcon size={13} /> : <SunIcon size={13} />}
        </span>
        <span className={styles.word} aria-hidden="true">
          {dark ? 'DARK' : 'LIGHT'}
        </span>
      </span>
    </button>
  );
}
