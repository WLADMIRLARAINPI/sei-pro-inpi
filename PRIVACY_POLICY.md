# Política de Privacidade — SEI Pro ![SEI Pro](/img/icon-32.png)

**Versão:** 3.0  
**Data de Vigência:** 28 de setembro de 2026  
**Última Atualização:** 28 de setembro de 2026

---

## 1. Introdução

Esta Política de Privacidade descreve como a extensão de navegador **SEI Pro** trata dados. Ela diz o que fica guardado no navegador, quais funções se comunicam com serviços fora do SEI, em que condições isso acontece, o que é enviado e para quem. O texto segue a Lei nº 13.709, de 14 de agosto de 2018 — Lei Geral de Proteção de Dados Pessoais (LGPD).

O SEI Pro é uma extensão gratuita e de código aberto, licenciada sob AGPL-3.0. Ela acrescenta funcionalidades ao Sistema Eletrônico de Informações (SEI): na página inicial, na tela de processos e no editor de textos.

---

## 2. Princípios

### 2.1. O que o SEI Pro não faz

- **Não coleta dados para o desenvolvedor.** Não há telemetria, estatística de uso, registro de atividade nem identificação de usuários.
- **Não rastreia a navegação.** A extensão atua apenas nas páginas do SEI e não lê outros sites.
- **Não envia a senha nem a sessão do SEI a terceiros.** A senha digitada para assinar documentos vai apenas ao próprio SEI.
- **Não vende, não compartilha e não usa dados para publicidade.**

### 2.2. Funcionamento padrão

Nas funções comuns, o SEI Pro funciona dentro do navegador. Ele se comunica apenas com o servidor SEI do próprio órgão, usando a sessão já aberta pelo usuário, e as configurações ficam no próprio navegador (seção 3).

Algumas **funções opcionais** enviam dados a serviços fora do SEI. Elas só funcionam quando o usuário as aciona e estão todas listadas na seção 4.

### 2.3. Servidores do projeto

O SEI Pro **não tem servidor de coleta de dados**. Não há banco de dados remoto com informações de usuários nem serviço de análise ou perfilamento.

O único serviço mantido pelo projeto é a **busca de normas** (`seipro.io`), usada pelas funções Legística e Link Legis. Ela recebe apenas o tipo e o número da norma, ou os termos pesquisados, e responde com os dados da legislação correspondente. **As consultas não são guardadas.** O site de documentação (`seipro.app`) é um site comum e não usa ferramentas de estatística.

### 2.4. Fundamentação legal

| Princípio (art. 6º da LGPD) | Aplicação no SEI Pro |
|---|---|
| **Finalidade** | Os dados são usados só para executar a função pedida pelo usuário |
| **Adequação** | Cada função envia apenas o que é preciso para a tarefa, ao serviço que a executa |
| **Necessidade** | Nada é enviado por padrão; as funções que se comunicam com serviços externos dependem de ação do usuário |
| **Transparência** | Esta política lista cada função, o dado enviado e o destinatário |
| **Segurança** | Armazenamento no navegador, conexões cifradas e proteções específicas no Agente de IA (seção 4.2) |
| **Prevenção** | Documentos sigilosos não são lidos pelo Agente de IA, e toda ação no SEI exige aprovação do usuário |

---

## 3. Armazenamento no navegador

### 3.1. Onde os dados ficam

O SEI Pro guarda configurações e dados de trabalho **no dispositivo do usuário**, usando os recursos do próprio navegador:

- **Local Storage e Session Storage:** preferências e dados temporários de uso nas páginas do SEI;
- **Storage API do navegador (`storage.local`, `storage.sync` e `storage.session`):** configurações da extensão. O `storage.sync` é sincronizado entre os dispositivos do usuário pela conta do navegador (Google ou Microsoft), se a sincronização estiver ativada;
- **IndexedDB:** dados estruturados, como o histórico de processos visitados e as conversas do Agente de IA.

### 3.2. Tipos de dados

| Tipo de dado | Finalidade | Onde fica |
|---|---|---|
| Configurações e preferências | Personalizar a extensão | Navegador; sincronizadas pela conta do navegador, se ativado |
| Processos favoritos, marcadores e valores padrão | Organização e agilidade no SEI | Navegador |
| Histórico de processos visitados | Navegação entre processos recentes | Navegador |
| Endereço e chave do servidor de Atividades (seção 4.3) | Conectar ao servidor do órgão | Navegador; sincronizados pela conta do navegador, se ativado |
| Chave de API do serviço de IA | Usar o Agente de IA | Somente neste navegador (não é sincronizada) |
| Conversas do Agente de IA | Reler conversas anteriores | Navegador, com prazo de guarda escolhido pelo usuário (7, 30 ou 90 dias, ou sem limite); o recurso pode ser desligado |
| Tabela de pseudônimos do Agente de IA | Restaurar os dados reais nas respostas | Memória temporária; apagada ao fechar o navegador |

