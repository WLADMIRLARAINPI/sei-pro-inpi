# Sincronizar a configuração do Agente de IA — especificação de desenho

Data: 01/10/2026 · Status: aprovado em conversa com o autor (todas as decisões da seção 2).

## 1. Objetivo

Hoje só as opções do SEI Pro acompanham o usuário entre computadores (uma única chave
`dataValues` em `storage.sync`). Tudo do Agente de IA — instruções, skills, regras, memória,
rotinas, conectores, fluxos — vive em `storage.local` e não sai do navegador onde foi criado.
Quem usa o SEI no trabalho e em casa cadastra duas vezes.

Esta especificação faz a configuração do agente acompanhar a conta do navegador, **sem** levar
segredo, sem levar o que se reconstrói sozinho e sem estourar a cota de sincronização.

## 2. Decisões tomadas (todas aprovadas em conversa)

| Tema | Decisão |
|---|---|
| Granularidade | **Uma chave de `sync` por registro** (uma skill, uma regra, uma rotina...), não uma chave por lista. É o que mantém cada item abaixo dos 8 KB e contém o conflito num registro. |
| Skills | **Só nome, slug, descrição e a URL do GitHub.** O texto não viaja; skill colada à mão fica no navegador onde foi criada. Skill que vem de coleção não viaja (a coleção a recria). |
| Segredos | **Nunca**: chave do serviço de IA e token de conector MCP. |
| Base de Dados | As credenciais que o `dataValues` já sincroniza (`CLIENT_ID`, `API_KEY`, `KEY_USER`) **ficam como estão**; a política de privacidade passa a declará-las. |
| Fluxos | **Entram** na sincronização. |
| Conflito | **A última gravação vence**, por item, sem aviso — o comportamento nativo do `storage.sync`. Excluir num computador exclui no outro. |
| Fonte da verdade | `storage.local` continua sendo de onde a conversa lê. O `sync` é **espelho**: recebe o recorte ao gravar e devolve o que mudou ao abrir. |

## 3. A cota, medida

Chrome e Firefox: **102.400 bytes no total**, **8.192 por item**, **512 itens**, 1.800 escritas por
hora e 120 por minuto. O Chrome conta, por item, o JSON do valor mais o tamanho da chave.

Medições (cenários montados a partir dos tipos reais, incluindo a skill de 26.000 caracteres da
SOG/ANTAQ):

| Cenário | Como está hoje (chave por lista) | Com este desenho |
|---|---|---|
| Modesto (3 skills, 2 rotinas, 1 fluxo) | 20 KB | **12 KB (12%)**, 19 itens |
| Típico (8 skills, 1 conector, 4 rotinas, 3 fluxos) | 71 KB, **3 itens acima de 8 KB** | **24 KB (23%)**, 46 itens |
| Pesado, porte ANTAQ (15 skills, 3 conectores, 8 rotinas, 8 fluxos) | **205 KB (200%)** | **43 KB (42%)**, 81 itens |
| Extremo (50 skills, 5 conectores, 20 rotinas, 20 fluxos) | — | **90 KB (88%)**, 157 itens |

O que o desenho tira do caminho, no cenário pesado: **texto das skills, 87 KB**; **catálogo de
ferramentas MCP, 49 KB**; **histórico de execuções das rotinas, 34 KB**. Só por guardar as
permissões que **diferem** do padrão do conector, um conector com 60 ferramentas cai de 2.120
para 365 bytes.

## 4. O recorte, chave por chave

| Chave de `sync` | O que leva | O que NÃO leva |
|---|---|---|
| `spro_ia` | tudo de `Config`: serviço, modelo, ajustes, instruções, limites, cache, memória ligada, dias de guarda | **`chave`** |
| `spro_skill_<id>` | nome, slug, descrição, `url`, `sincronizar` | **`texto`**, `etag`, `verificadaEm`, `atualizadaEm`, `erroSync`; skill com `colecao` não gera chave |
| `spro_colecao_<id>` | nome, url, `sincronizar` | `verificadaEm`, `erroSync`, `quantas` |
| `spro_regra_<id>` | a regra inteira | — |
| `spro_lembranca_<id>` | a lembrança inteira (uma chave cada: 30 × 240 caracteres estouram um item só) | — |
| `spro_rotina_<id>` | nome, instruções, skills, frequência, hora, dia, alcance, autorizadas, avisar, teto, ativa | **`ultimas`**, `ultimaEm`, `falhas` |
| `spro_mcp_<id>` | nome, url, ativo, padrão, cabeçalho do token, permissões **que diferem do padrão** | **valor do token**, **`tools`**, `servidor`, `verificadoEm`, `erro`, `consentido` |
| `spro_fluxo_<id>` | o fluxo inteiro (nome, aplicaSe, etapas, origem) | `modelos` (processos de exemplo, registro local) |

