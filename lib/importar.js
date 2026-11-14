// Importa a build para o cliente do LoL: página de runas, conjunto de itens e (no champ select) feitiços.
// Tudo passa pela API local do cliente, como a tela de runas e a loja do próprio jogo.
//
// Runas: o Draft Lab usa uma página só dele, chamada "Runas Draft Lab". Se ela já existe, é trocada.
//        Se não existe e não há página livre, o app NÃO apaga nada sozinho: mostra as suas páginas e
//        só apaga a que você escolher.
// Itens: um conjunto "Draft Lab: Campeão (rota)" aparece na loja do jogo para aquele campeão.
//        Importar de novo troca o conjunto do mesmo campeão; os seus conjuntos ficam como estão.
const ROLE_PT = { T: 'Topo', J: 'Selva', M: 'Meio', A: 'Atirador', S: 'Suporte' };
const PREFIX = 'Draft Lab';

// Nome fixo da página do app. Páginas antigas "Draft Lab: ..." também contam como do app.
export const PAGE_NAME = 'Runas Draft Lab';
const isMine = (p) => p.isDeletable !== false && (p.name === PAGE_NAME || String(p.name || '').startsWith(PREFIX));

// Sem página livre: a tela mostra as suas páginas e você escolhe qual o app pode apagar.
export class PaginasCheias extends Error {
  constructor(paginas) {
    super('Suas páginas de runas estão todas ocupadas. Escolha uma para o Draft Lab apagar e criar a página "Runas Draft Lab" no lugar.');
    this.code = 'PAGINAS_CHEIAS';
    this.paginas = paginas;
  }
}

// apagar: id de uma página sua que você escolheu na tela para dar lugar à do app.
export async function importRunes(lcu, champName, role, r, { apagar = null } = {}) {
  const page = { name: PAGE_NAME, primaryStyleId: r.pri, subStyleId: r.sub, selectedPerkIds: [...r.perks, ...r.shards], current: true };
  const pages = (await lcu.request('GET', '/lol-perks/v1/pages')) || [];
  const mine = pages.find(isMine);
  if (mine) await lcu.request('DELETE', `/lol-perks/v1/pages/${mine.id}`);
  else if (apagar != null) {
    const alvo = pages.find((p) => String(p.id) === String(apagar));
    if (!alvo || alvo.isDeletable === false) throw new Error('Essa página não existe mais ou não pode ser apagada. Escolha outra.');
    await lcu.request('DELETE', `/lol-perks/v1/pages/${alvo.id}`);
  } else {
    const inv = await lcu.request('GET', '/lol-perks/v1/inventory').catch(() => null);
    const editable = pages.filter((p) => p.isDeletable !== false && p.isEditable !== false);
    if (inv?.ownedPageCount != null && editable.length >= inv.ownedPageCount) {
      throw new PaginasCheias(editable.map((p) => ({ id: p.id, nome: p.name || 'Sem nome', atual: !!p.current })));
    }
  }
  await lcu.request('POST', '/lol-perks/v1/pages', page);
  return `Página "${PAGE_NAME}" criada e selecionada${champName ? ` (${champName}${ROLE_PT[role] ? ' · ' + ROLE_PT[role] : ''})` : ''}.`;
}

export async function importItemSet(lcu, champ, role, b, itemName = (id) => String(id)) {
  const me = await lcu.request('GET', '/lol-summoner/v1/current-summoner');
  if (!me?.summonerId) throw new Error('Não achei a sua conta no cliente.');
  const path = `/lol-item-sets/v1/item-sets/${me.summonerId}/sets`;
  const cur = (await lcu.request('GET', path)) || {};
  const title = `${PREFIX}: ${champ.name} (${ROLE_PT[role] || role})`;
  const block = (type, ids) => ({ type, items: ids.map((id) => ({ id: String(id), count: 1 })) });
  const blocks = [];
  if (b.iniciais?.ids?.length) blocks.push(block('Itens iniciais', b.iniciais.ids));
  if (b.bota) blocks.push(block('Bota', [b.bota.id]));
  if (b.core?.ids?.length) blocks.push(block(`Itens principais (${b.core.ids.map(itemName).join(' > ')})`.slice(0, 60), b.core.ids));
  else if (b.itens?.length) blocks.push(block('Itens mais comuns', b.itens.slice(0, 4).map((x) => x.id)));
  const late = [...(b.quarto || []), ...(b.quinto || [])].map((x) => x.id).filter((id, i, a) => a.indexOf(id) === i);
  if (late.length) blocks.push(block('4º e 5º item (situacionais)', late));
  if (!blocks.length) throw new Error('Ainda não há itens suficientes deste campeão na coleta.');
  const set = {
    title, type: 'custom', map: 'any', mode: 'any', sortrank: 0, startedFrom: 'blank', priority: false,
    uid: `draftlab-${champ.key}-${role}`,
    associatedChampions: [Number(champ.key)], associatedMaps: [11],
    blocks,
  };
  // Troca só o conjunto do Draft Lab deste campeão; os outros ficam
  const itemSets = (cur.itemSets || []).filter((s) => s.uid !== set.uid && s.title !== title);
  await lcu.request('PUT', path, { ...cur, accountId: cur.accountId ?? me.accountId, itemSets: [...itemSets, set], timestamp: Date.now() });
  return `Conjunto "${title}" criado na loja do jogo.`;
}

// Feitiços só mudam durante o champ select. O Flash fica na tecla em que você já usa.
export async function importSpells(lcu, ids) {
  if (lcu.flow !== 'ChampSelect' || !lcu.session) return null;
  const sel = await lcu.request('GET', '/lol-champ-select/v1/session').catch(() => null);
  const me = sel?.myTeam?.find((p) => p.cellId === sel.localPlayerCellId);
  let [a, b] = ids;
  if (me) {
    const flashOn = me.spell1Id === 4 ? 1 : me.spell2Id === 4 ? 2 : 0;
    if (flashOn && (a === 4 || b === 4)) { const other = a === 4 ? b : a; [a, b] = flashOn === 1 ? [4, other] : [other, 4]; }
  }
  await lcu.request('PATCH', '/lol-champ-select/v1/session/my-selection', { spell1Id: a, spell2Id: b });
  return 'Feitiços trocados no champ select.';
}