### 3.3. Controle do usuário

- **Visualização e alteração:** as configurações ficam acessíveis na página de opções da extensão e no painel do Agente de IA.
- **Exclusão:** o usuário pode apagar as conversas do agente no próprio painel. A desinstalação apaga os dados guardados nas áreas da extensão. Parte das preferências fica no armazenamento da página do SEI e é apagada ao limpar os dados do site do SEI nas configurações do navegador.

### 3.4. Segurança do armazenamento

Os dados guardados no navegador **não são criptografados pela extensão**. A segurança deles depende do navegador, do dispositivo e das políticas de acesso do órgão. Em ambientes com requisitos elevados, recomenda-se:

- usar dispositivos gerenciados;
- aplicar criptografia de disco;
- bloquear a sessão automaticamente;
- restringir o acesso físico aos equipamentos.

---

## 4. Funções que se comunicam com serviços externos

### 4.1. Regras gerais

- **Nenhuma dessas funções envia dados sem ação do usuário.** Elas dependem de um clique, de um botão no editor ou de uma configuração feita pelo próprio usuário.
- **Os dados vão do navegador diretamente ao serviço indicado.** Nada passa por servidor do SEI Pro, exceto a busca de normas (seção 2.3).
- **Valem as políticas de cada serviço.** Os dados enviados a terceiros seguem a política de privacidade de quem os recebe.
- **Cabe ao usuário e ao órgão avaliar o uso.** Informações sigilosas e dados pessoais não devem ser enviados a serviços externos sem autorização institucional.

### 4.2. Agente de IA

- **Quando funciona:** só depois que o usuário abre o painel do agente e cadastra uma **chave de API própria**. Sem chave, nenhuma conversa é enviada.
- **Destinatário:** o serviço de IA escolhido pelo usuário:
  - OpenRouter (pré-selecionado);
  - OpenAI;
  - Google Gemini;
  - Anthropic;
  - outro endereço compatível informado pelo usuário, que pode ser um servidor do próprio órgão.
- **O que é enviado:**
  - o pedido digitado e os arquivos que o usuário anexar à conversa;
  - o contexto da tela: sigla da unidade; número, tipo e nível de acesso do processo aberto; número e título do documento em visualização;
  - o resultado das consultas que o agente faz no SEI para cumprir o pedido: texto dos documentos lidos, árvore do processo, andamentos, resultados de pesquisa e dados da caixa de processos;
  - as instruções e skills cadastradas pelo usuário e as anotações da memória da unidade.
- **Anonimização:**
  - Antes de sair do navegador, o texto passa por uma substituição automática de dados pessoais por rótulos, como [PESSOA_1] e [CPF_2]. Ela cobre CPF, e-mail, telefone, CEP, RG, título de eleitor, CNH, cartão, chave PIX, dados bancários, endereço, CID e nomes de pessoas.
  - O mascaramento de CNPJ é opcional.
  - A tabela que liga rótulos a valores reais fica só no navegador.
  - **Limitação:** a substituição funciona por padrões e não garante a remoção de todo dado pessoal. Nomes são reconhecidos pelo contexto ou quando constam como interessados do processo. O contexto da tela e as instruções do usuário são enviados sem substituição.
- **Sigilo:**
  - Processos e documentos **sigilosos nunca são lidos**.
  - Documentos **restritos** só são lidos com autorização do usuário, pedida a cada conversa. Dados de identificação, como número e título, podem ser enviados sem esse pedido.
- **Ações no SEI:** nenhuma ação é executada sem aprovação do usuário, caso a caso. Isso vale para criar, editar, assinar, enviar e as demais ações. A senha de assinatura é digitada pelo usuário e enviada somente ao SEI.
- **Retenção pelo serviço de IA:**
  - No OpenRouter, o pedido exige que ele só seja encaminhado a provedores que não guardam os dados nem os usam para treinar modelos.
  - Nos demais serviços, valem os termos do contrato do usuário ou do órgão com o fabricante.
- **Outras consultas do painel** (nenhuma leva dados do usuário ou do SEI):
  - **cotação do dólar:** para mostrar o custo em reais, consultada no Banco Central (`olinda.bcb.gov.br`), com a AwesomeAPI (`economia.awesomeapi.com.br`) como reserva. A conversão pode ser desligada;
  - **catálogo de modelos:** a lista pública de modelos do serviço escolhido;
  - **arquivos de skills e coleções:** baixados dos endereços que o usuário cadastrar, como pastas do GitHub (`api.github.com`, `raw.githubusercontent.com`).
