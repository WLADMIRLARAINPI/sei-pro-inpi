# Conectores MCP e rotinas agendadas no Agente de IA — especificação de desenho

Data: 01/10/2026 · Status: aprovado em conversa com o autor (todas as decisões da seção 2).

## 1. Objetivo

Duas funções novas no Agente de IA, pedidas pelo autor:

1. **Conectores MCP**, com a mesma experiência do claude.ai: adicionar um servidor, ver a lista
   de ferramentas, decidir caso a caso entre *sempre permitir*, *requer aprovação* e *bloqueado*,
   ativar e desativar, vincular e desvincular quando houver autenticação, e excluir.
2. **Rotinas (tarefas agendadas)** ligadas a um prompt próprio ou a skills já cadastradas, com
   nome, instruções, frequência (manual, horária, diária, dias úteis, semanal, mensal),
   permissões (leitura, aprovar, autônoma) e aviso por notificação do navegador ao terminar.

Rotina não nasce aqui: `agente-ia/src/painel/rotinas.ts` já tem diária, semanal e mensal, cálculo
de vencimento e cadastro na configuração. Esta especificação **evolui** o que existe; a parte de
MCP é nova por inteiro.

## 2. Decisões tomadas (todas aprovadas em conversa)

| Tema | Decisão |
|---|---|
| Autenticação MCP | **Token agora, OAuth depois.** Fase 1 aceita cabeçalho fixo (`Authorization: Bearer …` ou outro nome); o OAuth 2.1 com PKCE e registro dinâmico é a fase 3, com o `auth` já extensível. |
| Transporte MCP | **Streamable HTTP** (POST JSON-RPC, resposta `application/json` ou `text/event-stream`). Servidor que só fala o SSE antigo é recusado com mensagem explícita. `stdio` não existe em extensão. |
| Contexto das tools | **Descoberta sob demanda.** O prompt vê uma linha por conector; o esquema das tools chega por `mcp_buscar_tools`. |
| Onde roda o cliente MCP | **No bundle do painel.** A execução de rotina também é no painel (ver abaixo), então nada obriga a mover o cliente para o service worker, e o `background.js` legado fica intocado fora do alarme. |
| Disparo de rotina | **`chrome.alarms` + notificação.** Painel aberto na hora marcada: roda. Painel fechado: notificação de pendência que roda ao clicar. |
| Escrita por rotina | **Permitida, inclusive sem aprovação**, com cercas (4.4): nunca em tool irreversível ou de assinatura, só nas tools marcadas na própria rotina, regras da unidade continuam barrando, tudo registrado, e desligamento automático na primeira falha de escrita. |
| Firefox | Fica **sem disparo em segundo plano** nesta entrega: o `manifest_v2.json` não declara background nenhum, e criar um mexe no `onInstalled`. No Firefox a rotina dispara com a sidebar aberta. |
| Privacidade dos conectores | Argumentos passam pelo **mesmo pseudonimizador** do histórico, e cada conector pede **consentimento explícito** na primeira chamada. `PRIVACY_POLICY` passa a declarar o envio a terceiros. |
| Dias úteis | Segunda a sexta, **sem feriado** — a extensão não tem o calendário de cada órgão, e a ajuda diz isso. |

## 3. Parte A — Conectores MCP

### 3.1 Protocolo e transporte

`src/mcp/protocolo.ts` define os tipos de JSON-RPC 2.0 e das mensagens MCP usadas:
`initialize` (com `protocolVersion` e `capabilities`), a notificação `notifications/initialized`,
`tools/list` (com `nextCursor`) e `tools/call`. `resources/*` e `prompts/*` ficam declarados nos
tipos, mas fora do escopo desta entrega (seção 8).

`src/mcp/cliente.ts` implementa um transporte Streamable HTTP:

- toda chamada é `POST` na URL do conector, com `Accept: application/json, text/event-stream`;
- a resposta pode vir como JSON único ou como stream SSE — nos dois casos o cliente devolve o
  resultado da requisição cujo `id` casa com o pedido;
- `Mcp-Session-Id` devolvido no `initialize` é reenviado nas chamadas seguintes; `404` com sessão
  conhecida significa sessão expirada e provoca **um** novo `initialize` e uma repetição;
- `AbortSignal` em tudo, com teto de 60 s por chamada;
- erro vira `ErroMcp { codigo, mensagem, detalhe? }`, onde `codigo` distingue rede, HTTP,
  JSON-RPC e protocolo. Um servidor que responda `GET /sse` mas recuse o `POST` recebe a
  mensagem "este servidor usa o transporte SSE antigo, que o SEI Pro não fala".

