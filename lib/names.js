// Liga nomes escritos de jeitos diferentes ao nome oficial do campeão ("Kai'Sa", "kaisa", "MonkeyKing" -> "Wukong").
import { norm } from './util.js';

const ALIASES = {
  monkeyking: 'wukong', nunu: 'nunuwillump', renata: 'renataglasc', jarvan: 'jarvaniv',
  mundo: 'drmundo', tf: 'twistedfate', mf: 'missfortune', ksante: 'ksante',
};

export function makeResolver(champions) {
  const byNorm = {};
  for (const c of champions) { byNorm[norm(c.name)] = c.name; byNorm[norm(c.id)] = c.name; }
  for (const [a, b] of Object.entries(ALIASES)) if (byNorm[b]) byNorm[a] = byNorm[b];
  const keys = Object.keys(byNorm).sort((a, b) => b.length - a.length);
  return (text) => {
    const n = norm(text);
    if (!n) return null;
    if (byNorm[n]) return byNorm[n];
    const k = keys.find((k) => k.length >= 3 && n.startsWith(k));
    return k ? byNorm[k] : null;
  };
}
