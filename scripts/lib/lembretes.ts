// Montagem das mensagens de lembrete (lógica pura, sem Firebase): testada em
// tests/lembretes.test.ts. O envio fica em scripts/lembretes.ts.
//
// As regras de faltas/horários são as mesmas do front
// (faltaket/src/features/materias/model.ts). Se mudar lá, mude aqui.

export type Turno = 'manha' | 'noite'

export interface Horario {
  dia: number // 1 = segunda ... 7 = domingo
  inicio?: string
  sala?: string
  aulas?: number
}

export interface Materia {
  id: string
  nome: string
  diaSemana?: number // formato antigo
  horarios?: Horario[]
  maxFaltas: number
  faltas: { aulas?: number; justificada?: boolean }[]
}

export type TipoEvento = 'prova' | 'trabalho' | 'entrega' | 'outro'

export interface Evento {
  titulo: string
  tipo: TipoEvento
  /** "AAAA-MM-DD" no fuso de São Paulo */
  dia: string
  /** "HH:MM" se o evento tiver hora */
  hora?: string
  concluido: boolean
  materiaNome?: string
}

export interface Preferencias {
  aulas: boolean
  provas: boolean
  entregas: boolean
  risco: boolean
}

export interface Lembrete {
  titulo: string
  corpo: string
  /** caminho do app aberto ao tocar na notificação */
  link: string
}

const EMOJI: Record<TipoEvento, string> = {
  prova: '📝',
  trabalho: '📚',
  entrega: '📤',
  outro: '📌',
}
const MAX_LINHAS = 5

export function horariosDe(m: Materia): Horario[] {
  if (m.horarios?.length) return m.horarios
  return m.diaSemana ? [{ dia: m.diaSemana, aulas: 1 }] : []
}

export function faltasContadas(m: Materia) {
  return m.faltas.reduce((s, f) => s + (f.justificada ? 0 : (f.aulas ?? 1)), 0)
}

/** Texto de risco (ou null se ainda pode faltar 2+ vezes). */
export function avisoDeRisco(m: Materia) {
  const restantes = m.maxFaltas - faltasContadas(m)
  if (restantes < 0) return 'passou do limite de faltas'
  if (restantes === 0) return 'não pode faltar mais'
  if (restantes === 1) return 'só pode faltar mais 1 vez'
  return null
}

/** "AAAA-MM-DD" + n dias */
export function somarDias(diaIso: string, n: number) {
  const [a, m, d] = diaIso.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Dia da semana (1 = segunda ... 7 = domingo) de uma data "AAAA-MM-DD". */
export function diaDaSemana(diaIso: string) {
  const [a, m, d] = diaIso.split('-').map(Number) as [number, number, number]
  const js = new Date(Date.UTC(a, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

function limitar(linhas: string[]) {
  if (linhas.length <= MAX_LINHAS) return linhas.join('\n')
  const resto = linhas.length - (MAX_LINHAS - 1)
  return [...linhas.slice(0, MAX_LINHAS - 1), `+ ${resto} outros`].join('\n')
}

const descreverEvento = (e: Evento) =>
  `${EMOJI[e.tipo]} ${e.titulo}${e.materiaNome && !e.titulo.includes(e.materiaNome) ? ` (${e.materiaNome})` : ''}${e.hora ? ` às ${e.hora}` : ''}`

const querEvento = (e: Evento, p: Preferencias) =>
  !e.concluido && (e.tipo === 'prova' ? p.provas : p.entregas)

/**
 * Manhã (07h): aulas de hoje (com horário, sala e risco) + provas/entregas de hoje.
 * Noite (18h): o que vence amanhã + trabalhos/entregas em 3 dias.
 * Retorna null quando não há nada a avisar.
 */
export function montarLembrete(
  turno: Turno,
  hoje: string,
  materias: Materia[],
  eventos: Evento[],
  p: Preferencias,
): Lembrete | null {
  if (turno === 'manha') {
    const dia = diaDaSemana(hoje)
    const aulas = p.aulas
      ? materias
          .flatMap((m) =>
            horariosDe(m)
              .filter((h) => h.dia === dia)
              .map((h) => ({ m, h })),
          )
          .sort((a, b) => (a.h.inicio ?? '99').localeCompare(b.h.inicio ?? '99'))
          .map(({ m, h }) => {
            const risco = p.risco ? avisoDeRisco(m) : null
            return [m.nome, h.inicio, h.sala && `sala ${h.sala}`, risco && `⚠️ ${risco}`]
              .filter(Boolean)
              .join(' · ')
          })
      : []
    const deHoje = eventos
      .filter((e) => e.dia === hoje && querEvento(e, p))
      .sort((a, b) => (a.hora ?? '99').localeCompare(b.hora ?? '99'))
      .map((e) => `Hoje: ${descreverEvento(e)}`)

    if (aulas.length === 0 && deHoje.length === 0) return null
    return {
      titulo: aulas.length ? 'Hoje tem aula 📚' : 'Compromissos de hoje 📌',
      corpo: limitar([...deHoje, ...aulas]),
      link: '/',
    }
  }

  const amanha = somarDias(hoje, 1)
  const emTres = somarDias(hoje, 3)
  const deAmanha = eventos.filter((e) => e.dia === amanha && querEvento(e, p))
  const emTresDias = eventos.filter(
    (e) => e.dia === emTres && e.tipo !== 'prova' && querEvento(e, p),
  )
  if (deAmanha.length === 0 && emTresDias.length === 0) return null

  const temProva = deAmanha.some((e) => e.tipo === 'prova')
  return {
    titulo: temProva ? 'Amanhã tem prova! 📝' : 'Lembrete de prazos ⏰',
    corpo: limitar([
      ...deAmanha.map((e) => `Amanhã: ${descreverEvento(e)}`),
      ...emTresDias.map((e) => `Em 3 dias: ${descreverEvento(e)}`),
    ]),
    link: '/agenda',
  }
}
