# Draft Lab InHouse

Salas de draft alternado de torneio para partidas personalizadas (InHouse): os 10 jogadores escolhem pelo navegador, cada time com o seu link, e o espectador acompanha tudo em tempo real.

- **Capitães** banem, confirmam que o time está pronto e informam o resultado. O primeiro a entrar pelo link do time vira capitão (dá para passar a capitania).
- **Cada jogador** trava o próprio campeão na vez do time. O capitão pode escolher por quem não apareceu.
- **Tempo por ação** (20 a 90 s). Acabou o tempo: no ban, trava o que o capitão marcou (ou fica sem ban); no pick, trava a marcação mais antiga de quem ainda não escolheu; sem marcação, o draft espera alguém travar.
- **Séries MD3 e MD5 com Fearless**: campeão escolhido num jogo fica bloqueado nos próximos. Quem perde escolhe o lado do próximo jogo.
- **Discord**: com um webhook, o draft e o resultado de cada jogo aparecem no canal.
- **Estatísticas**: todo jogo com resultado entra nas estatísticas por campeão (`/estatisticas`). Os nicks não aparecem nas estatísticas públicas.
- **No Draft Lab**: a aba InHouse cria a sala, abre a sala dentro do app e mostra ao lado as sugestões de pick e ban e a composição dos times.

## Publicar (uma vez)

1. Crie uma conta grátis em https://dash.cloudflare.com/sign-up.
2. Dê dois cliques em **Publicar servidor InHouse.bat** (nesta pasta). Na primeira vez o navegador abre para você entrar na Cloudflare e autorizar. Se ele perguntar o nome do seu subdomínio `workers.dev`, escolha um (por exemplo `draftlab`).
3. No fim aparece o endereço, algo como `https://draft-lab-inhouse.draftlab.workers.dev`. Abra para conferir: deve aparecer a página "Draft de torneio para a sua InHouse".
4. No Draft Lab: aba **InHouse** → cole o endereço em **Servidor InHouse** → Salvar.

Para atualizar o servidor depois de mudanças, rode o mesmo `.bat` de novo. As salas abertas continuam.

O plano grátis da Cloudflare (Workers + Durable Objects com SQLite) dá conta de muitas salas por dia. Salas paradas há 3 dias são apagadas sozinhas; as estatísticas ficam.

## Para o bot do servidor do Discord

```
POST https://SEU-ENDERECO/api/salas
Content-Type: application/json

{ "timeA": "Time do Zirigude", "timeB": "Time da Abelinha", "serie": 3, "fearless": true, "tempo": 30,
  "titulo": "KABUM_s4_l2227 : Open Low", "webhook": "https://discord.com/api/webhooks/..." }
```

Resposta (201):

```
{ "id": "r96dpVLi",
  "links": { "A": ".../sala/r96dpVLi?time=A&t=...", "B": ".../sala/r96dpVLi?time=B&t=...", "espectador": ".../sala/r96dpVLi" },
  "config": { ... },
  "mensagem": "texto pronto para colar no Discord" }
```

- `GET /api/salas/{id}`: estado público da sala (fase, placar, picks e bans de cada jogo). Nunca traz os links dos times.
- `GET /api/estatisticas?dias=30`: picks, bans, vitórias e presença por campeão.
- `GET /api/jogos?limite=20`: últimos jogos registrados.

Os links dos times são a senha de cada time: mande cada um só para o próprio time.

## Testar no PC

```
cd inhouse
node dev.js        # http://localhost:8787 (imita a Cloudflare, sem conta)
node --test test/  # testes do motor do draft e do servidor
```

Com o servidor de teste ligado, dá para usar `http://localhost:8787` como Servidor InHouse no Draft Lab.

## Arquivos

- `src/draft.js`: regras do draft (ordem de torneio, quem pode agir, tempo, Fearless, resultado). Sem rede.
- `src/worker.js`: servidor na Cloudflare: cria salas, sala em tempo real (Durable Object `Sala`), estatísticas (Durable Object `Arquivo`, SQLite), avisos no Discord.
- `public/`: páginas (criar sala, sala, estatísticas).
- `dev.js`: imitação local da Cloudflare para testes.
- `wrangler.jsonc`: configuração da publicação.
