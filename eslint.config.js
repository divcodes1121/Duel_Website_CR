import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  /* VENDORED REGISTRY CODE, LINTED AGAINST NOTHING.
   *
   * `src/components/ui/` holds files installed verbatim from a component
   * registry (`npx shadcn add ...`). Their deviations from upstream are listed
   * in each file's header precisely so the next update is a diff; reformatting
   * them to satisfy our rules would destroy that. The two things eslint objects
   * to here — a `@ts-ignore` and `onMouseEnter && onMouseEnter()` — are the
   * author's, and neither is ours to fix.
   *
   * `cn.ts` and `glass-dock.css` beside them are OURS and are not vendored, but
   * the directory is the boundary that is easy to reason about; anything of our
   * own that grows non-trivial belongs outside it. */
  { ignores: ['src/components/ui/glass-dock.tsx'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
)
