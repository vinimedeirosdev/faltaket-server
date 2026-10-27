/**
 * Testes das Security Rules do Firestore (firestore.rules).
 *
 * Rodar com:  npm run test:rules
 * (sobe o emulador do Firestore via `firebase emulators:exec` — exige Java 21+)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  Timestamp,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const PROJECT_ID = 'demo-faltaket'
const ALICE = 'alice-uid'
const BOB = 'bob-uid'
const MATERIA_ID = 'materia-1'
const FOTO_WEBP = 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='

let env: RulesTestEnvironment

// O contexto do rules-unit-testing devolve a instância "compat"; as funções
// modulares aceitam essa instância em runtime (elas desembrulham `_delegate`).
function dbAs(uid: string | null): Firestore {
  const ctx = uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()
  return ctx.firestore() as unknown as Firestore
}

function validUser(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Alice',
    username: 'alice',
    createdAt: serverTimestamp(),
    ...overrides,
  }
}

function validMateria(overrides: Record<string, unknown> = {}) {
  return {
    nome: 'Cálculo I',
    diaSemana: 1,
    maxFaltas: 10,
    cor: 'violet',
    faltas: [
      { id: 'f1', data: Timestamp.now() },
      { id: 'f2', data: null, obs: 'atestado' },
    ],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  }
}

/** Popula dados ignorando as rules (como o Admin SDK faria). */
async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore
    await setDoc(doc(db, 'users', ALICE), {
      name: 'Alice',
      username: 'alice',
      createdAt: Timestamp.now(),
    })
    await setDoc(doc(db, 'users', ALICE, 'materias', MATERIA_ID), {
      ...validMateria(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    })
    await setDoc(doc(db, 'users', BOB), {
      name: 'Bob',
      username: 'bob',
      createdAt: Timestamp.now(),
      features: { termo: true },
    })
  })
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(fileURLToPath(new URL('../firestore.rules', import.meta.url)), 'utf8'),
    },
  })
})

afterAll(async () => {
  await env?.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
})

// ======================================================================== users

