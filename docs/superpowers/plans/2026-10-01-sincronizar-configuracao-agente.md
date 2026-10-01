# Sincronizar a configuração do Agente de IA — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A configuração do Agente de IA passa a acompanhar a conta do navegador, sem levar segredo, sem levar o que se reconstrói sozinho e sem estourar a cota de 100 KB do `storage.sync`.

**Architecture:** `storage.local` continua sendo a fonte de onde a conversa lê; o `sync` é um **espelho** de uma chave por registro. Uma camada declarativa (`painel/espelho.ts`) diz, por coleção, o que viaja (`paraSync`) e como remontar juntando com o que já existe aqui (`doSync`). Cada `guardarX` espelha depois de gravar; ao abrir o painel e a cada mudança na área `sync`, o espelho é aplicado de volta.

**Tech Stack:** TypeScript, `chrome.storage.sync`, testes caseiros em `agente-ia/tests/verificar-*.ts` por `tsx`, com um `chrome.storage` em memória.

**Spec:** `docs/superpowers/specs/2026-10-01-sincronizar-configuracao-agente-design.md`

## Global Constraints

- Diálogo, comentários, nomes de símbolo e textos de interface em **português do Brasil**.
- `dist/js/` é gerado: nunca editar à mão. Build: `cd agente-ia && npm run build`.
- Toda entrega roda `cd agente-ia && npm run verificar` com **0 falhas** (hoje 750 ok).
- **Nunca** no `sync`: `Config.chave`, `Auth.valor` do conector.
- Falha do espelho **nunca** derruba a gravação local: `local` grava primeiro, o espelho é um `catch` que avisa.
- Cota: 102.400 bytes no total, 8.192 por item, 512 itens. Guarda-chuva em 85.000 bytes.
- Nada de `git add -A`: há outra sessão num worktree paralelo.

## Review Focus

1. **Skill que veio de coleção do GitHub** — não pode gerar chave própria no `sync` (a coleção a recria), senão a mesma skill chega duplicada no outro computador. Teste na Tarefa 1.
2. **Chegada do `sync` sobre um registro local que tem o que não viaja** — o texto da skill, o token do conector e o histórico da rotina têm de sobreviver à atualização. Teste na Tarefa 2.
3. **Registro excluído num computador** — a chave sai do `sync` e o registro tem de sair do `local` do outro; e a primeira execução (migração) não pode apagar o que ainda não subiu. Teste na Tarefa 2.
4. **Cota estourada ou item acima de 8 KB** — a gravação local segue, o aviso aparece uma vez, e nada lança. Teste na Tarefa 3.
5. **`storage.sync` indisponível** (Firefox sem conta, API ausente, erro de rede do navegador) — tudo continua funcionando só no `local`. Teste na Tarefa 3.

---

### Task 1: A camada de espelho e o recorte de cada coleção

**Files:**
- Create: `agente-ia/src/painel/espelho.ts`
- Test: `agente-ia/tests/verificar-espelho.ts`
- Modify: `agente-ia/tests/verificar.ts`

**Interfaces:**
- Consumes: `SkillUsuario`, `ColecaoSkills` (`painel/skills.ts`), `Regra` (`painel/regras.ts`), `Lembranca` (`painel/memoria.ts`), `Rotina` (`painel/rotinas.ts`), `Conector` (`mcp/conectores.ts`), `Fluxo` (`fluxos/modelo.ts`), `Config` (declarada em `painel/main.ts` — ver nota).
- Produces:
  - `interface Espelhada<T> { prefixo: string; id(item: T): string; paraSync(item: T): Record<string, unknown> | null; doSync(bruto: Record<string, unknown>, local: T | undefined): T | null }`
  - `ESPELHOS`: `{ skills, colecoes, regras, memoria, rotinas, conectores, fluxos }`, cada um um `Espelhada<...>`
  - `configParaSync(c: ConfigEspelhada): Record<string, unknown>` e `configDoSync(bruto, local)` — a configuração é um item só (`spro_ia`)
  - `CHAVE_CONFIG_SYNC = "spro_ia"`, `TETO_SYNC = 85_000`

Nota ao implementador: `Config` está declarada dentro de `painel/main.ts` e não é exportada. Exporte-a de lá (`export interface Config`) e importe aqui; não duplique o tipo.

- [ ] **Step 1: Escrever o teste que falha**