### 3.2 Modelo de dados

```ts
export type Permissao = "sempre" | "aprovar" | "bloqueado";

export type Auth =
  | { tipo: "nenhuma" }
  | { tipo: "token"; cabecalho: string; valor: string }
  /** Fase 3. `valor` nunca é escrito pelo usuário: vem do fluxo OAuth. */
  | { tipo: "oauth"; emissor?: string; cliente?: string; token?: string; refresh?: string; expiraEm?: number };

export interface ToolMcp {
  nome: string;
  descricao: string;
  /** JSON Schema cru do servidor, validado antes de virar DefTool. */
  esquema: Record<string, unknown>;
}

export interface Conector {
  id: string;
  nome: string;
  url: string;
  ativo: boolean;
  auth: Auth;
  /** Vale para tool que aparecer depois do último catálogo. */
  padrao: Permissao;
  /** Por nome de tool do servidor (sem prefixo). */
  permissoes: Record<string, Permissao>;
  tools?: ToolMcp[];
  /** O que o `initialize` informou. */
  servidor?: { nome: string; versao: string; protocolo: string };
  verificadoEm?: number;
  erro?: string;
  /** O usuário já consentiu que dados saiam para este conector. */
  consentido?: boolean;
}
```

Guardado em `chrome.storage.local` sob `agenteIA_mcp`, como todo o resto do agente: nunca em
`storage.sync`, nunca acessível ao mundo da página do SEI.

### 3.3 Descoberta sob demanda

O prompt de sistema recebe, por conector ativo, uma linha com nome, número de tools liberadas e
os nomes das oito primeiras. Duas tools internas fazem o resto:

| Tool | Efeito | O que faz |
|---|---|---|
| `mcp_buscar_tools({ servidor?, busca })` | `interna` | devolve nome, descrição e esquema de até 10 tools que casem com a busca, só entre as não bloqueadas |
| `mcp_chamar({ servidor, tool, argumentos })` | `externo` | aplica a permissão e executa `tools/call` |

O nome do conector no argumento `servidor` é o `nome` que o usuário deu, comparado sem acento e
sem caixa; nome ambíguo devolve erro pedindo o nome exato. As tools do servidor **não** entram no
`paraProvedor()` do registro: é isso que mantém o contexto constante por conector.

### 3.4 Efeito `externo` e o que muda no motor

`Efeito` em `src/motor/tipos.ts` ganha `"externo"`: a tool sai do navegador, mas **não toca o
SEI**. Consequências:

- `definirTool` passa a exigir `previsualizar()` apenas de `escrita`, `irreversivel` e
  `assinatura` — `externo` não tem prévia porque não há "antes e depois" no SEI para mostrar;
- em `Motor.executarChamadas`, `externo` não entra na lista de escritas (não vira plano) nem na de
  leituras paralelas: executa em sequência, depois de autorizado;
- `InterfaceMotor` ganha `aprovarExterno(p: PedidoExterno): Promise<DecisaoExterna>`, com
  `PedidoExterno { conector, tool, descricao, argumentos }` e
  `DecisaoExterna { permitido: boolean; sempre?: boolean }`.

### 3.5 Os três estados

`mcp_chamar` resolve a permissão por `permissoes[tool] ?? padrao`:

- **`sempre`** executa direto;
- **`aprovar`** chama `ui.aprovarExterno`, que desenha um cartão com o conector, a ferramenta, a
  descrição e os argumentos formatados, e os botões *Permitir uma vez*, *Permitir sempre*
  (grava `permissoes[tool] = "sempre"`) e *Recusar*;
- **`bloqueado`** devolve erro ao modelo **e não aparece em `mcp_buscar_tools`** — o modelo não
  deve saber que a ferramenta existe.

Recusa devolve ao modelo um texto neutro ("o usuário não autorizou esta ferramenta"), sem sugerir
caminho alternativo.

### 3.6 Privacidade

Duas travas, além das que o motor já tem:

1. **Pseudonimização.** Os argumentos de `mcp_chamar` passam por `privacidade.anonimizar` antes de
   sair, como qualquer texto que vai ao provedor de IA. O servidor MCP recebe `[PESSOA_1]`, não o
   nome. O resultado volta pelo `paraModelo`, que também anonimiza.
2. **Consentimento por conector.** Na primeira chamada de cada conector, `ctx.consentir` abre um
   aviso dizendo que o conteúdo enviado sai do navegador para aquele endereço, e grava
   `consentido`. Desligar e religar o conector não apaga o consentimento; excluir, sim.