describe('users/{uid}', () => {
  it('dono cria o próprio perfil com o formato válido', async () => {
    await assertSucceeds(setDoc(doc(dbAs(ALICE), 'users', ALICE), validUser()))
  })

  it('dono lê, atualiza o name e apaga o próprio perfil', async () => {
    await seed()
    const db = dbAs(ALICE)
    await assertSucceeds(getDoc(doc(db, 'users', ALICE)))
    await assertSucceeds(updateDoc(doc(db, 'users', ALICE), { name: 'Alice Silva' }))
    await assertSucceeds(deleteDoc(doc(db, 'users', ALICE)))
  })

  it('outro usuário não lê nem escreve o perfil alheio', async () => {
    await seed()
    const db = dbAs(BOB)
    await assertFails(getDoc(doc(db, 'users', ALICE)))
    await assertFails(updateDoc(doc(db, 'users', ALICE), { name: 'Hacker' }))
    await assertFails(deleteDoc(doc(db, 'users', ALICE)))
    await assertFails(setDoc(doc(db, 'users', 'novo-uid'), validUser({ username: 'novo' })))
  })

  it('não autenticado é negado', async () => {
    await seed()
    const db = dbAs(null)
    await assertFails(getDoc(doc(db, 'users', ALICE)))
    await assertFails(setDoc(doc(db, 'users', ALICE), validUser()))
    await assertFails(deleteDoc(doc(db, 'users', ALICE)))
  })

  it('cliente não consegue criar perfil com features', async () => {
    await assertFails(
      setDoc(doc(dbAs(ALICE), 'users', ALICE), validUser({ features: { termo: true } })),
    )
    await assertFails(
      setDoc(doc(dbAs(ALICE), 'users', ALICE), validUser({ features: { termo: false } })),
    )
  })

  it('cliente não consegue adicionar, alterar ou remover features', async () => {
    await seed()
    // Alice não tem features: não pode se dar o Termo.
    await assertFails(updateDoc(doc(dbAs(ALICE), 'users', ALICE), { features: { termo: true } }))
    await assertFails(updateDoc(doc(dbAs(ALICE), 'users', ALICE), { 'features.termo': true }))
    // Bob tem features: não pode alterar nem remover.
    await assertFails(updateDoc(doc(dbAs(BOB), 'users', BOB), { 'features.termo': false }))
    await assertFails(updateDoc(doc(dbAs(BOB), 'users', BOB), { features: deleteField() }))
    // set sem merge sobrescreveria o doc inteiro (removendo features): negado.
    await assertFails(setDoc(doc(dbAs(BOB), 'users', BOB), validUser({ name: 'Bob', username: 'bob' })))
    // Mas Bob pode trocar o próprio nome normalmente.
    await assertSucceeds(updateDoc(doc(dbAs(BOB), 'users', BOB), { name: 'Bob Souza' }))
  })

  it('update só pode alterar name', async () => {
    await seed()
    const db = dbAs(ALICE)
    await assertFails(updateDoc(doc(db, 'users', ALICE), { username: 'outra' }))
    await assertFails(updateDoc(doc(db, 'users', ALICE), { createdAt: Timestamp.now() }))
    await assertFails(updateDoc(doc(db, 'users', ALICE), { password: '123' }))
    await assertFails(updateDoc(doc(db, 'users', ALICE), { name: '' }))
    await assertFails(updateDoc(doc(db, 'users', ALICE), { name: 'x'.repeat(41) }))
  })

  it('dono adiciona, troca e remove a foto de perfil', async () => {
    await seed()
    const ref = doc(dbAs(ALICE), 'users', ALICE)
    await assertSucceeds(updateDoc(ref, { foto: FOTO_WEBP }))
    await assertSucceeds(updateDoc(ref, { foto: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }))
    await assertSucceeds(updateDoc(ref, { foto: deleteField() }))
  })

  it('foto inválida, grande demais ou de outro usuário é negada', async () => {
    await seed()
    const ref = doc(dbAs(ALICE), 'users', ALICE)
    await assertFails(updateDoc(ref, { foto: 'https://exemplo.com/foto.png' }))
    await assertFails(updateDoc(ref, { foto: 'data:image/svg+xml;base64,PHN2Zz4=' }))
    await assertFails(updateDoc(ref, { foto: 'data:text/html;base64,PGgxPg==' }))
    await assertFails(updateDoc(ref, { foto: 123 }))
    await assertFails(updateDoc(ref, { foto: 'data:image/webp;base64,' + 'A'.repeat(150_000) }))
    await assertFails(updateDoc(doc(dbAs(BOB), 'users', ALICE), { foto: FOTO_WEBP }))
  })

  it('create rejeita campos inválidos', async () => {
    const ref = doc(dbAs(ALICE), 'users', ALICE)
    await assertFails(setDoc(ref, validUser({ name: '' })))
    await assertFails(setDoc(ref, validUser({ name: 'x'.repeat(41) })))
    await assertFails(setDoc(ref, validUser({ name: 123 })))
    await assertFails(setDoc(ref, validUser({ username: 'Alice' })))
    await assertFails(setDoc(ref, validUser({ username: ' alice ' })))
    await assertFails(setDoc(ref, validUser({ username: '' })))
    await assertFails(setDoc(ref, validUser({ createdAt: 'ontem' })))
    await assertFails(setDoc(ref, validUser({ password: 'segredo' })))
    await assertFails(setDoc(ref, { name: 'Alice', username: 'alice' })) // sem createdAt
  })
})

// ===================================================================== materias