Criar `agente-ia/tests/verificar-espelho.ts`:

```ts
/**
 * O espelho da configuração no `storage.sync`.
 *
 * O que não pode escapar: segredo não viaja, o que se reconstrói não ocupa
 * cota, e o que chega de outro computador não apaga o que só existe aqui.
 */

import { CHAVE_CONFIG_SYNC, configDoSync, configParaSync, ESPELHOS } from "../src/painel/espelho";
import type { Conector } from "../src/mcp/conectores";
import type { Rotina } from "../src/painel/rotinas";
import type { SkillUsuario } from "../src/painel/skills";
import { checar, secao } from "./util";

const skill = (s: Partial<SkillUsuario> = {}): SkillUsuario => ({
  id: "s1", nome: "Despacho", slug: "despacho", descricao: "encaminhar",
  texto: "x".repeat(5000), url: "https://github.com/o/r/blob/main/d.md", sincronizar: true,
  etag: 'W/"abc"', verificadaEm: 1, atualizadaEm: 2, ...s,
});

const conector = (c: Partial<Conector> = {}): Conector => ({
  id: "c1", nome: "Compras", url: "https://mcp.exemplo.gov.br/mcp", ativo: true,
  auth: { tipo: "token", cabecalho: "Authorization", valor: "Bearer segredo" },
  padrao: "aprovar", permissoes: { buscar: "sempre", apagar: "aprovar" },
  tools: [{ nome: "buscar", descricao: "busca", esquema: { type: "object", properties: {} } }],
  servidor: { nome: "s", versao: "1", protocolo: "2025-06-18" }, verificadoEm: 9, consentido: true, ...c,
});

const rotina = (r: Partial<Rotina> = {}): Rotina => ({
  id: "r1", nome: "Parados", pergunta: "liste", frequencia: "uteis", hora: "08:00",
  ativa: true, alcance: "autonoma", autorizadas: ["processo_marcador"], avisar: true, teto: 2,
  ultimaEm: 123, ultimas: [{ em: 1, ok: true, resumo: "oito processos", custo: 0.02 }], falhas: 0, ...r,
});

export function verificarEspelho(): void {
  secao("espelho: o que NAO viaja");
  {
    const bruto = ESPELHOS.skills.paraSync(skill())!;
    checar("texto da skill fica em casa", !("texto" in bruto), bruto);
    checar("mas a url viaja", bruto.url === "https://github.com/o/r/blob/main/d.md");
    checar("etag e datas de conferencia nao viajam", !("etag" in bruto) && !("verificadaEm" in bruto));
    checar("skill de colecao nao gera chave", ESPELHOS.skills.paraSync(skill({ colecao: "c1" })) === null);
    checar("skill colada viaja sem o texto", (ESPELHOS.skills.paraSync(skill({ url: undefined }))! as { nome: string }).nome === "Despacho");

    const c = ESPELHOS.conectores.paraSync(conector())!;
    const comoTexto = JSON.stringify(c);
    checar("token do conector nao viaja", !comoTexto.includes("segredo"), comoTexto);
    checar("mas o cabecalho viaja", comoTexto.includes("Authorization"));
    checar("catalogo de ferramentas nao viaja", !("tools" in c));
    checar("so a permissao diferente do padrao viaja", JSON.stringify((c as { permissoes: unknown }).permissoes) === '{"buscar":"sempre"}', c.permissoes);

    const r = ESPELHOS.rotinas.paraSync(rotina())!;
    checar("historico de execucoes nao viaja", !("ultimas" in r) && !("ultimaEm" in r), r);
    checar("mas o alcance e as autorizadas viajam", JSON.stringify((r as { autorizadas: string[] }).autorizadas) === '["processo_marcador"]');

    const cfg = configParaSync({
      reais: true, guardar: true, dias: 30, servico: "openrouter", url: "", chave: "sk-segredo-nao-pode-sair",
      modelo: "m", nomes: true, cnpj: false, ajustes: {}, instrucoes: "assim", limites: { porConversa: 0, porDia: 0 },
      cache: true, memoria: true, modeloAuxiliar: "",
    } as never);
    checar("chave da IA nunca viaja", !JSON.stringify(cfg).includes("sk-segredo"), cfg);
    checar("instrucoes viajam", (cfg as { instrucoes: string }).instrucoes === "assim");
    checar("a chave do item e spro_ia", CHAVE_CONFIG_SYNC === "spro_ia");
  }

  secao("espelho: chegada do sync preserva o que e local");
  {
    const local = skill({ texto: "o texto que esta aqui" });
    const vindo = { id: "s1", nome: "Despacho novo", slug: "despacho", descricao: "d", url: local.url, sincronizar: true };
    const juntado = ESPELHOS.skills.doSync(vindo, local)!;
    checar("o nome vem do sync", juntado.nome === "Despacho novo");
    checar("o texto continua o local", juntado.texto === "o texto que esta aqui");
    const semLocal = ESPELHOS.skills.doSync(vindo, undefined)!;
    checar("skill nova chega sem texto, para ser baixada pela url", semLocal.texto === "" && semLocal.url === local.url, semLocal);

    const conectorLocal = conector();
    const conectorVindo = { id: "c1", nome: "Compras", url: conectorLocal.url, ativo: false, padrao: "bloqueado", auth: { tipo: "token", cabecalho: "X-Chave" }, permissoes: {} };
    const juntoC = ESPELHOS.conectores.doSync(conectorVindo, conectorLocal)!;
    checar("o token local sobrevive", juntoC.auth.tipo === "token" && (juntoC.auth as { valor: string }).valor === "Bearer segredo", juntoC.auth);
    checar("o cabecalho vem do sync", (juntoC.auth as { cabecalho: string }).cabecalho === "X-Chave");
    checar("o catalogo local sobrevive", juntoC.tools?.length === 1);
    checar("o estado ligado/desligado vem do sync", juntoC.ativo === false);

    const juntoR = ESPELHOS.rotinas.doSync({ id: "r1", nome: "Parados", pergunta: "liste", frequencia: "diaria", hora: "09:00", ativa: true, alcance: "leitura" }, rotina())!;
    checar("o historico local sobrevive", juntoR.ultimas?.length === 1 && juntoR.ultimaEm === 123, juntoR);
    checar("a frequencia vem do sync", juntoR.frequencia === "diaria" && juntoR.hora === "09:00");
    checar("alcance que desceu para leitura nao mantem autorizadas", !juntoR.autorizadas?.length, juntoR);

    const cfgLocal = { reais: false, guardar: true, dias: 7, servico: "openai", url: "", chave: "sk-local", modelo: "m", nomes: true, cnpj: false, ajustes: {}, instrucoes: "", limites: { porConversa: 0, porDia: 0 }, cache: true, memoria: true, modeloAuxiliar: "" };
    const cfgJunto = configDoSync({ reais: true, dias: 90, servico: "openrouter", instrucoes: "novas" }, cfgLocal as never);
    checar("a chave local sobrevive", (cfgJunto as { chave: string }).chave === "sk-local");
    checar("o resto vem do sync", (cfgJunto as { dias: number }).dias === 90 && (cfgJunto as { instrucoes: string }).instrucoes === "novas");
  }

  secao("espelho: identidade e prefixos");
  {
    const prefixos = Object.values(ESPELHOS).map((e) => e.prefixo);
    checar("todo prefixo comeca com spro_", prefixos.every((p) => p.startsWith("spro_")), prefixos);
    checar("nenhum prefixo e prefixo de outro", prefixos.every((p) => prefixos.filter((q) => q.startsWith(p)).length === 1), prefixos);
    checar("o id da skill e o id do registro", ESPELHOS.skills.id(skill()) === "s1");
  }
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd agente-ia && npx tsx -e "import('./tests/verificar-espelho.ts').then(m=>m.verificarEspelho())"`
Expected: FAIL — `src/painel/espelho` não existe.

