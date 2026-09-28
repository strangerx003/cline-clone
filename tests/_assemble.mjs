import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

// Temp helper: concatenates styles.part-NN.css -> styles.css (redesign build step).
const root = new URL('../', import.meta.url);
const parts = readdirSync(root).filter((f) => /^styles\.part-\d+\.css$/.test(f)).sort();
if (parts.length !== 10) {
  console.error(`expected 10 style parts, found ${parts.length}: ${parts.join(', ')}`);
  process.exit(1);
}
const css = parts.map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
writeFileSync(new URL('../styles.css', import.meta.url), css);
const opens = (css.match(/\{/g) || []).length;
const closes = (css.match(/\}/g) || []).length;
console.log(`assembled ${parts.length} parts -> styles.css (${css.split('\n').length} lines, ${css.length} bytes, braces ${opens}/${closes})`);
if (opens !== closes) {
  console.error('brace mismatch!');
  process.exit(1);
}
