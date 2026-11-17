# Draft Lab

Acompanha o champ select do seu cliente do League of Legends **ao vivo** e sugere picks e bans enquanto o draft acontece. As sugestões juntam as fichas dos campeões com estatísticas de soloQ que o próprio app coleta pela API oficial da Riot.

É um projeto separado do Fearless Draft Lab (o simulador de séries profissionais). Os dois podem ficar abertos ao mesmo tempo.

## Aplicativo para Windows

O Draft Lab pode virar um aplicativo instalado, com janela própria, ícone perto do relógio e atalho na área de trabalho.

**Para montar o instalador** (só precisa de internet e do Node.js):
1. Dê dois cliques em `Montar o instalador.bat`. Na primeira vez ele baixa o Electron, a base usada por apps como Discord e VS Code. Leva alguns minutos.
2. No fim abre a pasta `dist` com o `Draft Lab Setup (versão).exe`. Rode-o para instalar.

**Como o app funciona:**
- **Fechar a janela só esconde o app.** Ele continua no ícone perto do relógio, coletando estatísticas e esperando o próximo champ select. Para fechar de vez, clique com o botão direito no ícone e em **Sair**.
- **Abre sozinho quando o champ select começa.** Dá para desligar no menu do ícone.
- **Iniciar com o Windows** (no menu do ícone): o app liga escondido junto com o PC, e a coleta de estatísticas roda sempre que o computador está ligado.
- **Histórico automático:** quando uma partida termina, o app busca o histórico sozinho, com algumas tentativas nos primeiros minutos, porque a Riot leva um tempo para publicar a partida. Ela aparece em Partidas com a nota do draft.
- **Seus dados** ficam em `%APPDATA%\Draft Lab\data` (o menu do ícone tem **Abrir a pasta de dados**). Na primeira vez o app copia sozinho os dados desta pasta: chave, estatísticas, gravações e histórico.
- O `Iniciar.bat` continua funcionando como antes, usando a pasta `data` daqui.

**Para distribuir para outras pessoas:** o instalador funciona em qualquer Windows. Como ele não tem assinatura digital, o Windows mostra um aviso do SmartScreen na primeira vez ("Mais informações", depois "Executar assim mesmo"). Cada pessoa precisa da própria chave da Riot. Para um lançamento público, o caminho é pedir à Riot uma chave de produção.

**Atenção com o OneDrive:** a montagem cria as pastas `node_modules` e `dist`, com algumas centenas de MB. Se o OneDrive estiver sincronizando esta pasta, vale mover o projeto para fora dele ou excluir essas pastas da sincronização.

## Como rodar