- [ ] **Step 3: Escrever `src/painel/espelho.ts`**

Com o `Espelhada<T>` da spec e os sete espelhos. Regras que o teste fixa:

- `skills.paraSync`: `null` quando `colecao` está presente; devolve `{ id, nome, slug, descricao, url?, sincronizar? }`;
- `skills.doSync`: `{ ...(local ?? vazio), ...bruto, texto: local?.texto ?? "" }`, preservando `etag`/`verificadaEm` locais;
- `conectores.paraSync`: `auth` reduzido a `{ tipo, cabecalho }` (nunca `valor`), sem `tools`/`servidor`/`verificadoEm`/`erro`/`consentido`, e `permissoes` filtradas por `!== padrao`;
- `conectores.doSync`: `auth` do sync mas com o `valor` local; `tools`, `servidor`, `consentido` e `verificadoEm` locais;
- `rotinas.paraSync`: sem `ultimas`, `ultimaEm` e `falhas`;
- `rotinas.doSync`: histórico local preservado; `autorizadas` só quando o alcance que veio é `autonoma`;
- `memoria`, `regras` e `fluxos`: o registro inteiro, menos `modelos` no fluxo;
- `configParaSync`: tudo menos `chave`; `configDoSync`: `{ ...local, ...bruto, chave: local.chave }`.

