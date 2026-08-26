import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/* Two things that silently break a shader, both of which this project has now
 * done more than once.
 *
 * A shader here is a JavaScript template literal. That makes two ordinary
 * habits fatal in a way nothing reports:
 *
 *  1. A BACKTICK inside the GLSL ends the string. The parse error is then
 *     reported dozens of lines away, in whatever the rest of the file happens
 *     to look like once it is read as code. Every one of the three times this
 *     happened it was a comment quoting an identifier.
 *
 *  2. A GLSL RESERVED WORD used as a variable compiles to nothing. `patch` is
 *     a tessellation qualifier in GLSL ES 3.0; naming a float that made the
 *     fragment shader fail to compile, which made the component's catch remove
 *     its canvas, which made the effect simply not exist — no console error,
 *     no missing element, nothing to notice.
 *
 * Both are cheap to test and expensive to find, which is the whole argument.
 */

const DIR = join(process.cwd(), 'src', 'three');

/** Every `const NAME = \`...\`` block in a file that reads like a shader. */
function shaderLiterals(source: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /const\s+([A-Z_][A-Z0-9_]*)\s*=\s*`([\s\S]*?)`;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (/#version|void main\(\)|precision /.test(m[2])) out.push({ name: m[1], body: m[2] });
  }
  return out;
}

const files = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f));

/* GLSL ES 3.0 keeps a long reserved list. These are the ones plausible as a
   variable name in this codebase — a full list would be noise, and a name
   nobody would reach for cannot regress. */
const RESERVED = [
  'patch', 'sample', 'common', 'partition', 'active', 'filter', 'resource',
  'input', 'output', 'buffer', 'shared', 'coherent', 'volatile', 'restrict',
  'readonly', 'writeonly', 'noperspective', 'subroutine', 'this', 'class',
  'union', 'enum', 'typedef', 'template', 'namespace', 'public', 'external',
  'interface', 'long', 'short', 'half', 'fixed', 'unsigned', 'superp',
  'cast', 'asm', 'goto', 'inline', 'noinline',
];

describe('the shader literals in src/three', () => {
  const found = files.flatMap((f) =>
    shaderLiterals(readFileSync(join(DIR, f), 'utf8')).map((s) => ({ file: f, ...s })),
  );

  it('finds the shaders (so a rename cannot silently empty this suite)', () => {
    expect(found.length).toBeGreaterThanOrEqual(6);
  });

  for (const { file, name, body } of found) {
    it(`${file} ${name} contains no backtick`, () => {
      expect(body.includes('`'), `${file}:${name} — a backtick ends the literal`).toBe(false);
    });

    it(`${file} ${name} declares no GLSL reserved word`, () => {
      // Declarations only: `float patch = ...`, `vec3 sample;`. A reserved word
      // appearing inside a comment is harmless and must not fail the suite.
      const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      const declared = [
        ...stripped.matchAll(/\b(?:float|int|uint|bool|vec[234]|ivec[234]|mat[234])\s+([A-Za-z_]\w*)/g),
      ].map((m) => m[1]);
      const clash = declared.filter((d) => RESERVED.includes(d));
      expect(clash, `${file}:${name} — reserved in GLSL ES 3.0`).toEqual([]);
    });
  }
});