1. Tenha o **Node.js** versão LTS instalado (https://nodejs.org).
2. **Windows:** dê dois cliques em `Iniciar.bat`. **Mac ou Linux:** rode `npm start` dentro da pasta.
3. O navegador abre sozinho em http://localhost:3100.
4. Abra o cliente do LoL e entre num champ select. O draft aparece na hora.

Não precisa rodar `npm install`: o projeto não usa bibliotecas externas. Para desligar, feche a janela preta.

## O que aparece na tela

- **O draft ao vivo:** cada hover, ban, pick e troca no instante em que acontece, com o timer da vez.
- **Sugestões de quem está na vez:**
  - na sua vez: só campeões da sua rota que você pode usar (os seus e os da rotação grátis);
  - na vez do inimigo: o que ele pode escolher contra o seu time;
  - nos banimentos: os campeões mais perigosos para o seu time.
  Os campeões que os seus aliados já declararam não aparecem como sugestão.
  Tudo vem numa **lista só** (até 10 campeões): quem aparece em mais motivos e mais no alto sobe. Cada campeão traz etiquetas curtas com o porquê (por exemplo "Topo contra Aatrox", "Combina com Yone"); o texto completo aparece ao passar o mouse. Os que você deve evitar ficam numa linha só embaixo.
- **Leitura de cada jogador:** para o campeão travado ou em hover, quem ele vence (▲), para quem perde (▼), com quem combina (+) e o win rate na rota.
- **Análise de composição** dos dois times: dano físico x mágico, linha de frente, engage, controle de grupo, estilos e curva de força, com alertas.

As sugestões só sugerem: o app nunca escolhe nem bane nada no cliente.

**Anonimato:** como a Riot exige, só aparecem o seu nome e os de quem está no seu grupo. Os outros viram Aliado 1, Aliado 2… e Inimigo 1, Inimigo 2…. Os hovers do inimigo só aparecem quando ele trava o pick, porque o próprio cliente não mostra antes.

## Counterpicks de ADC

Os ADCs são divididos em cinco classes no arquivo `data/adc.json` (o mesmo do Fearless Draft Lab): **Lane Bully**, **Skirm**, **Poke**, **Scaler** e **Mage Bot**. Quando o inimigo já tem um ADC:

- Sem jogos de soloQ suficientes do confronto direto, a classe vale como histórico, igual às fichas: Skirm é forte contra Poke, Lane Bully é forte contra Scaler, e assim por diante. Com jogos suficientes, os números do confronto mandam.
- As prioridades sobem campeões específicos: contra Lane Bully, Jinx, Jhin e Ziggs; contra Poke, Kai'Sa, Ezreal e Kalista (a Caitlyn desce).
- Com a rota de ADC em aberto, se o time tem pouco dano físico, os ADCs de dano AD sobem; se o time é quase todo físico, os Mage Bots sobem.
- As melhores escolhas ganham a etiqueta **ADC contra …**. Quem está abaixo de 45% de vitória na situação fica de fora.
- A nota do draft também usa a classe no confronto de ADC quando não há jogos do confronto.

No aplicativo instalado, o arquivo editável fica na pasta de dados do Draft Lab, junto com as fichas.

## Counterpicks de suporte

Os suportes são divididos em seis classes no arquivo `data/suporte.json`: **Enchanter**, **Engage**, **Warden**, **Hook**, **Mage** e **Misfit**. Funciona como os counterpicks de ADC (a classe vale como histórico quando não há jogos suficientes do confronto direto, e a nota do draft também usa), com três coisas a mais:

- **Exceções** de campeão contra campeão, grupo ou classe (por exemplo, Janna ganha de Engage, Braum é bom contra Nautilus e ruim contra Rell, Pyke perde para Tanques). Cada exceção vale também ao contrário: se Braum é bom contra Nautilus, Nautilus é ruim contra Braum.
- **Dupla do bot**: Engage combina com ADC Mage Bot e Skirm; Warden combina com Scaler. Aparece em "combina com" tanto para o suporte quanto para o ADC.
- **Duplas ruins**: por exemplo, Ezreal e Yuumi, que aparecem como "combina mal com".

As sugestões ganham a etiqueta **Suporte contra …** (ou **Suporte para a dupla do bot**).

## Counterpicks do topo

Os top laners são divididos em cinco classes no arquivo `data/topo.json`, a partir do vídeo de arquétipos do topo: **Juggernaut**, **Bruiser** (divers), **Duelista** (skirmishers), **Tank** e **Ranged**. Funciona como os counterpicks de suporte (tabela + exceções que valem ao contrário; sem jogos suficientes do confronto direto, a classe vale como histórico), sem a parte de dupla, porque o topo joga sozinho.

- **Tabela:** Juggernaut ganha de Tank e perde para Ranged; Bruiser ganha de Ranged e perde para Tank; Duelista ganha de Tank; Tank ganha de Bruiser e de Ranged. No topo a diferença entre classes é pequena, por isso a tabela usa 1.5 e as exceções de campeão usam 2.
- **Exceções do vídeo:** Nasus, Pantheon, Irelia e Shen contra Jayce; Yone sofre contra Jayce; Garen bom e Sett ruim contra Jax; Irelia sofre contra Malphite e Shen; Fiora contra K'Sante; K'Sante perde para Kayle; Shen, Gnar e Teemo contra Ambessa; Gangplank e Kennen anulam a vantagem do Renekton; Darius com leve vantagem contra Renekton.
- As sugestões ganham a etiqueta **Topo contra …**, e cada classe tem uma observação nos motivos (por exemplo, Tank: "perde a rota com frequência, mas tem valor garantido no fim do jogo").

## Counterpicks do meio

Os mid laners são divididos em cinco classes no arquivo `data/meio.json`, a partir do vídeo de arquétipos do meio, do maior para o menor alcance: **Mago de Artilharia**, **Mago de Controle**, **Mago de Batalha**, **Skirmisher** e **Assassino**. Funciona como os counterpicks do topo (sem jogos suficientes do confronto direto, a classe vale como histórico; a nota do draft também usa).

- **Tabela em círculo:** Mago de Artilharia ganha de Mago de Controle e Mago de Batalha; Mago de Controle ganha de Mago de Batalha e Skirmisher; Mago de Batalha ganha de Skirmisher e Assassino; Skirmisher ganha de Assassino e Mago de Artilharia; Assassino ganha de Mago de Artilharia e Mago de Controle.
- **Exceções do vídeo:** Vex, Lissandra, Malzahar e Annie foram feitos para punir assassinos; Vladimir cura o poke do Mago de Artilharia e vai bem na rota contra ela.
- As sugestões ganham a etiqueta **Meio contra …**, com uma observação de cada classe nos motivos.

## Counterpicks da selva

Os caçadores são divididos em cinco classes no arquivo `data/selva.json`, a partir do vídeo de arquétipos da selva: **High Tempo**, **Farmer**, **Skirmisher**, **Tank** e **Assassino**.

- **A tabela vem das win rates reais do vídeo** (Mestre+), e não da teoria do começo de jogo, porque o próprio vídeo mostra que as classes "perdedoras" no começo ganham mais partidas pelo impacto ao longo do jogo. Cada ponto é 1% de vitória acima de 50%, limitado a ±2. Por isso o Tank sai na frente contra Skirmisher, Assassino e High Tempo.
- **Exceções do vídeo:** Master Yi contra Rengar (61%), Hecarim contra Qiyana (57%) e Zac contra Lee Sin (56%).
- A teoria do começo de jogo de cada classe aparece nos motivos (por exemplo, High Tempo: "forte no começo: ganha o ritmo de Farmers e Tanks com ganks garantidos").
- Sem jogos suficientes do confronto direto, a classe vale como histórico e entra na nota do draft.
- As sugestões ganham a etiqueta **Selva contra …**.

## Mais jogados dos aliados

Fora da Ranqueada Solo/Duo, o cliente mostra o nome dos aliados no champ select. Nesses casos o Draft Lab busca o histórico de cada aliado no próprio cliente do LoL (as últimas 40 partidas de Summoner's Rift) e mostra, embaixo do nome, os **3 campeões mais jogados**: na rota da pessoa, quando a rota é conhecida e ela tem pelo menos 3 jogos nela, ou no geral. Passe o mouse no ícone para ver jogos e vitórias. Os inimigos não aparecem porque o champ select nunca mostra quem eles são.

## Fearless ao vivo (partidas profissionais)

A aba **Fearless ao vivo** acompanha as partidas do CBLOL, LCK, LEC, LPL, LTA, Mundial e outras ligas pela API do lolesports (a mesma do site oficial). Não precisa de chave da Riot.

- **Lista:** partidas acontecendo agora, as terminadas mais recentes e as próximas, com filtro por liga. A série aberta atualiza sozinha a cada 20 segundos enquanto está ao vivo.
- **Travados pelo Fearless:** os campeões usados nos jogos anteriores, separados por time. No Fearless, ninguém pode repetir um campeão na série, então eles ficam fora do próximo jogo para os dois times.
- **Tier list de prioridade:** os campeões livres do próximo jogo em tiers S, A, B, C e D, do melhor para o pior pela **presença** no competitivo (em quantos jogos o campeão foi escolhido ou banido) na temporada atual, lida do gol.gg. S: 40% ou mais; A: 25% a 40%; B: 12% a 25%; C: 4% a 12%; D: menos de 4% ou fora do competitivo. Filtro por nome e rota. Em série terminada, mostra todos os campeões, com os usados na série apagados. A leitura fica guardada por 6 horas; sem internet, vale a última.
- **Cada jogo:** campeões e jogadores rota contra rota, quem leva vantagem em cada rota (pelas estatísticas de soloQ, pelas fichas e pelas classes de counterpick), a **nota do draft** dos dois lados com o porquê, e a análise de composição. No jogo ao vivo, também o ouro, os abates, as torres, os dragões e os barões.
- A API só mostra os campeões quando o jogo começa: a seleção de campeões e os bans não aparecem.
- Essa API não é documentada oficialmente pela Riot, então pode mudar sem aviso. Tudo o que depende dela fica em `lib/esports.js`.

## InHouse (draft com os 10 jogadores)

A aba **InHouse** cria uma sala de draft alternado de torneio para partidas personalizadas. Cada time recebe um link: os capitães banem e cada jogador trava o próprio campeão, pelo navegador, sem instalar nada. Séries MD3 e MD5 com Fearless, placar, escolha de lado de quem perdeu, aviso no Discord por webhook e estatísticas por campeão de todas as InHouses.

No Draft Lab, a sala abre dentro do app com as sugestões de pick e ban e a composição dos times ao lado (já sem os campeões travados pelo Fearless).

As salas ficam num servidor online (pasta `inhouse/`, na Cloudflare). Como publicar e como o bot do Discord cria salas: `inhouse/LEIA-ME.md`.

## Configs LoL (+FPS)

Na **engrenagem** do topo, botão **Configs LoL**. Precisa do cliente do LoL aberto (as mudanças passam por ele, como na tela de configurações do próprio cliente) e vale a partir da próxima partida. Não funciona no meio de uma partida, porque o jogo grava as configurações dele ao fechar.

- **+FPS:** sombras desligadas, ambiente e efeitos no baixo, V-Sync, anti-serrilhado, contorno, grama balançando e animações da interface desligados (só abaixa: o que já estiver mais baixo fica). O cliente entra no modo de baixo desempenho e fecha durante a partida. No Windows, plano de energia **Alto desempenho** e o LoL na placa de vídeo dedicada. O limite de FPS e o modo de tela não mudam. Nada disso pede permissão de administrador.
- **Restaurar como estava:** antes de mudar, o Draft Lab guarda os valores antigos em `data/lol-config-backup.json`. O botão devolve tudo e apaga o arquivo.

## Builds, confrontos e partidas de alto elo

Na página de cada campeão (aba **Campeões**), por rota:

- **Build:** runas (a página inteira, com os fragmentos), feitiços, ordem das habilidades, itens iniciais, bota, os 3 itens principais na ordem de compra e as opções de 4º e 5º item, com a porcentagem de escolha e de vitória de cada um.
- **WPA (Win Probability Added):** quanto cada escolha soma à chance de vitória, em pontos percentuais, como no coachless.gg: a taxa de vitória de quem escolheu menos a chance que essas pessoas já tinham antes de escolher. Para itens e bota, essa chance vem do minuto e da diferença de ouro entre os times na hora da compra, numa tabela montada com as próprias partidas coletadas. Para runa principal, feitiços e item inicial, vem do confronto de rota. Assim, um item comprado só por quem já está ganhando não parece melhor do que é. A build recomendada escolhe a runa principal, o item inicial, a bota e o 1º, 2º e 3º item pelo maior WPA (com 25 escolhas ou mais; com menos, fica a mais usada). O quadro **Visão geral por WPA** mostra cada posição com as opções, o WPA e o número de escolhas. O WPA conta só as partidas coletadas a partir da versão 0.19.
- **Explorador de itens:** tabela com as categorias **Lendários**, **Componentes**, **Botas**, **Suporte** e **Inicial**, e as fases **1º, 2º, 3º e 4º+** (o item lendário que o jogador estava montando na hora da compra). Colunas: WPA, compras, % de escolha, chance de vitória antes da compra e vitórias. Clique no título de uma coluna para ordenar.
- **Explorador de runas:** a árvore principal e a secundária com o WPA e o número de escolhas de cada runa e fragmento, e em quantas partidas cada árvore foi principal ou secundária. Clique numa árvore para trocar.
- **Importar para o cliente:** cria a página de runas **Runas Draft Lab** e um conjunto de itens que aparece na loja do jogo para aquele campeão. No champ select, troca também os feitiços (o Flash fica na tecla que você já usa). Importar de novo usa sempre a mesma página e o mesmo conjunto; as suas páginas e conjuntos não são mexidos. Se todas as páginas de runas estiverem ocupadas, o app mostra as suas páginas e você escolhe qual ele pode apagar para criar a dele (só uma vez: depois ele reaproveita a Runas Draft Lab).
- **Confrontos na rota:** cartas grandes com a arte de cada campeão, em duas fileiras (bom contra e ruim contra), com a diferença de vitória em relação à média do campeão na rota e o número de jogos (15 ou mais). "Rota boa" ou "Rota ruim" vem da diferença de ouro aos 14 minutos contra o adversário. **Lista completa** mostra todos.
- **Partidas de Diamante ou acima:** as mais recentes de jogadores Diamante, Mestre, Grão-Mestre e Desafiante com o campeão, com resultado, região, adversário, Riot ID, runas, feitiços, itens, KDA e CS. Clique num confronto para ver só as partidas contra aquele campeão; clique no nome para abrir o perfil.
- **No champ select:** na aba Draft ao vivo, uma barra com o seu campeão. **Ver build para importar** mostra antes as runas (com o nome de cada uma), os feitiços e os itens que vão para o cliente; **Importar esta build** confirma.

Tudo sai das partidas da coleta de soloQ (engrenagem → Estatísticas de soloQ). Para cada partida o app baixa também a **linha do tempo** (ordem de compra, itens iniciais, habilidades e ouro aos 14 minutos), o que deixa a coleta duas vezes mais lenta. Os dados ficam em `data/soloq/builds_*.json`. Com poucas partidas no patch novo, o patch anterior entra junto.

## Campeões

A aba **Campeões** mostra todos os campeões do jogo, com filtro por nome e por rota. Clique num campeão para ver: rotas, classe de counterpick em cada rota (as mesmas regras de ADC, suporte, topo, meio e selva), dificuldade, build, confrontos, partidas de alto elo, win rate e duplas da soloQ coletada e as habilidades com recarga, custo e alcance, direto do Data Dragon.

## Leaderboard

A aba **Leaderboard** mostra o topo da ranqueada do **Brasil**, **Europa Oeste**, **Europa Nórdica e Leste** e **Coreia**, na **Solo/Duo** ou na **Flex**: Desafiante, Grão-Mestre e (quando a lista é curta) Mestre, ordenados por PdL, 25 por página. Clique num nome para abrir o perfil.

- Precisa da chave da Riot (engrenagem no topo).
- A Riot só devolve o Riot ID de cada jogador numa consulta separada, então os nomes são buscados página por página e guardados por 7 dias. A lista é atualizada a cada 15 minutos.

## Buscar jogador

A barra de pesquisa no topo procura **só jogadores** (nunca campeões). Escreva o Riot ID como `Nome#TAG` e escolha a região ao lado; sem a `#TAG`, o app tenta a tag padrão da região (BR1, EUW, KR…). O perfil mostra nível, elo na Solo/Duo e na Flex, os campeões mais jogados e as últimas 10 partidas de qualquer fila. As últimas buscas ficam salvas no computador. Precisa da chave da Riot.

## Partidas

A aba **Partidas** mostra o seu histórico: resultado, campeão contra o oponente de rota, fila, duração, feitiços, runas, itens, K/D/A, CS e ouro por minuto e a **nota do draft de 0 a 10**. Clique numa partida para ver os dois times e por que o draft levou aquela nota.

- O Draft Lab descobre a sua conta pelo cliente do LoL aberto. Sem o cliente, escreva o seu Riot ID (Nome#TAG) na própria aba.
- Precisa da chave da Riot. Os seus pedidos passam na frente da coleta de estatísticas, então a busca leva poucos segundos.
- As partidas ficam salvas em `data/partidas.json`. Dos outros nove jogadores só ficam campeão, time, rota e resultado.

**Como sai a nota do draft:** o app soma, em pontos de win rate, a força de cada campeão na rota, os confrontos de rota (números com 30 jogos ou mais; senão, o histórico das fichas), as duplas de cada time e os alertas de composição. O que é do inimigo entra com sinal trocado. Win rates com poucos jogos são puxados para 50%, e nenhum item sozinho passa de um teto (5 pontos para a rota, 6 para o confronto, 3 para a dupla). A nota é 5 + total ÷ 2: 5 é um draft equilibrado; acima de 6,5 o seu time saiu na frente.

## Desempenho

A aba **Desempenho** compara a média das suas últimas partidas numa rota com as partidas dessa rota no elo que o app coleta. São quatro grupos: Recursos (CS, ouro, experiência), Combate (participação em abates, KDA, dano, mortes), Objetivos (dragões, vastilarvas, torres, placas) e Visão (placar de visão e sentinelas). A porcentagem diz em quantas partidas do elo o resultado foi pior que a sua média.

As amostras de desempenho do elo começaram a ser guardadas na versão 0.4: as partidas coletadas antes disso não têm esses números, então a comparação aparece conforme a coleta continua.

## Estatísticas de soloQ

Na **engrenagem** do topo (Configurações), cole a sua chave da Riot e escolha o servidor e o elo (o padrão é Esmeralda+ do Brasil).

- A chave de desenvolvimento é grátis: entre em https://developer.riotgames.com com a sua conta da Riot e copie a **Development API Key**. Ela vale 24 horas; quando expirar, o app avisa e é só colar outra.
- O app busca jogadores do elo escolhido, baixa as ranqueadas solo/duo deles do patch atual e calcula:
  - win rate, presença, pick e ban de cada campeão, no geral e por rota;
  - **matchups**: como cada campeão se sai contra o adversário da mesma rota;
  - **duplas**: como cada campeão se sai jogando junto com cada aliado.
- A chave de desenvolvimento permite uns 100 pedidos a cada 2 minutos, o que dá umas 40 partidas por minuto. Com o app aberto uma tarde, já são alguns milhares de partidas. A coleta continua de onde parou quando o app abre de novo.
- Enquanto o patch novo tem menos de 1.500 partidas, o app soma as do patch anterior.
- **Regras das sugestões** (ficam em `RULES`, no começo de `public/engine.js`, e dá para mudar os números ali):
  - só aparecem campeões com **50 jogos ou mais** na rota em questão (ou no total, quando a rota não é conhecida). Assim, um campeão que quase não é jogado naquela rota, como Annie top, não aparece;
  - **forte** = mais de **53%** de vitória na situação; **pior escolha** = menos de **45%**, e quanto menor, mais para cima na lista;
  - a "situação" é o confronto direto contra aquele campeão (ou a dupla, para sinergia) quando ele tem pelo menos **30 jogos**; senão, é o win rate do campeão na rota;
  - confrontos históricos das fichas, como Poppy forte contra Riven, têm prioridade na ordem (valem 3 pontos de win rate a mais), mas o campeão ainda precisa passar pelos números;
  - sem estatísticas coletadas, valem só as fichas.
  Com poucas partidas coletadas, as listas ficam curtas. Elas crescem com a coleta: 50 jogos por campeão em cada rota pedem alguns milhares de partidas.
- Tudo fica em `data/soloq`, sem nomes de jogadores.

## Testar sem entrar na fila

Clique em **Testar com gravação** e em **Reproduzir**. Já vem uma gravação de exemplo com um draft de torneio. Cada champ select seu também fica gravado em `data/lcu-gravacoes`, sem nomes nem ids de conta, e dá para rever do mesmo jeito.

Se o LoL estiver instalado num lugar diferente do padrão e o app não encontrar o cliente, coloque a pasta do jogo em `data/config.json`, por exemplo `"lcuPath": "D:\\Jogos\\League of Legends"`.

## Onde ficam as coisas

| Arquivo | O que é |
|---|---|
| `server.js` | Servidor local: entrega a página, fala com o cliente do LoL e com a Riot |
| `electron/main.js` | O aplicativo para Windows: janela, ícone perto do relógio, abrir no champ select |
| `Montar o instalador.bat` | Monta o instalador `.exe` do aplicativo |
| `lib/lcu.js` | Conexão com o cliente do LoL, gravação e modo replay |
| `lib/lcu-ws.js` | WebSocket da API local do cliente, sem bibliotecas externas |
| `lib/lcu-draft.js` | Transforma o champ select do cliente no formato da tela, com o anonimato da Riot |
| `lib/soloq.js` | Coleta e soma das estatísticas de soloQ |
| `lib/riot-api.js` | Pedidos à API da Riot dentro do limite da chave, com prioridade para o que você está esperando |
| `lib/history.js` | Seu histórico de partidas |
| `lib/metrics.js` | Métricas de desempenho e comparação com o elo |
| `lib/assets.js` | Ícones de itens, feitiços, runas e perfil |
| `lib/champions.js` | Lista de campeões e imagens do Data Dragon |
| `lib/profiles.js` | Lê as fichas dos campeões |
| `public/engine.js` | Motor de leitura do draft: sugestões, counters, sinergias e composição |
| `public/app.js` | A tela do draft ao vivo, as abas e os painéis |
| `public/you.js` | As abas Partidas e Desempenho |
| `data/profiles.json` | Fichas dos campeões (copiadas do Fearless Draft Lab; pode editar à vontade) |
| `data/roles.json` | Rotas de cada campeão |
| `data/adc.json` | Counterpicks da rota de ADC por classe. Pode editar |
| `data/suporte.json` | Counterpicks da rota de suporte por classe, com exceções e duplas. Pode editar |
| `data/topo.json` | Counterpicks do topo por classe, com exceções. Pode editar |
| `data/meio.json` | Counterpicks do meio por classe, com exceções. Pode editar |
| `data/selva.json` | Counterpicks da selva por classe, com exceções. Pode editar |
| `lib/scout.js` | Mais jogados dos aliados pelo histórico do cliente |
| `lib/adc.js` | Lê o `adc.json` e liga os nomes à lista da Riot |
| `data/config.json` | Chave da Riot, servidor e elo. Fica só neste computador |
| `data/soloq/` | Estatísticas coletadas |
| `data/lcu-gravacoes/` | Champ selects gravados |

## Sobre as APIs

A conexão com o cliente usa a API local dele (LCU). A Riot permite ferramentas com ela, mas ela não é oficial e pode mudar num patch. Tudo o que depende dela fica em `lib/lcu.js` e `lib/lcu-ws.js`. As Configs LoL usam a mesma API, em `lib/lolconfig.js`.

As estatísticas usam a API oficial da Riot com a sua chave pessoal. Para publicar o Draft Lab para outras pessoas, é preciso pedir à Riot uma chave de produção.

## Segurança

O Draft Lab roda só no seu computador: o servidor escuta em `127.0.0.1` e nada de fora chega nele direto. O caminho que sobra para alguém tentar ler os seus dados é um site aberto no seu navegador mandar pedidos para o endereço local. Isso está fechado:

- **Só atende a própria tela.** Pedidos com outro endereço no cabeçalho `Host` (truque de DNS rebinding) ou vindos de outra página (outro site, ou outro programa em outra porta) recebem 403.
- **Alterações só com JSON.** Outro site não consegue enviar esse tipo de conteúdo às escondidas.
- **A página só roda os scripts do próprio app**, não pode ser colocada dentro de outra página e as respostas não podem ser lidas por outros sites (Content-Security-Policy e cabeçalhos relacionados).
- **Chave de sessão.** Cada vez que o app liga, ele sorteia uma chave e abre a tela com ela no endereço (depois do `#`). Os dados só saem para quem manda essa chave: outro programa ou outra conta do Windows no mesmo computador recebe 401. A chave não fica em arquivo. Por isso, abra sempre pelo `Iniciar.bat` ou pelo aplicativo; digitar `localhost:3100` num navegador que nunca abriu o app nesta sessão mostra "App desligado".
- **A chave da Riot nunca volta para a tela**, só a informação de que existe.
- **Nomes de outros jogadores não saem do servidor:** as gravações de champ select ficam sem nomes nem ids de conta.
- **No aplicativo instalado**, links só abrem endereços `http`/`https` no navegador, e a janela não pede câmera, microfone nem localização.

O que isso não cobre: um programa rodando na sua própria conta do Windows consegue ler a pasta de dados direto, como qualquer arquivo seu. A chave fica em `data/config.json` em texto simples; se a pasta do projeto estiver no OneDrive, ela sobe junto (no aplicativo instalado os dados ficam em `%APPDATA%`, fora do OneDrive).

## Se algo der errado

- **"Procurando o cliente do LoL…" com o jogo aberto:** confira se o cliente está logado. Se o LoL estiver noutra pasta, veja o `lcuPath` acima.
- **"A chave da Riot é inválida ou expirou":** gere outra em developer.riotgames.com e cole na engrenagem (Configurações).
- **Qualquer erro estranho:** o app registra os detalhes em `data/erros.log`.

Para rodar os testes: `npm test`.
