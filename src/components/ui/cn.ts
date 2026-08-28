/* The shadcn `cn` helper, minus the Tailwind class merging.
 *
 * `clsx` + `tailwind-merge` exist to resolve CONFLICTING Tailwind utilities
 * (`p-2 p-4` -> `p-4`). This project has no Tailwind, so there is nothing to
 * merge and the honest implementation is a filtered join. Adding two packages
 * to dedupe classes that are never generated would be cargo cult.
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
