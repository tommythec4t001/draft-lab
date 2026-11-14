// Lista de campeões a partir do Data Dragon (CDN oficial da Riot), com cache local.
import { join } from 'node:path';
import { CACHE, DATA, norm, readJSON, writeJSON, fetchWithTimeout } from './util.js';

const DD = 'https://ddragon.leagueoflegends.com';
const CACHE_FILE = join(CACHE, 'champions.json');
const MAX_AGE = 12 * 60 * 60 * 1000; // 12 horas

// Quando um campeão não está em roles.json, deduz a rota pelas tags da Riot.
function rolesFromTags(tags = []) {
  if (tags.includes('Marksman')) return 'A';
  if (tags.includes('Support')) return 'S';
  if (tags.includes('Mage') || tags.includes('Assassin')) return 'M';
  if (tags.includes('Tank')) return 'TJ';
  return 'T';
}

async function loadRoles() {
  const raw = await readJSON(join(DATA, 'roles.json'), {});
  const map = {};
  for (const [name, r] of Object.entries(raw)) if (!name.startsWith('_')) map[norm(name)] = r;
  return map;
}

async function fromRiot() {
  const versions = await (await fetchWithTimeout(`${DD}/api/versions.json`)).json();
  const version = versions[0];
  const res = await fetchWithTimeout(`${DD}/cdn/${version}/data/pt_BR/champion.json`);
  if (!res.ok) throw new Error(`Data Dragon respondeu ${res.status}`);
  const json = await res.json();
  const champions = Object.values(json.data).map((c) => ({
    id: c.id,          // "MonkeyKing"
    name: c.name,      // "Wukong"
    key: c.key,        // número usado pela API da Riot, por exemplo "62"
    title: c.title,
    tags: c.tags,
    info: c.info,      // notas da Riot de 0 a 10: attack, defense, magic, difficulty
  }));
  return { version, fetchedAt: Date.now(), source: 'riot', champions };
}

// Sem internet e sem cache: usa só os nomes de roles.json (sem imagens).
async function fromLocalList() {
  const raw = await readJSON(join(DATA, 'roles.json'), {});
  const champions = Object.keys(raw).filter((n) => !n.startsWith('_')).map((name) => ({
    id: name.replace(/[^A-Za-z]/g, ''), name, key: null, title: '', tags: [], info: null,
  }));
  return { version: null, fetchedAt: Date.now(), source: 'local', champions };
}

export async function getChampions({ force = false } = {}) {
  let data = await readJSON(CACHE_FILE);
  const stale = !data || Date.now() - data.fetchedAt > MAX_AGE || data.source !== 'riot' || !data.champions?.[0]?.info;
  if (force || stale) {
    try {
      data = await fromRiot();
      await writeJSON(CACHE_FILE, data);
      console.log(`[campeões] ${data.champions.length} campeões carregados do patch ${data.version}`);
    } catch (err) {
      console.warn(`[campeões] Não consegui falar com a Riot (${err.message}).`, data ? 'Usando cache.' : 'Usando lista local sem imagens.');
      if (!data) data = await fromLocalList();
    }
  }
  const roles = await loadRoles();
  return {
    version: data.version,
    source: data.source,
    champions: data.champions
      .map((c) => ({ ...c, roles: roles[norm(c.name)] || rolesFromTags(c.tags) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  };
}

export const imageUrl = {
  icon: (version, id) => `${DD}/cdn/${version}/img/champion/${id}.png`,
  splash: (id) => `${DD}/cdn/img/champion/splash/${id}_0.jpg`,
  loading: (id) => `${DD}/cdn/img/champion/loading/${id}_0.jpg`,
  // Recorte quadrado do rosto, o mesmo da seleção de campeões do jogo
  tile: (id) => `${DD}/cdn/img/champion/tiles/${id}_0.jpg`,
  // Splash art enquadrada no rosto
  centered: (id) => `${DD}/cdn/img/champion/centered/${id}_0.jpg`,
};
