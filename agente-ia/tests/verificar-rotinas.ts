/**
 * Rotinas: quando uma pergunta agendada está vencida.
 *
 * O que mais importa é não disparar duas vezes pela mesma janela e não
 * acumular execuções de quem ficou uma semana fora.
 */

import {
  alarmesDe,
  estourouTeto,
  avaliarPassos,
  descreverFrequencia,
  MAX_EXECUCOES,
  normalizarRotina,
  registrarExecucao,
  textoDoAviso,
  vencidas,
  vencimento,
  type Rotina,
} from "../src/painel/rotinas";
import { checar, secao } from "./util";

const rotina = (r: Partial<Rotina> = {}): Rotina => ({
  id: "r1",
  nome: "Parados",
  pergunta: "liste os processos parados",
  frequencia: "diaria",
  hora: "08:00",
  ativa: true,
  alcance: "leitura",
  ...r,
});

// 23/09/2026 é uma quarta-feira.
const quarta10h = new Date(2026, 8, 23, 10, 0);
const quarta7h = new Date(2026, 8, 23, 7, 0);

export function verificarRotinas(): void {
  secao("rotinas: diaria");
  checar("antes da hora, nao vence", vencidas([rotina()], quarta7h).length === 0);
  checar("depois da hora, vence", vencidas([rotina()], quarta10h).length === 1);
  checar("desligada nunca vence", vencidas([rotina({ ativa: false })], quarta10h).length === 0);
  checar("sem pergunta nao vence", vencidas([rotina({ pergunta: "  " })], quarta10h).length === 0);
  const jaRodouHoje = rotina({ ultimaEm: new Date(2026, 8, 23, 8, 30).getTime() });
  checar("nao roda duas vezes no mesmo dia", vencidas([jaRodouHoje], quarta10h).length === 0);
  const rodouOntem = rotina({ ultimaEm: new Date(2026, 8, 22, 9, 0).getTime() });
  checar("rodou ontem, vence de novo hoje", vencidas([rodouOntem], quarta10h).length === 1);

  secao("rotinas: semanal");
  const semanal = rotina({ frequencia: "semanal", diaSemana: 1 }); // segunda
  checar("na quarta, a segunda ja passou: vence", vencidas([semanal], quarta10h).length === 1);
  checar("mas nao se ja rodou na segunda", vencidas([{ ...semanal, ultimaEm: new Date(2026, 8, 21, 9, 0).getTime() }], quarta10h).length === 0);
  const naQuarta = rotina({ frequencia: "semanal", diaSemana: 3 });
  checar("no proprio dia, depois da hora, vence", vencidas([naQuarta], quarta10h).length === 1);
  checar("no proprio dia, antes da hora, nao vence", vencidas([naQuarta], quarta7h).length === 0);
  checar("quem sumiu uma semana volta com UMA pendencia", vencidas([{ ...semanal, ultimaEm: new Date(2026, 8, 7, 9, 0).getTime() }], quarta10h).length === 1);

  secao("rotinas: mensal");
  const mensal = rotina({ frequencia: "mensal", diaMes: 20 });
  checar("dia 23, o dia 20 ja passou: vence", vencidas([mensal], quarta10h).length === 1);
  checar("mas nao se rodou no dia 20", vencidas([{ ...mensal, ultimaEm: new Date(2026, 8, 20, 9, 0).getTime() }], quarta10h).length === 0);
  const dia25 = rotina({ frequencia: "mensal", diaMes: 25 });
  const venc25 = vencimento(dia25, quarta10h);
  checar("dia 25 ainda nao chegou: a janela e a do mes passado", venc25?.getMonth() === 7, venc25?.toISOString());
  checar("e ja rodou no mes passado, entao nao vence", vencidas([{ ...dia25, ultimaEm: new Date(2026, 7, 25, 9, 0).getTime() }], quarta10h).length === 0);

  secao("rotinas: como aparece para o usuario");
  checar("diaria", descreverFrequencia(rotina()) === "todo dia, a partir das 08:00");
  checar("semanal diz o dia", descreverFrequencia(rotina({ frequencia: "semanal", diaSemana: 5 })).includes("sexta"));
  checar("mensal diz o dia do mes", descreverFrequencia(rotina({ frequencia: "mensal", diaMes: 10 })).includes("dia 10"));

  secao("rotinas: horaria");
  const horaria = rotina({ frequencia: "horaria" });
  const dezEmPonto = new Date(2026, 8, 23, 10, 0);
  const dezEMeia = new Date(2026, 8, 23, 10, 30);
  checar("sem nunca ter rodado, vence", vencidas([horaria], dezEMeia).length === 1);
  checar("a janela e a hora cheia", vencimento(horaria, dezEMeia)?.getMinutes() === 0);
  const rodou10h05 = rotina({ frequencia: "horaria", ultimaEm: new Date(2026, 8, 23, 10, 5).getTime() });
  checar("nao repete na mesma hora", vencidas([rodou10h05], dezEMeia).length === 0);
  const rodou9h59 = rotina({ frequencia: "horaria", ultimaEm: new Date(2026, 8, 23, 9, 59).getTime() });
  checar("hora nova vence de novo", vencidas([rodou9h59], dezEmPonto).length === 1);

  secao("rotinas: dias uteis");
  const uteis = rotina({ frequencia: "uteis" });
  checar("quarta depois da hora vence", vencidas([uteis], quarta10h).length === 1);
  checar("quarta antes da hora nao vence", vencidas([uteis], quarta7h).length === 0);
  const sabado = new Date(2026, 8, 26, 10, 0);
  const domingo = new Date(2026, 8, 27, 10, 0);
  checar("sabado nao vence", vencidas([uteis], sabado).length === 0);
  checar("domingo nao vence", vencidas([uteis], domingo).length === 0);
  const segunda = new Date(2026, 8, 28, 10, 0);
  const rodouSexta = rotina({ frequencia: "uteis", ultimaEm: new Date(2026, 8, 25, 9, 0).getTime() });
  checar("segunda cobre o fim de semana com UMA execucao", vencidas([rodouSexta], segunda).length === 1);

  secao("rotinas: manual");
  checar("manual nunca vence", vencidas([rotina({ frequencia: "manual" })], quarta10h).length === 0);
  checar("manual nao tem vencimento", vencimento(rotina({ frequencia: "manual" }), quarta10h) === null);
  checar("manual se descreve", descreverFrequencia(rotina({ frequencia: "manual" })) === "quando voc\u00EA mandar");
  checar("horaria se descreve", descreverFrequencia(rotina({ frequencia: "horaria" })) === "a cada hora");
  checar("uteis diz que nao conta feriado", /feriado/.test(descreverFrequencia(rotina({ frequencia: "uteis" }))));

  secao("rotinas: instrucoes por skill");
  checar("sem pergunta mas com skill, vence", vencidas([rotina({ pergunta: "  ", skills: ["s1"] })], quarta10h).length === 1);
  checar("sem pergunta e sem skill, nao vence", vencidas([rotina({ pergunta: " ", skills: [] })], quarta10h).length === 0);

  secao("rotinas: rotina gravada na versao anterior");
  const antiga = normalizarRotina({
    id: "velha",
    nome: "Parados",
    pergunta: "liste",
    frequencia: "diaria",
    hora: "08:00",
    ativa: true,
    ultimaEm: 1_700_000_000_000,
    ultimoResultado: "8 processos parados",
  });
  checar("continua valendo", antiga !== null);
  checar("nasce como leitura", antiga?.alcance === "leitura");
  checar("o ultimo resultado vira execucao", antiga?.ultimas?.[0].resumo === "8 processos parados", antiga?.ultimas);
  checar("frequencia desconhecida e recusada", normalizarRotina({ id: "x", nome: "x", pergunta: "x", frequencia: "a cada lua", hora: "08:00", ativa: true }) === null);
  checar(
    "alcance desconhecido cai para leitura",
    normalizarRotina({ id: "y", nome: "y", pergunta: "y", frequencia: "diaria", hora: "08:00", ativa: true, alcance: "tudo" })?.alcance === "leitura",
  );
  checar(
    "rotina autonoma gravada e lida com o aviso ligado",
    normalizarRotina({ id: "z", nome: "z", pergunta: "z", frequencia: "diaria", hora: "08:00", ativa: true, alcance: "autonoma", autorizadas: ["processo_marcador"] })?.avisar === true,
  );

  secao("rotinas: historico de execucoes");
  let comHistorico = rotina();
  for (let i = 0; i < 12; i += 1) comHistorico = registrarExecucao(comHistorico, { em: 1000 + i, ok: true, resumo: `r${i}`, custo: 0.01 });
  checar("guarda no maximo 10", comHistorico.ultimas?.length === MAX_EXECUCOES, comHistorico.ultimas?.length);
  checar("a mais nova vem primeiro", comHistorico.ultimas?.[0].resumo === "r11", comHistorico.ultimas?.[0]);
  checar("marca a ultima execucao", comHistorico.ultimaEm === 1011);

  secao("rotinas: cercas da rotina autonoma");
  const auto = (autorizadas: string[]) => rotina({ alcance: "autonoma", autorizadas });
  const passo = (tool: string, efeito: "escrita" | "irreversivel" | "assinatura" | "leitura") => ({ tool, efeito } as const);

  checar("tool autorizada passa", avaliarPassos(auto(["processo_marcador"]), [passo("processo_marcador", "escrita")]).aprovado);
  const fora = avaliarPassos(auto(["processo_marcador"]), [passo("documento_excluir", "escrita")]);
  checar("tool fora da lista reprova o plano inteiro", !fora.aprovado && /n\u00E3o est\u00E1/i.test(fora.motivo ?? ""), fora);
  const irrev = avaliarPassos(auto(["documento_excluir"]), [passo("documento_excluir", "irreversivel")]);
  checar("irreversivel nunca passa, mesmo autorizada", !irrev.aprovado && /irrevers\u00EDvel/i.test(irrev.motivo ?? ""), irrev);
  const assina = avaliarPassos(auto(["documento_assinar"]), [passo("documento_assinar", "assinatura")]);
  checar("assinatura nunca passa", !assina.aprovado && /assinatura/i.test(assina.motivo ?? ""), assina);
  const misto = avaliarPassos(auto(["processo_marcador"]), [passo("processo_marcador", "escrita"), passo("documento_excluir", "irreversivel")]);
  checar("um passo barrado reprova o plano todo", !misto.aprovado, misto);
  checar("autonoma sem lista de autorizadas nao escreve nada", !avaliarPassos(rotina({ alcance: "autonoma" }), [passo("processo_marcador", "escrita")]).aprovado);
  const soLeitura = avaliarPassos(rotina(), [passo("processo_marcador", "escrita")]);
  checar("rotina de leitura reprova qualquer escrita", !soLeitura.aprovado && /leitura/i.test(soLeitura.motivo ?? ""), soLeitura);
  const paraAprovar = avaliarPassos(rotina({ alcance: "aprovar" }), [passo("processo_marcador", "escrita")]);
  checar("alcance aprovar nao decide sozinho", !paraAprovar.aprovado && /aprova\u00E7\u00E3o do usu\u00E1rio/i.test(paraAprovar.motivo ?? ""), paraAprovar);
  checar("plano so de leitura passa em qualquer alcance", avaliarPassos(rotina(), [passo("processos_listar", "leitura")]).aprovado);

  secao("rotinas: alarmes do navegador");
  const paraAlarme = [
    rotina({ id: "a", frequencia: "horaria" }),
    rotina({ id: "b", frequencia: "manual" }),
    rotina({ id: "c", frequencia: "diaria", ativa: false }),
    rotina({ id: "d", frequencia: "semanal", diaSemana: 2 }),
    rotina({ id: "e", frequencia: "diaria", pergunta: "  ", skills: [] }),
  ];
  const alarmes = alarmesDe(paraAlarme);
  checar("manual nao tem alarme", !alarmes.some((a) => a.nome.endsWith(":b")), alarmes);
  checar("desligada nao tem alarme", !alarmes.some((a) => a.nome.endsWith(":c")));
  checar("sem instrucao nao tem alarme", !alarmes.some((a) => a.nome.endsWith(":e")));
  checar("as outras tem", alarmes.length === 2 && alarmes.every((a) => a.nome.startsWith("rotina:")), alarmes);
  checar("o periodo nunca e menor que uma hora", alarmes.every((a) => a.periodoMin >= 60), alarmes);

  secao("rotinas: texto do aviso");
  const okExec = { em: 1, ok: true, resumo: "3 processos parados\nDetalhes abaixo", custo: 0.02 };
  const aviso = textoDoAviso(rotina({ nome: "Parados" }), okExec, false);
  checar("o titulo diz qual rotina", aviso.titulo === "Rotina: Parados", aviso);
  checar("o corpo e a primeira linha util", aviso.corpo === "3 processos parados", aviso);
  const falhou = textoDoAviso(rotina({ nome: "Parados" }), { em: 1, ok: false, resumo: "a aba do SEI caiu", custo: 0 }, false);
  checar("falha aparece como falha", /^Falhou: a aba do SEI caiu/.test(falhou.corpo), falhou);
  const desligada = textoDoAviso(rotina({ nome: "Marcar" }), okExec, true);
  checar("rotina desligada por falha de escrita avisa isso", /desligada/.test(desligada.corpo), desligada);
  const vazia = textoDoAviso(rotina(), { em: 1, ok: true, resumo: "   ", custo: 0 }, false);
  checar("resultado vazio ainda rende um aviso legivel", vazia.corpo.length > 0, vazia);

  secao("rotinas: teto por execucao");
  const comTeto = rotina({ teto: 1 });
  checar("dentro do teto, segue", !estourouTeto(comTeto, 0.1, 5.5));
  checar("no limite, segue", !estourouTeto(comTeto, 1 / 5.5, 5.5));
  checar("acima do teto, para", estourouTeto(comTeto, 0.2, 5.5));
  checar("sem teto, nunca para", !estourouTeto(rotina(), 999, 5.5));
  checar("teto zero e o mesmo que sem teto", !estourouTeto(rotina({ teto: 0 }), 999, 5.5));
  checar("cotacao maior estoura mais cedo", estourouTeto(rotina({ teto: 1 }), 0.19, 6));
}