Fora do código: `PRIVACY_POLICY.md` e a página de privacidade do site passam a declarar que um
conector configurado pelo usuário envia dados ao servidor escolhido por ele. A régua é a da
auditoria da 2.2.2.

### 3.7 Rede e permissões do navegador

Antes da primeira chamada a uma origem nova, `chrome.permissions.request({ origins: [origem] })`
no clique de **Testar conexão** — gesto do usuário, igual ao que `painel/skills.ts` já faz para o
GitHub. Sem a permissão, o conector fica listado com o aviso "falta autorizar o acesso a este
endereço", e nenhuma chamada é tentada.

Só `https` é aceito, com uma exceção: `http://localhost` e `http://127.0.0.1`, que já estão em
`optional_host_permissions` e são o caso de quem roda um servidor MCP na própria máquina.

### 3.8 Interface

Seção nova na configuração, em arquivo próprio (`src/painel/mcp-ui.ts`) porque
`src/painel/main.ts` já tem 2.646 linhas:

- **lista** de conectores, cada um com switch de ativar/desativar, o nome, o endereço abreviado e
  um selo de estado (`N ferramentas`, `token salvo`, `erro`, `falta autorizar`);
- botões por conector: **Testar**, **Ferramentas** (modal), **Editar** (nome, endereço, token),
  **Excluir** (com confirmação em duas etapas);
- **modal de ferramentas**: busca, e cada tool com a descrição do servidor e os três estados em um
  grupo de rádio; no topo, o padrão do conector para tool nova e um botão **Atualizar lista**
  (`tools/list`);
- **modal de cadastro**: nome, endereço, e o par cabeçalho/valor do token com o valor mascarado;
  salvar dispara um `initialize` + `tools/list` e mostra o que o servidor respondeu.

Na fase 3, **Editar token** dá lugar a **Vincular** / **Desvincular**.

### 3.9 O que fica preparado para o OAuth (fase 3)

A variante `oauth` do `Auth` já existe; o cliente já trata `401` com
`WWW-Authenticate: resource_metadata=…` guardando o endereço do metadata em `erro` para a fase
seguinte. A fase 3 acrescenta descoberta de metadata, registro dinâmico de cliente, PKCE,
`chrome.identity.launchWebAuthFlow`, renovação por refresh token — e a permissão `identity` no
manifest.

### 3.10 Limites

Teto de 20 conectores e 200 tools por conector no catálogo; resultado de `tools/call` cortado em
12.000 caracteres pelo `paraModelo` que já existe; conteúdo de resposta aceito nos tipos `text` e
`resource` (texto), com `image` recusada nesta entrega por não haver caminho de imagem no painel.

## 4. Parte B — Rotinas

### 4.1 Modelo de dados

```ts
export type Frequencia = "manual" | "horaria" | "diaria" | "uteis" | "semanal" | "mensal";

/** O que a rotina pode fazer no SEI. */
export type Alcance = "leitura" | "aprovar" | "autonoma";

export interface Execucao {
  em: number;
  ok: boolean;
  /** Primeiras linhas do resultado, para a lista. */
  resumo: string;
  /** Custo em dólares desta execução. */
  custo: number;
  /** Tools de escrita executadas (só em `autonoma`). */
  escritas?: string[];
}

export interface Rotina {
  id: string;
  nome: string;
  /** O pedido, como seria digitado na conversa. Pode ser vazio se houver skills. */
  pergunta: string;
  /** Ids de skills cadastradas que entram como material de apoio. */
  skills?: string[];
  frequencia: Frequencia;
  hora: string;            // "08:00" — ignorado em manual e horaria
  diaSemana?: number;      // 1 = segunda … 7 = domingo (semanal)
  diaMes?: number;         // 1 a 28 (mensal)
  ativa: boolean;
  alcance: Alcance;
  /** Tools de escrita autorizadas quando `alcance === "autonoma"`. */
  autorizadas?: string[];
  /** Notificar o navegador ao terminar. */
  avisar?: boolean;
  /** Teto de gasto por execução, em reais (0 = sem teto próprio). */
  teto?: number;
  ultimaEm?: number;
  /** As 10 últimas execuções, da mais nova para a mais velha. */
  ultimas?: Execucao[];
  /** Falhas seguidas de escrita; em 1, a rotina se desliga (ver 4.4). */
  falhas?: number;
}
```

