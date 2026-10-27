import { describe, expect, it } from 'vitest'
import {
  diaDaSemana,
  montarLembrete,
  somarDias,
  type Evento,
  type Materia,
  type Preferencias,
} from '../scripts/lib/lembretes.ts'

const tudo: Preferencias = {
  aulas: true,
  provas: true,
  entregas: true,
  risco: true,
}
const HOJE = '2026-10-27' // terça

const materias: Materia[] = [
  {
    id: 'a',
    nome: 'Anatomia',
    horarios: [{ dia: 2, inicio: '19:00', sala: '204', aulas: 2 }],
    maxFaltas: 4,
    faltas: [{ aulas: 2 }, { aulas: 1 }], // 3 de 4 → só pode faltar mais 1
  },
  { id: 'b', nome: 'Bioquímica', diaSemana: 2, maxFaltas: 5, faltas: [] }, // formato antigo
  {
    id: 'c',
    nome: 'Cálculo',
    horarios: [{ dia: 3, inicio: '08:00' }],
    maxFaltas: 5,
    faltas: [],
  },
]

const ev = (e: Partial<Evento>): Evento => ({
  titulo: 'P1',
  tipo: 'prova',
  dia: HOJE,
  concluido: false,
  ...e,
})

describe('datas', () => {
  it('somarDias atravessa meses e diaDaSemana', () => {
    expect(somarDias('2026-10-30', 3)).toBe('2026-11-02')
    expect(diaDaSemana(HOJE)).toBe(2)
    expect(diaDaSemana('2026-11-01')).toBe(7)
  })
})

describe('manhã', () => {
  it('lista as aulas de hoje com horário, sala e risco (inclui formato antigo)', () => {
    const l = montarLembrete('manha', HOJE, materias, [], tudo)!
    expect(l.titulo).toBe('Hoje tem aula 📚')
    expect(l.corpo).toBe('Anatomia · 19:00 · sala 204 · ⚠️ só pode faltar mais 1 vez\nBioquímica')
    expect(l.link).toBe('/')
  })

  it('inclui provas de hoje antes das aulas e respeita preferências', () => {
    const l = montarLembrete(
      'manha',
      HOJE,
      materias,
      [
        ev({ titulo: 'P1 de Anatomia', hora: '08:00' }),
        ev({ tipo: 'entrega', titulo: 'Relatório' }),
      ],
      { ...tudo, entregas: false, risco: false },
    )!
    expect(l.corpo.split('\n')).toEqual([
      'Hoje: 📝 P1 de Anatomia às 08:00',
      'Anatomia · 19:00 · sala 204',
      'Bioquímica',
    ])
  })

  it('nada a avisar → null', () => {
    expect(montarLembrete('manha', '2026-10-31', materias, [], tudo)).toBeNull() // sábado
    expect(montarLembrete('manha', HOJE, materias, [], { ...tudo, aulas: false })).toBeNull()
  })
})

describe('noite', () => {
  it('provas de amanhã e entregas em 3 dias', () => {
    const l = montarLembrete(
      'noite',
      HOJE,
      materias,
      [
        ev({ dia: '2026-10-28', materiaNome: 'Cálculo', hora: '08:00' }),
        ev({ dia: '2026-10-30', tipo: 'trabalho', titulo: 'Seminário' }),
        ev({ dia: '2026-10-30', tipo: 'prova', titulo: 'P2' }), // prova em 3 dias: não avisa
        ev({
          dia: '2026-10-28',
          tipo: 'entrega',
          titulo: 'Lista',
          concluido: true,
        }),
      ],
      tudo,
    )!
    expect(l.titulo).toBe('Amanhã tem prova! 📝')
    expect(l.corpo).toBe('Amanhã: 📝 P1 (Cálculo) às 08:00\nEm 3 dias: 📚 Seminário')
    expect(l.link).toBe('/agenda')
  })

  it('sem provas: título de prazos; muitos itens são resumidos', () => {
    const muitos = Array.from({ length: 8 }, (_, i) =>
      ev({ dia: '2026-10-28', tipo: 'entrega', titulo: `E${i}` }),
    )
    const l = montarLembrete('noite', HOJE, [], muitos, tudo)!
    expect(l.titulo).toBe('Lembrete de prazos ⏰')
    expect(l.corpo.split('\n')).toHaveLength(5)
    expect(l.corpo).toContain('+ 4 outros')
  })
})