- **Políticas aplicáveis:** [OpenRouter](https://openrouter.ai/privacy), [OpenAI](https://openai.com/policies/privacy-policy), [Google](https://policies.google.com/privacy), [Anthropic](https://www.anthropic.com/legal/privacy).

### 4.3. Gestão de Atividades, Projetos e Prescrições

- **Natureza:** o módulo não é um serviço público do SEI Pro. Ele depende de um **servidor mantido pelo órgão** que o adota. O endereço e a chave de acesso são fornecidos pela área responsável do órgão. Sem essa configuração, o módulo não envia dados.
- **Destinatário:** exclusivamente o servidor do órgão, que é quem controla esses dados.
- **O que é enviado, depois de configurado:**
  - em toda chamada: a chave de acesso do usuário e a sigla da unidade;
  - ao abrir um processo: o número dele, para exibir as demandas vinculadas;
  - ao salvar demandas, afastamentos, prescrições ou projetos: os dados preenchidos pelo usuário e os números dos documentos SEI relacionados;
  - se o servidor do órgão habilitar: os processos favoritos (número, especificação, interessados e tipo) e relatórios de erro, que podem incluir captura de tela e registro técnico da página.
- **O que não é enviado:** o conteúdo dos documentos e a senha.
- **Integração com o PGD:** o envio de dados ao Programa de Gestão e Desempenho (API do PGD) é feito pelo servidor do órgão, não pelo navegador, e só quando o órgão ativa essa integração.

### 4.4. Demais funções

| Função | Quando | Destinatário | O que é enviado |
|---|---|---|---|
| **Legística e Link Legis** (busca de normas) | Ao inserir ou atualizar referências a normas no editor | Busca de normas do SEI Pro (`seipro.io`) | Tipo e número da norma, ou os termos pesquisados. O texto do documento não é enviado, e as consultas não são guardadas |
| **Equações (LaTeX)** | Ao gerar uma equação no editor | CodeCogs (`latex.codecogs.com`) | O texto da fórmula. A imagem gerada fica gravada no documento |
| **Link curto** | Ao pedir um link curto no editor | TinyURL (`tinyurl.com`) | O endereço a encurtar |
| **Importar Google Docs ou Planilhas** | Ao importar um documento publicado | Google (`docs.google.com`) | O pedido do documento cujo link o usuário informou. Nada do SEI é enviado |
| **Mapa dos favoritos** | Ao abrir o mapa ou pesquisar um endereço | OpenStreetMap (`tile.openstreetmap.org`, `nominatim.openstreetmap.org`) | A área exibida no mapa e o endereço digitado. Dados do processo não são enviados, e a localização do dispositivo não é solicitada |
| **Ditado por voz** | Ao ditar texto no editor | Serviço de reconhecimento de voz do navegador (Google no Chrome, Microsoft no Edge) | O áudio ditado, para transcrição. O SEI Pro não recebe nem guarda o áudio |
| **Estúdio de Fluxo** | Ao importar coleções de fluxos ou usar "Aprender de processo modelo" | GitHub e o serviço de IA configurado no Agente | O endereço da coleção. No aprendizado: títulos de documentos, unidades e descrições de andamentos do processo modelo |
| **Aviso de novidades** | Ao instalar ou atualizar a extensão | Site do SEI Pro (`seipro.app`) | Abre uma aba com a página de novidades, como uma visita comum ao site |

Políticas aplicáveis: [CodeCogs (termos de uso)](https://www.codecogs.com/terms), [TinyURL](https://tinyurl.com/app/privacy-policy), [Google](https://policies.google.com/privacy), [OpenStreetMap Foundation](https://osmfoundation.org/wiki/Privacy_Policy), [Microsoft](https://privacy.microsoft.com/pt-br/privacystatement), [GitHub](https://docs.github.com/pt/site-policy/privacy-policies/github-general-privacy-statement).

### 4.5. Controle institucional

A extensão **ainda não oferece configuração centralizada** por política de grupo. Os órgãos têm dois caminhos para controlar o uso:

- **Orientar os usuários:** as funções opcionais podem ser desligadas nas opções da extensão ou simplesmente não usadas. O Agente de IA não funciona sem uma chave cadastrada pelo próprio usuário.
- **Bloquear na rede:** para ter uma garantia técnica independente da configuração de cada usuário, basta bloquear no proxy ou no firewall os destinos que o órgão não quiser permitir. Os principais são:
  - `openrouter.ai`, `api.openai.com`, `generativelanguage.googleapis.com`, `api.anthropic.com` (Agente de IA);
  - `olinda.bcb.gov.br`, `economia.awesomeapi.com.br` (cotação do dólar);
  - `api.github.com`, `raw.githubusercontent.com` (skills e coleções de fluxos);
  - `seipro.io` (busca de normas);
  - `latex.codecogs.com` (equações);
  - `tinyurl.com` (link curto);
  - `docs.google.com` (importação do Google);
  - `tile.openstreetmap.org`, `nominatim.openstreetmap.org` (mapa).

---

## 5. Permissões do navegador

### 5.1. Permissões solicitadas

| Permissão | Justificativa |
|---|---|
| `storage` | Guardar configurações e preferências no navegador |
| `sidePanel` (Chrome e Edge) ou painel lateral (Firefox) | Exibir o painel do Agente de IA |
| Acesso às páginas do SEI | Os scripts da extensão só são carregados em endereços de instalações do SEI e do SIP (por exemplo, `/sei/`, `/sip/` e `controlador.php`, em domínios `.br` e `.org`) |
| Acesso opcional a outros endereços (`https://*/*`, `localhost`) | Pedido **somente** quando o usuário configura, no Agente de IA, um serviço diferente do OpenRouter, e **apenas para o endereço desse serviço**. O navegador mostra o pedido e o usuário decide |

### 5.2. Menor privilégio

- A extensão não pede acesso permanente a todos os sites.
- O acesso opcional é pedido um endereço por vez, com confirmação do usuário.
- A extensão não lê nem altera sites que não sejam o SEI.

---

## 6. Código aberto e auditabilidade

### 6.1. Transparência

O SEI Pro é um projeto de **código aberto**, e todo o comportamento descrito nesta política pode ser conferido no código.

- **Repositório:** [https://github.com/sei-pro/sei-pro](https://github.com/sei-pro/sei-pro)
- **Licença:** AGPL-3.0 (GNU Affero General Public License v3.0)
- **Histórico:** todas as alterações ficam registradas publicamente
- **Issues:** canal aberto para relatar problemas e sugestões

### 6.2. Distribuição oficial

A extensão é distribuída pelos canais oficiais:

- **Chrome Web Store:** [SEI Pro na Chrome Web Store](https://chrome.google.com/webstore/detail/sei-pro/pdbbapplhjopafpgidbgceccbbmehcjj)
- **Microsoft Edge Add-ons:** [SEI Pro no Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/sei-pro/gkhfbbbminanojfklpfmloaglckmlfne)
- **Firefox Add-ons:** [SEI Pro no Firefox Add-ons](https://addons.mozilla.org/pt-BR/firefox/addon/sei-pro/)

---

## 7. Direitos do titular (LGPD)

O desenvolvedor do SEI Pro **não recebe nem guarda dados pessoais dos usuários**. Por isso, os direitos previstos no art. 18 da LGPD se exercem assim:

- **Dados guardados no navegador:** o próprio usuário pode consultar, corrigir e apagar, pela extensão ou pelas configurações do navegador.
- **Dados enviados ao servidor de Atividades:** o controlador é o órgão que mantém o servidor. Os pedidos devem ser dirigidos a ele.
- **Dados enviados a serviços de terceiros** (serviço de IA, Google, OpenStreetMap e demais da seção 4): valem as políticas e os canais desses serviços.
- **Revogação:** o usuário pode desligar as funções opcionais ou desinstalar a extensão a qualquer momento.

Para esclarecimentos sobre esta política, use os canais da seção 10.

---

## 8. Crianças e adolescentes

O SEI Pro é uma ferramenta de trabalho destinada à Administração Pública. Ela não é direcionada a menores de 18 anos e não coleta dados de nenhum usuário, inclusive menores.

---

## 9. Segurança da informação

### 9.1. Medidas técnicas

- **Execução no navegador:** o SEI Pro não mantém dados de usuários fora do dispositivo.
- **Conexões cifradas:** os serviços externos da seção 4 são acessados por HTTPS. Endereços próprios informados pelo usuário ou pelo órgão (serviço de IA próprio, servidor de Atividades) seguem a configuração de quem os mantém.
- **Proteções do Agente de IA:**
  - substituição de dados pessoais antes do envio;
  - bloqueio de documentos sigilosos;
  - consentimento para documentos restritos;
  - aprovação de cada ação no SEI.
- **Restrição de código:** a extensão só executa código do próprio pacote; não carrega scripts de fora.
- **Código aberto e atualizações:** o código é auditável e as correções são publicadas no repositório e nas lojas.

### 9.2. Limitações

A segurança também depende de fatores externos: o dispositivo do usuário, as configurações do navegador, as políticas do órgão e as atualizações do sistema operacional.

### 9.3. Incidentes de segurança

1. Vulnerabilidades podem ser comunicadas pelo repositório no GitHub (Issues ou Security Advisories).
2. A vulnerabilidade é analisada e corrigida com prioridade.
3. Uma nova versão é publicada nas lojas de extensões.
4. Os usuários são avisados conforme a gravidade do incidente.

---

## 10. Identificação do desenvolvedor

### 10.1. Desenvolvedor

**Nome:** Pedro Henrique Soares  
**Vínculo:** Servidor Público Federal — Agência Nacional de Transportes Aquaviários (ANTAQ)  
**Função:** Desenvolvimento voluntário, sem fins lucrativos

### 10.2. Canais de contato

- **Repositório GitHub:** [https://github.com/sei-pro/sei-pro](https://github.com/sei-pro/sei-pro)
- **Issues:** [https://github.com/sei-pro/sei-pro/issues](https://github.com/sei-pro/sei-pro/issues)
- **Comunidade:** [Fórum ParticiPEN](https://www.gov.br/participamaisbrasil/sei-pro)

### 10.3. Suporte institucional

Questões sobre compatibilidade ou uso institucional podem ser levadas aos canais do projeto ou discutidas no fórum da comunidade ParticiPEN.

---

## 11. Alterações nesta política

### 11.1. Atualização

Esta política é revisada sempre que uma função nova passa a se comunicar com um serviço externo, ou quando mudam as exigências legais.

### 11.2. Aviso de alterações

As alterações relevantes são comunicadas:

- pela data de vigência no início deste documento;
- pela publicação no repositório GitHub;
- pelo histórico de versões da extensão.

### 11.3. Histórico de versões

| Versão | Data | Principais alterações |
|---|---|---|
| 3.0 | 28/09/2026 | Revisão completa. Inventário de todas as funções que se comunicam com serviços externos (Agente de IA, módulo de Atividades, busca de normas, equações, ditado, Estúdio de Fluxo e demais), com o dado enviado, a condição e o destinatário; correção da declaração de que a extensão não transmite dados; tabela de permissões atualizada; orientação de controle institucional por bloqueio de rede |
| 2.0 | 14/01/2026 | Reformulação para adequação à LGPD; detalhamento das integrações externas |
| 1.0 | 02/08/2020 | Versão inicial (modelo genérico) |

---

## 12. Disposições finais

### 12.1. Legislação aplicável

Esta política é regida pela legislação brasileira, em especial:

- Lei nº 13.709/2018 — Lei Geral de Proteção de Dados Pessoais (LGPD)
- Lei nº 12.965/2014 — Marco Civil da Internet
- Decreto nº 8.771/2016 — Regulamentação do Marco Civil

### 12.2. Foro competente

Fica eleito o foro da comarca de Brasília/DF para dirimir eventuais questões oriundas desta política.

### 12.3. Aceitação

A instalação e o uso da extensão SEI Pro implicam a aceitação desta política. Quem não concordar com ela deve deixar de instalar a extensão ou desinstalá-la.

---

## 13. Glossário

| Termo | Definição |
|---|---|
| **Dado pessoal** | Informação relacionada a pessoa natural identificada ou identificável (art. 5º, I, LGPD) |
| **Tratamento** | Toda operação realizada com dados pessoais: coleta, armazenamento, uso etc. (art. 5º, X, LGPD) |
| **Titular** | Pessoa natural a quem se referem os dados pessoais (art. 5º, V, LGPD) |
| **Controlador** | Pessoa a quem competem as decisões sobre o tratamento de dados pessoais (art. 5º, VI, LGPD) |
| **Pseudonimização** | Substituição de um dado pessoal por um rótulo, de modo que ele não possa ser associado ao titular sem informação guardada à parte (art. 13, § 4º, LGPD) |
| **Chave de API** | Credencial fornecida por um serviço de IA para autorizar e cobrar o uso |
| **LGPD** | Lei Geral de Proteção de Dados Pessoais — Lei nº 13.709/2018 |
| **SEI** | Sistema Eletrônico de Informações |
| **API** | Application Programming Interface — Interface de Programação de Aplicações |

---

**SEI Pro** — Extensão de código aberto para o Sistema Eletrônico de Informações  
Desenvolvido pela comunidade, para a comunidade.