`ultimoResultado` sai do modelo; na leitura, uma rotina antiga que o tenha vira uma `Execucao`
sem data confiável para não perder o que estava na tela. `alcance` ausente é lido como
`"leitura"`, que é o que toda rotina existente faz hoje.

### 4.2 Frequências e vencimento

`vencimento(r, agora)` continua devolvendo o instante em que a rotina passou a estar vencida na
janela atual, ou `null`. Os casos novos:

- **`manual`**: sempre `null`. Nunca vence, nunca entra em `vencidas()`.
- **`horaria`**: a hora cheia corrente (`agora` truncado nos minutos). Com `ultimaEm` na mesma
  hora, não repete.
- **`uteis`**: igual à diária, mas `null` em sábado e domingo. Segunda-feira cobre o fim de semana
  — quem deixou o navegador fechado recebe **uma** execução, a mesma regra de "férias" que a
  `vencidas()` já aplica.

`descreverFrequencia` ganha os três textos: "quando você mandar", "a cada hora", "de segunda a
sexta, a partir das HH:MM (sem contar feriado)".

### 4.3 Instruções: prompt, skills ou os dois

O pedido enviado ao agente é `comSkills(rotina.pergunta, skillsDaRotina)` — a mesma função que o
`/slug` da conversa usa. Skill que foi excluída sai da rotina em silêncio na leitura; rotina que
fica sem prompt **e** sem skill válida não roda e aparece com aviso na lista.

### 4.4 Alcance e as cercas da rotina autônoma

| Alcance | Como roda |
|---|---|
| `leitura` | `delegar()`: agente auxiliar, contexto próprio, só tools de leitura. É o padrão e o que existe hoje. |
| `aprovar` | Motor principal, com a `InterfaceMotor` do painel. Para no cartão de plano e **espera** o usuário. |
| `autonoma` | Motor principal com uma `InterfaceMotor` de rotina, que decide o plano sozinha conforme as cercas abaixo. |

As cercas de `autonoma`, todas verificadas na hora de responder `aprovarPlano`:

1. passo de efeito `irreversivel` ou `assinatura` **nunca** é aprovado, mesmo listado em
   `autorizadas` — a UI não permite marcá-los, e a checagem se repete na execução;
2. todo passo de escrita precisa estar em `rotina.autorizadas`; um passo fora da lista reprova o
   plano inteiro, e o motivo volta ao modelo;
3. as regras da unidade continuam avaliadas antes do cartão, como já são — bloqueio da unidade
   barra a rotina;
4. cada escrita entra na transcrição e no mapa de desfazer do painel, como escrita de conversa;
5. `avisar` é forçado para `true` quando o alcance é `autonoma`: o usuário tem de saber que algo
   foi escrito;
6. **uma** falha de escrita desliga a rotina (`ativa = false`, `falhas = 1`) e a notificação diz
   por quê. Religar é manual.

Consentimento: ao marcar `autonoma` no cadastro, o usuário lê e confirma uma frase sobre o que
está autorizando, e a lista mostra o alcance em destaque. Nada de alcance autônomo herdado em
silêncio por uma rotina que já existia.

### 4.5 Disparo

Ao salvar, o painel registra `chrome.alarms.create` por rotina com frequência diferente de
`manual` (nome `rotina:<id>`, `periodInMinutes` conforme a frequência, nunca abaixo de 60).

No `onAlarm`, dentro do `background.js`:

- se há porta aberta do painel (o background passa a aceitar uma porta `agente-vivo` que o painel
  abre ao iniciar), manda rodar e não notifica nada;
- se não há, cria uma notificação de pendência cujo clique abre o painel (Chrome:
  `chrome.sidePanel.open` no gesto do clique) ou a página `html/agente.html` em aba, quando o
  painel lateral não puder ser aberto.

Na abertura, o painel continua rodando as vencidas como hoje — é esse caminho que cobre o Firefox
e o navegador que ficou fechado. Enquanto o painel está aberto, um `setInterval` de cinco minutos
confere os vencimentos, o que atende a frequência horária sem depender do alarme.

Tudo que o alarme acrescenta é o **aviso** e a execução imediata com o painel aberto; nenhuma
rotina roda sem o painel, e a documentação diz isso na mesma frase em que hoje explica o limite.

### 4.6 Notificação

`chrome.notifications.create` ao terminar, com o ícone do agente, título "Rotina: <nome>" e corpo
com a primeira linha útil do resultado (ou o motivo da falha). A permissão `notifications` é
**opcional** no manifest e pedida por `chrome.permissions.request` no momento em que o usuário
marca "avisar quando terminar"; recusada, a caixa se desmarca e a ajuda explica.