describe('users/{uid}/materias/{materiaId}', () => {
  it('dono faz CRUD completo', async () => {
    await seed()
    const db = dbAs(ALICE)
    const ref = doc(db, 'users', ALICE, 'materias', 'nova')
    await assertSucceeds(setDoc(ref, validMateria()))
    await assertSucceeds(getDoc(ref))
    await assertSucceeds(
      updateDoc(ref, {
        faltas: [{ id: 'f9', data: Timestamp.now(), obs: 'chuva' }],
        updatedAt: serverTimestamp(),
      }),
    )
    await assertSucceeds(deleteDoc(ref))
  })

  it('faltas podem ultrapassar maxFaltas (reprovou)', async () => {
    await seed()
    const faltas = Array.from({ length: 15 }, (_, i) => ({ id: `f${i}`, data: null }))
    await assertSucceeds(
      setDoc(doc(dbAs(ALICE), 'users', ALICE, 'materias', 'm'), validMateria({ maxFaltas: 3, faltas })),
    )
  })

  it('outro usuário não lê nem escreve matérias alheias', async () => {
    await seed()
    const db = dbAs(BOB)
    const ref = doc(db, 'users', ALICE, 'materias', MATERIA_ID)
    await assertFails(getDoc(ref))
    await assertFails(updateDoc(ref, { nome: 'Hackeada' }))
    await assertFails(deleteDoc(ref))
    await assertFails(setDoc(doc(db, 'users', ALICE, 'materias', 'x'), validMateria()))
  })

  it('não autenticado é negado', async () => {
    await seed()
    const db = dbAs(null)
    const ref = doc(db, 'users', ALICE, 'materias', MATERIA_ID)
    await assertFails(getDoc(ref))
    await assertFails(setDoc(doc(db, 'users', ALICE, 'materias', 'x'), validMateria()))
    await assertFails(deleteDoc(ref))
  })

  it('rejeita campos inválidos na criação', async () => {
    await seed()
    const ref = doc(dbAs(ALICE), 'users', ALICE, 'materias', 'invalida')
    const invalidos: Record<string, unknown>[] = [
      { nome: '' },
      { nome: 'x'.repeat(41) },
      { nome: 42 },
      { diaSemana: 0 },
      { diaSemana: 8 },
      { diaSemana: 1.5 },
      { diaSemana: '1' },
      { maxFaltas: 0 },
      { maxFaltas: 100 },
      { maxFaltas: 2.5 },
      { cor: 'red' },
      { cor: 'VIOLET' },
      { faltas: 'nenhuma' },
      { faltas: { a: 1 } },
      { faltas: Array.from({ length: 201 }, (_, i) => ({ id: `f${i}`, data: null })) },
      { createdAt: 'hoje' },
      { updatedAt: 123 },
      { extra: true },
      { id_user: ALICE },
    ]
    for (const override of invalidos) {
      await assertFails(setDoc(ref, validMateria(override)))
    }
  })

  it('rejeita matéria sem campos obrigatórios', async () => {
    await seed()
    const ref = doc(dbAs(ALICE), 'users', ALICE, 'materias', 'incompleta')
    const { cor: _cor, ...semCor } = validMateria()
    await assertFails(setDoc(ref, semCor))
  })

  it('rejeita update que deixa a matéria inválida', async () => {
    await seed()
    const ref = doc(dbAs(ALICE), 'users', ALICE, 'materias', MATERIA_ID)
    await assertFails(updateDoc(ref, { maxFaltas: 0 }))
    await assertFails(updateDoc(ref, { cor: 'black' }))
    await assertFails(updateDoc(ref, { diaSemana: 9 }))
    await assertFails(updateDoc(ref, { nome: deleteField() }))
    await assertFails(updateDoc(ref, { semana: 1 }))
    await assertSucceeds(updateDoc(ref, { nome: 'Cálculo II', diaSemana: 7, updatedAt: serverTimestamp() }))
  })
})

// ============================================================ caminhos inválidos

describe('negado por padrão', () => {
  it('coleções fora do contrato são negadas, inclusive para logados', async () => {
    const db = dbAs(ALICE)
    await assertFails(getDoc(doc(db, 'materias', 'qualquer')))
    await assertFails(setDoc(doc(db, 'materias', 'qualquer'), { nome: 'x' }))
    await assertFails(setDoc(doc(db, 'outra', 'x'), { a: 1 }))
    await assertFails(
      setDoc(doc(db, 'users', ALICE, 'materias', MATERIA_ID, 'faltas', 'f1'), { active: true }),
    )
  })
})
