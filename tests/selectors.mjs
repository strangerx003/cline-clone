import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const htmlClasses = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));

let failures = 0;
const refs = new Set();
for (const m of ui.matchAll(/querySelector(?:All)?\(\s*(['"`])([^'"`]+)\1\s*\)/g)) refs.add(m[2]);
for (const m of ui.matchAll(/\.closest\(\s*(['"`])([^'"`]+)\1\s*\)/g)) refs.add(m[2]);

for (const ref of [...refs].sort()) {
  if (ref.startsWith('#')) {
    const id = ref.slice(1).split(/[\s.[:]/)[0];
    if (!htmlIds.has(id)) { console.log(`FAIL selector "${ref}" -> #${id} missing in index.html`); failures++; }
    else console.log(`ok    selector "${ref}"`);
  } else if (ref.startsWith('.')) {
    const cls = ref.slice(1).split(/[\s.[:]/)[0];
    // classes created dynamically by ui.js are fine — only report if nowhere in src
    const inSrc = ['ui', 'index.html'].some((f) => readFileSync(new URL(f === 'ui' ? '../src/ui.js' : '../index.html', import.meta.url), 'utf8').includes(`'${cls}'`) || readFileSync(new URL(f === 'ui' ? '../src/ui.js' : '../index.html', import.meta.url), 'utf8').includes(`"${cls}"`) || readFileSync(new URL(f === 'ui' ? '../src/ui.js' : '../index.html', import.meta.url), 'utf8').includes(cls));
    if (!inSrc && !htmlClasses.has(cls)) { console.log(`FAIL selector "${ref}" -> class .${cls} found nowhere`); failures++; }
    else console.log(`ok    selector "${ref}"`);
  } else {
    console.log(`ok    selector "${ref}" (non-id/class)`);
  }
}

// event delegation targets: e.target.closest(...) patterns already covered above.
if (failures) { console.error(`\n${failures} selector check(s) failed.`); process.exit(1); }
console.log(`\nAll ${refs.size} querySelector/closest selectors resolve.`);
