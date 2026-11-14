// Ícones de itens, feitiços, runas e perfil, pelo Data Dragon (CDN oficial da Riot), com cache local.
import { join } from 'node:path';
import { CACHE, readJSON, writeJSON, fetchWithTimeout } from './util.js';

const DD = 'https://ddragon.leagueoflegends.com';
const FILE = join(CACHE, 'assets.json');

// { version, spells: { "4": { id: "SummonerFlash", name: "Flash" } }, runes: { "8010": { icon, name } } }
let cache = null;
export async function getAssets(version) {
  if (cache?.version === version) return cache;
  const saved = await readJSON(FILE);
  if (saved?.version === version && saved.tree) return (cache = saved); // sem a árvore de runas: versão antiga do cache
  if (!version) return (cache = saved || { version: null, spells: {}, runes: {} });
  try {
    const [sum, runes] = await Promise.all([
      fetchWithTimeout(`${DD}/cdn/${version}/data/pt_BR/summoner.json`).then((r) => r.json()),
      fetchWithTimeout(`${DD}/cdn/${version}/data/pt_BR/runesReforged.json`).then((r) => r.json()),
    ]);
    const spells = {};
    for (const s of Object.values(sum.data || {})) spells[s.key] = { id: s.id, name: s.name };
    const rmap = {};
    const tree = [];
    for (const style of runes || []) {
      rmap[style.id] = { icon: style.icon, name: style.name };
      tree.push({ id: style.id, name: style.name, slots: (style.slots || []).map((slot) => (slot.runes || []).map((r) => r.id)) });
      for (const slot of style.slots || []) for (const r of slot.runes || []) rmap[r.id] = { icon: r.icon, name: r.name };
    }
    cache = { version, spells, runes: rmap, tree };
    await writeJSON(FILE, cache, true);
  } catch {
    cache = saved || { version: null, spells: {}, runes: {} };
  }
  return cache;
}

// Endereço da imagem no Data Dragon. kind: item | spell | rune | profile
export async function assetUrl(kind, id, version) {
  if (kind === 'item') return `${DD}/cdn/${version}/img/item/${id}.png`;
  if (kind === 'profile') return `${DD}/cdn/${version}/img/profileicon/${id}.png`;
  const a = await getAssets(version);
  if (kind === 'spell') { const s = a.spells[id]; return s ? `${DD}/cdn/${version}/img/spell/${s.id}.png` : null; }
  if (kind === 'rune') { const r = a.runes[id] || (SHARDS[id] && { icon: SHARDS[id][1] }); return r ? `${DD}/cdn/img/${r.icon}` : null; }
  return null;
}

// Preço total de cada item (gold.total do Data Dragon), para somar o valor dos itens na partida.
const ITEMS = join(CACHE, 'items.json');
let items = null;
export async function getItemPrices(version) {
  if (items?.version === version) return items.prices;
  const saved = await readJSON(ITEMS);
  if (saved?.version === version || (!version && saved)) return (items = saved).prices;
  if (!version) return {};
  try {
    const data = await fetchWithTimeout(`${DD}/cdn/${version}/data/pt_BR/item.json`).then((r) => r.json());
    const prices = {};
    for (const [id, it] of Object.entries(data.data || {})) prices[id] = it.gold?.total ?? 0;
    items = { version, prices };
    await writeJSON(ITEMS, items, true);
    return prices;
  } catch {
    return saved?.prices || {};
  }
}

// O que o Draft Lab precisa saber de cada item para montar builds: nome, preço, se é bota e se é item
// completo (lendário). Fica em cache por versão do jogo.
const ITEMDATA = join(CACHE, 'itemdata.json');
let itemData = null;
export function classifyItems(data) {
  const out = {};
  for (const [id, it] of Object.entries(data || {})) {
    if (it.maps && it.maps['11'] === false) continue; // só itens de Summoner's Rift
    const tags = it.tags || [];
    const total = it.gold?.total ?? 0;
    const boots = tags.includes('Boots') && id !== '1001';
    const finished = !(it.into || []).length || (it.into || []).every((x) => Number(x) >= 200000); // upgrades especiais não contam
    const legend = !boots && finished && total >= 2000 && !tags.includes('Consumable') && !tags.includes('Trinket') && it.gold?.purchasable !== false;
    const consumable = tags.includes('Consumable') || tags.includes('Trinket');
    // s: item de suporte (missão de ouro); c: componente (parte de um item maior, comprado no caminho)
    const support = tags.includes('GoldPer') && !boots;
    const comp = !boots && !legend && !support && !consumable && total > 0 && (it.into || []).length > 0;
    out[id] = { n: it.name, g: total, b: boots, l: legend, s: support, c: comp };
  }
  return out;
}
export async function getItemData(version) {
  if (itemData?.version === version && itemData.fmt === 2) return itemData.items;
  const saved = await readJSON(ITEMDATA);
  if ((saved?.version === version && saved.fmt === 2) || (!version && saved)) return (itemData = saved).items;
  if (!version) return {};
  try {
    const data = await fetchWithTimeout(`${DD}/cdn/${version}/data/pt_BR/item.json`).then((r) => r.json());
    itemData = { version, fmt: 2, items: classifyItems(data.data) };
    await writeJSON(ITEMDATA, itemData, true);
    return itemData.items;
  } catch {
    return saved?.items || {};
  }
}

// Fragmentos de atributo: não estão no runesReforged.json, então ficam aqui (nome e ícone do Data Dragon).
export const SHARDS = {
  5008: ['Força adaptativa', 'perk-images/StatMods/StatModsAdaptiveForceIcon.png'],
  5005: ['Velocidade de ataque', 'perk-images/StatMods/StatModsAttackSpeedIcon.png'],
  5007: ['Aceleração de habilidade', 'perk-images/StatMods/StatModsCDRScalingIcon.png'],
  5010: ['Velocidade de movimento', 'perk-images/StatMods/StatModsMovementSpeedIcon.png'],
  5001: ['Vida por nível', 'perk-images/StatMods/StatModsHealthScalingIcon.png'],
  5011: ['Vida', 'perk-images/StatMods/StatModsHealthPlusIcon.png'],
  5013: ['Tenacidade e resistência a lentidão', 'perk-images/StatMods/StatModsTenacityIcon.png'],
  5002: ['Armadura', 'perk-images/StatMods/StatModsArmorIcon.png'],
  5003: ['Resistência mágica', 'perk-images/StatMods/StatModsMagicResIcon.MagicResist_Fix.png'],
};
// Linhas dos fragmentos, na ordem da tela de runas do cliente
export const SHARD_ROWS = [[5008, 5005, 5007], [5008, 5010, 5001], [5011, 5013, 5001]];