Fora da sincronização, por natureza: `agenteIA_cambio` (cache), `agenteIA_gastoDiario`,
`agenteIA_conversa` (sessão), `agenteIA_cargo`, as conversas guardadas e os fluxos ignorados.

## 5. A camada de espelho

Arquivo novo `agente-ia/src/painel/espelho.ts`, com uma descrição declarativa por coleção:

```ts
export interface Espelhada<T> {
  /** Prefixo da chave no sync: `spro_skill_`. */
  prefixo: string;
  /** Id do registro. */
  id(item: T): string;
  /** O recorte que viaja, ou `null` quando o registro não deve viajar. */
  paraSync(item: T): Record<string, unknown> | null;
  /** Reconstrói o registro juntando o que veio do sync com o que já existe aqui. */
  doSync(bruto: Record<string, unknown>, local: T | undefined): T | null;
}
```

Duas operações:

- `espelhar(e, lista)` — grava no `sync` os registros que mudaram e **remove** as chaves do prefixo
  que não existem mais na lista. É chamada por cada `guardarX` depois de gravar em `local`.
- `aplicarDoSync(e, local)` — lê as chaves do prefixo e devolve a lista resultante: registro do
  `sync` que não existe aqui entra (pelo `doSync`), registro que existe é atualizado preservando o
  que não viaja (o `texto` da skill, o token do conector, o histórico da rotina), e registro local
  cuja chave não está mais no `sync` **sai** — é assim que a exclusão se propaga.

Chamada em dois momentos: ao abrir o painel (antes de desenhar) e no `chrome.storage.onChanged`
da área `sync`, para a configuração mudar sem recarregar.

### 5.1 Primeira vez (migração)

Nenhum usuário tem chaves `spro_*` hoje, e os registros não têm data de alteração. Na primeira
execução, em cada computador, vale **união por id**: o que existe só no `local` sobe, o que existe
só no `sync` baixa, e o que existe nos dois fica com a versão do `sync` (o espelho é a referência
dali para frente). É o menos destrutivo: ninguém perde cadastro, e o segundo computador do usuário
recebe o que o primeiro subiu.

### 5.2 O guarda-chuva da cota

Antes de gravar, `chrome.storage.sync.getBytesInUse()`. Passando de **85.000 bytes**, o espelho
para de subir registros novos e o painel mostra um aviso uma vez por sessão: *"a configuração
passou do espaço que o navegador reserva para sincronizar; o que já está sincronizado continua, e
o resto fica só neste computador"*. Falha de cota (`QUOTA_BYTES` ou `QUOTA_BYTES_PER_ITEM`) nunca
derruba a gravação local: o `local` grava primeiro, e o espelho é um `catch` que só avisa.

No Firefox sem conta de sincronização, `storage.sync` funciona como armazenamento comum: nada
falha, só não viaja. Não há o que tratar.

## 6. Testes

Em `agente-ia/tests/verificar-espelho.ts`, com um `chrome.storage` de mentira (um objeto em
memória, como os testes de rotinas e conectores já fazem com `fetch`):

- o recorte de cada coleção: a chave da IA, o texto da skill, o token, o catálogo de ferramentas e
  o histórico da rotina **não aparecem** no que foi gravado;
- skill de coleção não gera chave; skill sem URL gera chave só com os metadados;
- conector guarda apenas as permissões que diferem do padrão;
- `aplicarDoSync` preserva o texto local da skill, o token local do conector e o histórico local da
  rotina ao receber a versão do `sync`;
- registro que sai do `sync` é removido do `local` (propagação da exclusão);
- união por id na primeira execução, nos dois sentidos;
- a soma dos cenários medidos na seção 3 cabe em 100 KB e nenhum item passa de 8 KB — o teste
  monta os cenários e afirma os números, para a cota não voltar a estourar em silêncio;
- com o uso acima de 85.000 bytes, o espelho para e avisa, e a gravação local segue intacta.

## 7. Fora de escopo

Mover as credenciais da Base de Dados para fora do `sync` (decisão do autor: ficam, e a política
passa a declará-las), sincronizar o texto das skills, sincronizar conversas guardadas, e qualquer
mudança no formato do `dataValues` das opções do SEI Pro.