- [ ] **Step 4: Rodar, ligar no `verificar.ts` e conferir os tipos**

Run: `cd agente-ia && npm run verificar && npm run tipos`
Expected: PASS nos dois, com as verificações de `espelho:` no total.

- [ ] **Step 5: Commit**

```bash
git add agente-ia/src/painel/espelho.ts agente-ia/src/painel/main.ts agente-ia/tests/verificar-espelho.ts agente-ia/tests/verificar.ts
git commit -m "Sincronizacao: camada de espelho e o recorte que viaja de cada colecao

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Subir, aplicar e propagar exclusão

**Files:**
- Modify: `agente-ia/src/painel/espelho.ts`
- Modify: `agente-ia/tests/verificar-espelho.ts`

**Interfaces:**
- Consumes: os espelhos da Tarefa 1.
- Produces:
  - `espelhar<T>(e: Espelhada<T>, lista: T[]): Promise<{ gravados: number; removidos: number; aviso?: string }>`
  - `aplicarDoSync<T>(e: Espelhada<T>, local: T[]): Promise<{ lista: T[]; mudou: boolean }>`
  - `unirNaPrimeiraVez<T>(e: Espelhada<T>, local: T[]): Promise<T[]>`
  - `espelharConfig(c: Config)`, `aplicarConfigDoSync(local: Config)`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `verificar-espelho.ts` uma função `verificarEspelhoSync()` (assíncrona) com um `chrome.storage` em memória:

```ts
/** `chrome.storage` de mentira: só o que o espelho usa. */
function navegadorFalso(inicial: Record<string, unknown> = {}, o: { falhar?: boolean; bytes?: number } = {}) {
  const dados: Record<string, unknown> = { ...inicial };
  const area = {
    get: async (chaves?: string | string[] | null) => {
      if (!chaves) return { ...dados };
      const lista = Array.isArray(chaves) ? chaves : [chaves];
      return Object.fromEntries(lista.filter((k) => k in dados).map((k) => [k, dados[k]]));
    },
    set: async (itens: Record<string, unknown>) => {
      if (o.falhar) throw new Error("QUOTA_BYTES quota exceeded");
      Object.assign(dados, itens);
    },
    remove: async (chaves: string | string[]) => {
      for (const k of Array.isArray(chaves) ? chaves : [chaves]) delete dados[k];
    },
    getBytesInUse: async () => o.bytes ?? JSON.stringify(dados).length,
  };
  (globalThis as { chrome?: unknown }).chrome = { storage: { sync: area, local: area } };
  return dados;
}
```

E as verificações:

```ts
export async function verificarEspelhoSync(): Promise<void> {
  secao("espelho: subir");
  {
    const dados = navegadorFalso();
    const r = await espelhar(ESPELHOS.regras, [regra("a"), regra("b")]);
    checar("gravou uma chave por registro", r.gravados === 2 && Object.keys(dados).length === 2, Object.keys(dados));
    checar("a chave usa o prefixo e o id", "spro_regra_a" in dados, Object.keys(dados));
    await espelhar(ESPELHOS.regras, [regra("a")]);
    checar("registro que saiu da lista tem a chave removida", !("spro_regra_b" in dados), Object.keys(dados));
  }

  secao("espelho: aplicar de volta");
  {
    navegadorFalso({ spro_regra_z: { id: "z", nome: "Do outro computador", ativa: true, efeito: "avisar", ferramentas: [], mensagem: "m" } });
    const r = await aplicarDoSync(ESPELHOS.regras, [regra("a")]);
    checar("registro novo do sync entra", r.lista.some((x) => x.id === "z"), r.lista);
    checar("registro local que nao esta no sync SAI (exclusao propagada)", !r.lista.some((x) => x.id === "a"), r.lista);
    checar("avisa que mudou", r.mudou);
    const igual = await aplicarDoSync(ESPELHOS.regras, r.lista);
    checar("aplicar de novo nao muda nada", !igual.mudou);
  }

  secao("espelho: primeira vez (uniao por id)");
  {
    navegadorFalso({ spro_regra_z: { id: "z", nome: "Do outro", ativa: true, efeito: "avisar", ferramentas: [], mensagem: "m" } });
    const lista = await unirNaPrimeiraVez(ESPELHOS.regras, [regra("a")]);
    checar("o que so existe aqui sobe e fica", lista.some((x) => x.id === "a"), lista);
    checar("o que so existe no sync baixa", lista.some((x) => x.id === "z"), lista);
    const dados = navegadorFalso({});
    await unirNaPrimeiraVez(ESPELHOS.regras, [regra("a")]);
    checar("e o que estava aqui vai para o sync", "spro_regra_a" in dados, Object.keys(dados));
  }
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd agente-ia && npm run verificar`
Expected: FAIL — `espelhar`, `aplicarDoSync` e `unirNaPrimeiraVez` não existem.

- [ ] **Step 3: Implementar as três funções**

`espelhar`: monta `{chave: recorte}` para cada item com `paraSync` não nulo, compara com o que já está no `sync` (só grava o que mudou, para não gastar escrita), e remove as chaves do prefixo que não estão mais na lista.

`aplicarDoSync`: lê as chaves do prefixo; para cada uma, `doSync(bruto, local por id)`; os locais cujo id não aparece no `sync` **saem**; devolve `mudou` comparando o JSON antes e depois.

`unirNaPrimeiraVez`: `aplicarDoSync` sem a remoção, seguido de `espelhar` com a lista unida.

- [ ] **Step 4: Rodar e conferir**

Run: `cd agente-ia && npm run verificar && npm run tipos`
Expected: PASS nos dois.

- [ ] **Step 5: Commit**

```bash
git add agente-ia/src/painel/espelho.ts agente-ia/tests/verificar-espelho.ts agente-ia/tests/verificar.ts
git commit -m "Sincronizacao: subir, aplicar de volta e propagar exclusao

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: O guarda-chuva da cota

**Files:**
- Modify: `agente-ia/src/painel/espelho.ts`
- Modify: `agente-ia/tests/verificar-espelho.ts`

**Interfaces:**
- Produces: `TETO_SYNC = 85_000`; `espelhar` devolve `aviso` quando não subiu por cota; `cabeNoSync(): Promise<boolean>`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
  secao("espelho: cota");
  {
    navegadorFalso({}, { bytes: 90_000 });
    const r = await espelhar(ESPELHOS.regras, [regra("a")]);
    checar("acima do teto, nao sobe", r.gravados === 0, r);
    checar("e explica por que", /espaço/i.test(r.aviso ?? ""), r.aviso);
  }
  {
    const dados = navegadorFalso({}, { falhar: true });
    const r = await espelhar(ESPELHOS.regras, [regra("a")]);
    checar("falha de cota do navegador nao lanca", r.gravados === 0 && Boolean(r.aviso), r);
    checar("e nada foi gravado pela metade", Object.keys(dados).length === 0);
  }
  {
    (globalThis as { chrome?: unknown }).chrome = { storage: {} };
    const r = await espelhar(ESPELHOS.regras, [regra("a")]);
    checar("sem storage.sync, segue em silencio", r.gravados === 0 && r.removidos === 0);
    const v = await aplicarDoSync(ESPELHOS.regras, [regra("a")]);
    checar("e aplicar de volta devolve o local intacto", v.lista.length === 1 && !v.mudou, v);
  }
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd agente-ia && npm run verificar`
Expected: FAIL — hoje `espelhar` não olha a cota e quebra sem `chrome.storage.sync`.

- [ ] **Step 3: Implementar**

Antes de gravar, `getBytesInUse()`; acima de `TETO_SYNC`, devolver `{ gravados: 0, removidos: 0, aviso: "A configuração passou do espaço que o navegador reserva para sincronizar..." }`. Envolver tudo em `try/catch`: ausência de `chrome.storage.sync` devolve zeros em silêncio; erro de cota devolve `aviso`.

- [ ] **Step 4: Rodar e conferir**

Run: `cd agente-ia && npm run verificar && npm run tipos`
Expected: PASS.

- [ ] **Step 5: Teste dos cenários da cota (o número que não pode voltar a estourar)**

Acrescentar uma verificação que monta os cenários da seção 3 da spec (modesto, típico, pesado) com os espelhos reais e afirma: total abaixo de 102.400, nenhum item acima de 8.192, menos de 512 itens.

- [ ] **Step 6: Commit**

```bash
git add agente-ia/src/painel/espelho.ts agente-ia/tests/verificar-espelho.ts
git commit -m "Sincronizacao: guarda-chuva da cota e cenarios medidos

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Ligar no painel e nos módulos

**Files:**
- Modify: `agente-ia/src/painel/skills.ts`, `regras.ts`, `memoria.ts`, `rotinas.ts`, `mcp/conectores.ts`, `fluxos/modelo.ts`
- Modify: `agente-ia/src/painel/main.ts`

**Interfaces:**
- Consumes: `espelhar`, `aplicarDoSync`, `unirNaPrimeiraVez`, `espelharConfig`, `aplicarConfigDoSync`.
- Produces: nada novo; cada `guardarX` passa a espelhar, e o painel aplica ao abrir e ao mudar.

- [ ] **Step 1: Espelhar em cada `guardarX`**

Em cada um dos sete módulos, depois do `chrome.storage.local.set`, chamar `void espelhar(ESPELHOS.<colecao>, lista)` — **depois**, nunca antes, e sem `await` que atrase a interface. O retorno com `aviso` é entregue por um ouvinte (`aoAvisar`) que o painel registra, para a mensagem aparecer uma vez por sessão.

Cuidado com o ciclo de importação: `espelho.ts` importa os tipos desses módulos. Importar **só tipos** (`import type`) nos dois sentidos, e a função `espelhar` por valor — o esbuild resolve, mas se houver ciclo em tempo de execução, mova `ESPELHOS` para um arquivo próprio.

- [ ] **Step 2: Aplicar ao abrir e ao mudar**

Em `iniciar()`, depois de carregar o `local` e **antes** de desenhar: na primeira execução (`spro_migrado` ausente em `storage.local`), `unirNaPrimeiraVez` em cada coleção e gravar a marca; nas seguintes, `aplicarDoSync`. Depois, `chrome.storage.onChanged` da área `sync` reaplica a coleção que mudou e redesenha a configuração se estiver aberta.

- [ ] **Step 3: Conferir na tela**

Run: `cd agente-ia && npm run build`

Prova manual: abrir o painel no Chrome for Testing, cadastrar uma regra e uma rotina, e verificar no console da página que `chrome.storage.sync.get()` tem as chaves `spro_*` sem token e sem histórico; apagar a regra e conferir que a chave sai.

- [ ] **Step 4: Commit**

```bash
git add agente-ia/src agente-ia/tests dist/js/agente
git commit -m "Sincronizacao: cada guardar espelha, e o painel aplica ao abrir e ao mudar

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Interface, ajuda e política

**Files:**
- Modify: `agente-ia/src/painel/main.ts` (uma linha na configuração)
- Modify: `pages/AGENTEIA.md`
- Create: `<scratchpad>/politica-sincronizacao.md`

- [ ] **Step 1: Dizer na configuração o que viaja**

No grupo "Conversas e rotinas" (ou junto do resumo do serviço), uma nota: *"A configuração do agente acompanha a sua conta do navegador — instruções, regras, rotinas, conectores e fluxos. A chave do serviço de IA, os tokens dos conectores, o texto das skills coladas à mão e as conversas ficam só neste computador."*

- [ ] **Step 2: Ajuda**

Seção nova em `pages/AGENTEIA.md`, "O que acompanha você em outro computador", com a tabela do que vai e do que não vai, a observação de que skill colada à mão não viaja (e a recomendação de usar GitHub) e a de que o catálogo de ferramentas do conector se refaz com um clique.

- [ ] **Step 3: Texto para a política**

Em `<scratchpad>/politica-sincronizacao.md`: declarar que a configuração do agente passa a usar a sincronização do navegador; que a chave de IA e os tokens **não** vão; e — decisão do autor — que as credenciais da Base de Dados já acompanham a conta do navegador pelo `dataValues`.

- [ ] **Step 4: Commit**

```bash
git add pages/AGENTEIA.md agente-ia/src/painel/main.ts dist/js/agente
git commit -m "Ajuda e interface: o que acompanha voce em outro computador

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