Clicar na notificação abre o agente na conversa daquela execução.

### 4.7 Gasto e histórico

`cabeMaisUma` continua barrando pelo limite por conversa e por dia. Acrescenta-se o teto por
execução (`rotina.teto`): estourado, a rotina para, registra a execução como falha de custo e
avisa. Cada execução entra em `ultimas` (máximo 10) com custo, resultado e escritas, e a lista da
configuração mostra a última com data e custo.

### 4.8 Interface

O cadastro de rotina (hoje em `editarRotina`, dentro de `main.ts`) passa para
`src/painel/rotinas-ui.ts` e ganha: seleção de frequência com os dois campos novos, multi-seleção
de skills, escolha de alcance com a lista de tools autorizadas (só quando `autonoma`), caixa de
"avisar quando terminar", teto por execução e um botão **Rodar agora** que vale para qualquer
frequência. A lista ganha o selo de alcance, a última execução e o aviso de rotina desligada por
falha.

## 5. Arquivos

**Novos**

| Arquivo | Papel |
|---|---|
| `agente-ia/src/mcp/protocolo.ts` | tipos JSON-RPC e MCP |
| `agente-ia/src/mcp/cliente.ts` | transporte Streamable HTTP |
| `agente-ia/src/mcp/conectores.ts` | modelo, storage, permissões, catálogo |
| `agente-ia/src/mcp/tools.ts` | `mcp_buscar_tools` e `mcp_chamar` |
| `agente-ia/src/painel/mcp-ui.ts` | interface dos conectores |
| `agente-ia/src/painel/rotinas-ui.ts` | cadastro e lista de rotinas |
| `agente-ia/tests/verificar-mcp.ts` | protocolo, cliente, erros |
| `agente-ia/tests/verificar-mcp-permissao.ts` | três estados, padrão, bloqueado invisível |

**Tocados**

`src/motor/tipos.ts` (`Efeito` com `externo`, `aprovarExterno`), `src/motor/tools.ts`
(`definirTool`), `src/motor/motor.ts` (roteamento de `externo`), `src/motor/prompt.ts` (linha por
conector), `src/painel/rotinas.ts` (modelo e vencimento), `src/painel/main.ts` (montagem, rotas de
UI, execução de rotina, porta `agente-vivo`), `dist/background.js` (`onAlarm`, porta,
notificação), os 12 `dist/manifest*.json` (permissões `alarms` e `notifications` opcionais),
`agente-ia/tests/verificar-rotinas.ts`, `PRIVACY_POLICY.md` e `pages/`.

## 6. Testes

Tudo roda em `npm run verificar` (hoje 570 verificações, 0 falhas), com `fetch` simulado no padrão
de `verificar-skills.ts` e sem rede:

- **MCP**: `initialize` + `tools/list` + `tools/call` em resposta JSON e em SSE; sessão expirada e
  repetida uma vez; servidor SSE antigo recusado com a mensagem certa; JSON-RPC com `error`;
  esquema de tool inválido recusado antes de virar `DefTool`; nome de tool saneado e deduplicado.
- **Permissão**: os três estados; tool nova herdando o padrão do conector; bloqueada ausente da
  busca e recusada na chamada; "Permitir sempre" gravando a permissão.
- **Rotinas**: vencimento de `horaria`, `uteis` (sábado e domingo em branco, segunda cobrindo o
  fim de semana) e `manual` (nunca); as seis cercas do alcance autônomo, uma por caso; corte do
  histórico em 10; leitura de rotina antiga sem `alcance`.
- **Motor**: `externo` fora do plano e fora das leituras paralelas; recusa devolvendo texto neutro.

## 7. Ordem de entrega

1. **MCP com token**, UI completa — publicável sozinha, sem permissão nova no manifest.
2. **Rotinas** (frequências, skills, alcance, histórico) + `alarms` e `notifications`.
3. **OAuth** dos conectores + `identity`.

As etapas 2 e 3 acrescentam permissões ao manifest e exigem nova revisão nas duas lojas, com
justificativa escrita — a da Chrome Web Store fica ao lado da justificativa do `sidePanel`.

## 8. Fora de escopo

`resources` e `prompts` do MCP (os prompts combinam com o sistema de skills e são o candidato
natural à rodada seguinte), servidores `stdio`, imagens em resposta de tool, background novo no
`manifest_v2.json` do Firefox, calendário de feriados, e execução de rotina sem o painel aberto.
