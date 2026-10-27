/**
 * Migração de dados Faltaket v1 -> v2.
 *
 *   npm run migrate:dry            # só lê, faz backup e mostra o relatório (nenhuma escrita)
 *   npm run migrate                # migra de verdade (idempotente: pode rodar de novo)
 *   npm run migrate -- --cleanup   # migra e, se não houver falhas, apaga a coleção antiga `materias`
 *
 * Passo a passo e rollback: docs/MIGRACAO.md
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import bcrypt from 'bcryptjs'
import { cert, initializeApp } from 'firebase-admin/app'
import { getAuth, type UserImportRecord } from 'firebase-admin/auth'
import {
  getFirestore,
  Timestamp,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type QueryDocumentSnapshot,
  type WriteBatch,
} from 'firebase-admin/firestore'
import { EnvError, loadEnv, type MigrationEnv } from './lib/env.ts'
import { normalizeUsername, usernameToEmail } from './lib/username.ts'

// ============================================================== constantes

const PALETA = ['violet', 'pink', 'rose', 'amber', 'emerald', 'sky', 'indigo', 'teal'] as const
const MAX_NOME = 40
const MAX_FALTAS_LISTA = 200
const BCRYPT_ROUNDS = 10
const SENHA_MIN_FIREBASE = 6
const BATCH_SIZE = 400
const IMPORT_CHUNK = 1000
const LOOKUP_CHUNK = 100
const READ_CONCURRENCY = 25

// ================================================================== tipos

interface Args {
  dryRun: boolean
  cleanup: boolean
}

interface V1Falta {
  id: string
  active: boolean
  indice: number
}

interface V1Materia {
  id: string
  data: DocumentData
  faltas: V1Falta[]
}

interface FaltaV2 {
  id: string
  data: Timestamp | null
  obs?: string
}

interface MateriaV2 {
  nome: string
  diaSemana: number
  maxFaltas: number
  cor: (typeof PALETA)[number]
  faltas: FaltaV2[]
  createdAt: Timestamp
  updatedAt: Timestamp
}

interface UserV2 {
  name: string
  username: string
  createdAt: Timestamp
  features?: { termo: boolean }
}

class Relatorio {
  usersEncontrados = 0
  usersV1 = 0
  usersJaV2 = 0
  authImportados = 0
  authJaExistiam = 0
  authFalhas = 0
  docsUserConvertidos = 0
  featuresAjustadas = 0
  materiasEncontradas = 0
  materiasMigradas = 0
  materiasJaExistiam = 0
  materiasOrfas = 0
  materiasFalhas = 0
  faltasAntes = 0
  faltasDepois = 0
  faltasOrfas = 0
  cleanup = 'não solicitado'
  falhas: string[] = []
  avisos: string[] = []

  falha(msg: string) {
    this.falhas.push(msg)
  }
  aviso(msg: string) {
    this.avisos.push(msg)
  }
}

// ================================================================ helpers

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, cleanup: false }
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--cleanup') args.cleanup = true
    else if (a === '--help' || a === '-h') {
      console.log(
        'Uso: tsx scripts/migrate-v1-to-v2.ts [--dry-run] [--cleanup]\n' +
          '  --dry-run  não escreve nada; só faz o backup e mostra o que seria feito\n' +
          '  --cleanup  ao final, apaga a coleção antiga `materias` (+ subcoleções `faltas`).\n' +
          '             Só roda se a migração terminar sem nenhuma falha.',
      )
      process.exit(0)
    } else {
      throw new EnvError(`Argumento desconhecido: ${a} (use --help)`)
    }
  }
  return args
}

/** Corta por code points (não quebra emoji/acentos combinados ao meio). */
function truncar(s: string, max: number) {
  return Array.from(s).slice(0, max).join('')
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (const part of chunk(items, limit)) out.push(...(await Promise.all(part.map(fn))))
  return out
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

/** Converte valores do Firestore em JSON serializável (Timestamps viram ISO). */
function toJson(value: unknown): unknown {
  if (value instanceof Timestamp) return { __type: 'timestamp', iso: value.toDate().toISOString() }
  if (Array.isArray(value)) return value.map(toJson)
  if (value && typeof value === 'object') {
    const ref = value as Partial<DocumentReference>
    if (typeof ref.path === 'string' && typeof ref.id === 'string' && 'firestore' in value) {
      return { __type: 'reference', path: ref.path }
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]))
  }
  return value
}

function snapTimes(s: DocumentSnapshot) {
  return {
    createTime: s.createTime?.toDate().toISOString() ?? null,
    updateTime: s.updateTime?.toDate().toISOString() ?? null,
  }
}

/** Executa operações de escrita em lotes de BATCH_SIZE. */
async function commitEmLotes(db: Firestore, ops: Array<(b: WriteBatch) => void>) {
  for (const part of chunk(ops, BATCH_SIZE)) {
    const batch = db.batch()
    for (const op of part) op(batch)
    await batch.commit()
  }
}

// ============================================================== leitura v1

async function lerUsers(db: Firestore) {
  const snap = await db.collection('users').get()
  return snap.docs
}

async function lerMateriasV1(db: Firestore): Promise<{ materias: V1Materia[]; snaps: QueryDocumentSnapshot[] }> {
  const snap = await db.collection('materias').get()
  const materias = await mapLimit(snap.docs, READ_CONCURRENCY, async (d) => {
    const fs = await d.ref.collection('faltas').get()
    const faltas: V1Falta[] = fs.docs.map((f) => {
      const fd = f.data()
      return { id: f.id, active: fd.active === true, indice: Number(fd.indice) || 0 }
    })
    faltas.sort((a, b) => a.indice - b.indice || a.id.localeCompare(b.id))
    return { id: d.id, data: d.data(), faltas }
  })
  return { materias, snaps: snap.docs }
}

async function escreverBackup(
  users: QueryDocumentSnapshot[],
  materiasSnaps: QueryDocumentSnapshot[],
  materias: V1Materia[],
  env: MigrationEnv,
  args: Args,
): Promise<string> {
  const porId = new Map(materias.map((m) => [m.id, m]))
  const conteudo = {
    geradoEm: new Date().toISOString(),
    projectId: env.projectId,
    emuladores: env.usingEmulators,
    dryRun: args.dryRun,
    aviso: 'CONTÉM SENHAS EM TEXTO PURO DA v1. Não compartilhe; apague quando não precisar mais.',
    users: users.map((u) => ({ id: u.id, ...snapTimes(u), data: toJson(u.data()) })),
    materias: materiasSnaps.map((m) => ({
      id: m.id,
      ...snapTimes(m),
      data: toJson(m.data()),
      faltas: (porId.get(m.id)?.faltas ?? []).map((f) => ({ id: f.id, data: { active: f.active, indice: f.indice } })),
    })),
  }
  const dir = join(process.cwd(), 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(dir, `v1-${stamp}.json`)
  writeFileSync(file, JSON.stringify(conteudo, null, 2), { encoding: 'utf8', mode: 0o600 })
  return file
}

// =================================================================== users

function ehUserV1(data: DocumentData) {
  return 'password' in data || 'user' in data
}

function ehUserV2(data: DocumentData) {
  return typeof data.username === 'string' && !ehUserV1(data)
}

function nomeV2(nomeBruto: unknown, fallback: string) {
  const nome = truncar(String(nomeBruto ?? '').trim(), MAX_NOME)
  return nome.length > 0 ? nome : truncar(fallback, MAX_NOME)
}

async function migrarUsers(
  db: Firestore,
  env: MigrationEnv,
  args: Args,
  docs: QueryDocumentSnapshot[],
  rel: Relatorio,
) {
  const auth = getAuth()
  rel.usersEncontrados = docs.length

  // ---- classifica e valida
  interface Plano {
    snap: QueryDocumentSnapshot
    username: string
    email: string
    name: string
    password: string
  }
  const planos: Plano[] = []
  const usernamesEmUso = new Map<string, string>() // username -> uid

  for (const s of docs) {
    const d = s.data()
    if (ehUserV2(d)) {
      rel.usersJaV2++
      usernamesEmUso.set(d.username, s.id)
    }
  }

  for (const s of docs) {
    const d = s.data()
    if (ehUserV2(d)) continue
    if (!ehUserV1(d)) {
      rel.falha(`users/${s.id}: formato desconhecido (nem v1 nem v2), ignorado`)
      rel.authFalhas++
      continue
    }
    rel.usersV1++
    const username = typeof d.user === 'string' ? normalizeUsername(d.user) : ''
    if (!username) {
      rel.falha(`users/${s.id}: campo "user" vazio ou ausente`)
      rel.authFalhas++
      continue
    }
    if (typeof d.password !== 'string' || d.password.length === 0) {
      rel.falha(`users/${s.id} (${username}): senha vazia ou ausente`)
      rel.authFalhas++
      continue
    }
    const dono = usernamesEmUso.get(username)
    if (dono && dono !== s.id) {
      rel.falha(`users/${s.id}: username "${username}" duplicado (também usado por users/${dono})`)
      rel.authFalhas++
      continue
    }
    usernamesEmUso.set(username, s.id)
    const name = nomeV2(d.name, username)
    if (name !== d.name) rel.aviso(`users/${s.id}: name ajustado de ${JSON.stringify(d.name)} para "${name}"`)
    if (username !== d.user) rel.aviso(`users/${s.id}: username normalizado de "${d.user}" para "${username}"`)
    planos.push({ snap: s, username, email: usernameToEmail(username, env.authEmailDomain), name, password: d.password })
  }

  // ---- quem já existe no Auth?
  const existentes = new Map<string, string | undefined>() // uid -> email
  for (const part of chunk(docs.map((d) => d.id), LOOKUP_CHUNK)) {
    const r = await auth.getUsers(part.map((uid) => ({ uid })))
    for (const u of r.users) existentes.set(u.uid, u.email)
  }

  const okNoAuth = new Set<string>()
  const paraImportar: Plano[] = []
  for (const p of planos) {
    if (existentes.has(p.snap.id)) {
      rel.authJaExistiam++
      okNoAuth.add(p.snap.id)
      const email = existentes.get(p.snap.id)
      if (email !== p.email) rel.aviso(`Auth ${p.snap.id}: já existia com e-mail ${email ?? '(nenhum)'} (esperado ${p.email})`)
    } else {
      paraImportar.push(p)
    }
  }

  // ---- cria as contas no Auth
  // Senhas com 6+ caracteres: createUser (caminho padrão; o Firebase gera o hash).
  // Senhas mais curtas (permitidas na v1): o Firebase recusa no createUser, então
  // elas são importadas com hash BCRYPT, que não passa pela regra de tamanho mínimo.
  // Obs.: o emulador de Auth NÃO valida hashes importados; só o Firebase real valida.
  const curtas = paraImportar.filter((p) => p.password.length < SENHA_MIN_FIREBASE)
  const normais = paraImportar.filter((p) => p.password.length >= SENHA_MIN_FIREBASE)
  if (curtas.length > 0) {
    rel.aviso(
      `${curtas.length} usuário(s) com senha < ${SENHA_MIN_FIREBASE} caracteres serão importados via BCRYPT ` +
        '(no emulador o login deles não funciona; no Firebase real, sim). Recomende trocar a senha depois.',
    )
  }

  if (args.dryRun) {
    rel.authImportados = paraImportar.length
    for (const p of paraImportar) okNoAuth.add(p.snap.id)
  } else {
    await mapLimit(normais, 5, async (p) => {
      try {
        await auth.createUser({
          uid: p.snap.id,
          email: p.email,
          emailVerified: false,
          displayName: p.name,
          password: p.password,
        })
        okNoAuth.add(p.snap.id)
        rel.authImportados++
      } catch (e) {
        rel.authFalhas++
        rel.falha(`Auth createUser ${p.snap.id} (${p.username}): ${errMsg(e)}`)
      }
    })

    for (const part of chunk(curtas, IMPORT_CHUNK)) {
      const records: UserImportRecord[] = await Promise.all(
        part.map(async (p) => ({
          uid: p.snap.id,
          email: p.email,
          emailVerified: false,
          displayName: p.name,
          passwordHash: Buffer.from(await bcrypt.hash(p.password, BCRYPT_ROUNDS)),
        })),
      )
      try {
        const res = await auth.importUsers(records, { hash: { algorithm: 'BCRYPT' } })
        const falhou = new Set<number>()
        for (const e of res.errors) {
          falhou.add(e.index)
          const p = part[e.index]
          rel.falha(`Auth import ${p?.snap.id} (${p?.username}): ${e.error.message}`)
        }
        part.forEach((p, i) => {
          if (!falhou.has(i)) okNoAuth.add(p.snap.id)
        })
        rel.authImportados += res.successCount
        rel.authFalhas += res.failureCount
      } catch (e) {
        rel.authFalhas += part.length
        rel.falha(`Auth import (lote de ${part.length}): ${errMsg(e)}`)
      }
    }
  }

  // ---- reescreve users/{uid} no formato v2 (remove password)
  const ops: Array<(b: WriteBatch) => void> = []
  for (const p of planos) {
    if (!okNoAuth.has(p.snap.id)) continue // sem conta no Auth: mantém o doc v1 para tentar de novo
    const novo: UserV2 = {
      name: p.name,
      username: p.username,
      createdAt: p.snap.createTime ?? Timestamp.now(),
    }
    if (env.termoUserIds.has(p.snap.id)) novo.features = { termo: true }
    rel.docsUserConvertidos++
    ops.push((b) => b.set(p.snap.ref, novo)) // set SEM merge: descarta `password` e `user`
  }

  // ---- docs já v2 que deveriam ter o Termo liberado
  for (const s of docs) {
    const d = s.data()
    if (ehUserV2(d) && env.termoUserIds.has(s.id) && d.features?.termo !== true) {
      rel.featuresAjustadas++
      ops.push((b) => b.update(s.ref, { 'features.termo': true }))
    }
    if (ehUserV2(d) && !existentes.has(s.id)) {
      rel.aviso(`users/${s.id} já está no formato v2 mas não existe conta no Auth`)
    }
  }

  for (const id of env.termoUserIds) {
    if (!docs.some((d) => d.id === id)) rel.aviso(`TERMO_USER_IDS contém "${id}", que não existe em users`)
  }

  if (!args.dryRun && ops.length > 0) {
    try {
      await commitEmLotes(db, ops)
    } catch (e) {
      rel.falha(`Escrita dos docs users: ${errMsg(e)}`)
    }
  }
}

// ================================================================= materias

function diaSemanaV2(semana: unknown): number | null {
  const n = typeof semana === 'string' ? Number(semana.trim()) : semana
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 7 ? n : null
}

async function migrarMaterias(
  db: Firestore,
  args: Args,
  userIds: Set<string>,
  materias: V1Materia[],
  rel: Relatorio,
) {
  rel.materiasEncontradas = materias.length

  // ordem estável por usuário (dia da semana, nome, id) para distribuir as cores
  const porUser = new Map<string, V1Materia[]>()
  for (const m of materias) {
    const uid = typeof m.data.id_user === 'string' ? m.data.id_user : ''
    const ativas = m.faltas.filter((f) => f.active).length
    if (!uid || !userIds.has(uid)) {
      rel.materiasOrfas++
      rel.faltasOrfas += ativas
      rel.aviso(`materias/${m.id} é órfã (id_user=${JSON.stringify(m.data.id_user)} não existe em users); não migrada`)
      continue
    }
    rel.faltasAntes += ativas
    const lista = porUser.get(uid) ?? []
    lista.push(m)
    porUser.set(uid, lista)
  }

  const agora = Timestamp.now()
  const alvos: DocumentReference[] = []
  const ops: Array<(b: WriteBatch) => void> = []
  let faltasPlanejadas = 0

  for (const [uid, lista] of porUser) {
    lista.sort(
      (a, b) =>
        Number(a.data.semana) - Number(b.data.semana) ||
        String(a.data.nome ?? '').localeCompare(String(b.data.nome ?? '')) ||
        a.id.localeCompare(b.id),
    )
    const refs = lista.map((m) => db.collection('users').doc(uid).collection('materias').doc(m.id))
    const existentes: DocumentSnapshot[] = []
    for (const part of chunk(refs, LOOKUP_CHUNK)) existentes.push(...(await db.getAll(...part)))

    lista.forEach((m, i) => {
      const ref = refs[i]!
      const atual = existentes[i]!
      alvos.push(ref)
      if (atual.exists) {
        rel.materiasJaExistiam++
        return
      }

      const diaSemana = diaSemanaV2(m.data.semana)
      if (diaSemana === null) {
        rel.materiasFalhas++
        rel.falha(`materias/${m.id}: semana inválida (${JSON.stringify(m.data.semana)}); corrija o doc v1 e rode de novo`)
        return
      }
      const ativas = m.faltas.filter((f) => f.active)
      if (ativas.length > MAX_FALTAS_LISTA) {
        rel.materiasFalhas++
        rel.falha(`materias/${m.id}: ${ativas.length} faltas ativas (> ${MAX_FALTAS_LISTA})`)
        return
      }
      const nome = nomeV2(m.data.nome, 'Matéria')
      if (nome !== m.data.nome) rel.aviso(`materias/${m.id}: nome ajustado de ${JSON.stringify(m.data.nome)} para "${nome}"`)

      const novo: MateriaV2 = {
        nome,
        diaSemana,
        maxFaltas: Math.max(1, Math.min(99, m.faltas.length)),
        cor: PALETA[i % PALETA.length]!,
        faltas: ativas.map((f) => ({ id: f.id, data: null })),
        createdAt: agora,
        updatedAt: agora,
      }
      if (m.faltas.length > 99) rel.aviso(`materias/${m.id}: ${m.faltas.length} faltas permitidas na v1; maxFaltas limitado a 99`)
      faltasPlanejadas += novo.faltas.length
      rel.materiasMigradas++
      ops.push((b) => b.set(ref, novo))
    })
  }

  if (!args.dryRun && ops.length > 0) {
    try {
      await commitEmLotes(db, ops)
    } catch (e) {
      rel.falha(`Escrita das matérias v2: ${errMsg(e)}`)
    }
  }

  // ---- contagem "depois": lê de volta os docs v2 (no dry-run, soma o previsto)
  let depois = 0
  let ausentes = 0
  for (const part of chunk(alvos, LOOKUP_CHUNK)) {
    if (part.length === 0) continue
    for (const s of await db.getAll(...part)) {
      if (s.exists) depois += Array.isArray(s.get('faltas')) ? (s.get('faltas') as unknown[]).length : 0
      else ausentes++
    }
  }
  if (args.dryRun) {
    depois += faltasPlanejadas
  } else if (ausentes > rel.materiasFalhas) {
    rel.falha(`${ausentes - rel.materiasFalhas} matéria(s) v2 não encontradas após a escrita`)
  }
  rel.faltasDepois = depois
  if (rel.faltasDepois !== rel.faltasAntes) {
    rel.aviso(
      `Total de faltas diferente (v1: ${rel.faltasAntes}, v2: ${rel.faltasDepois}). ` +
        'Normal se alguma matéria já existia na v2 e foi editada pelo usuário, ou se houve falhas.',
    )
  }
}

// ================================================================== cleanup

async function cleanup(db: Firestore, args: Args, materiasV1: V1Materia[], rel: Relatorio) {
  if (!args.cleanup) return
  if (rel.falhas.length > 0) {
    rel.cleanup = 'RECUSADO (há falhas na migração)'
    rel.falha('--cleanup recusado: corrija as falhas e rode de novo')
    return
  }
  const totalFaltas = materiasV1.reduce((acc, m) => acc + m.faltas.length, 0)
  const resumo = `${materiasV1.length} docs em materias + ${totalFaltas} docs em faltas`
  if (args.dryRun) {
    rel.cleanup = `(dry-run) apagaria ${resumo}`
    return
  }
  try {
    await db.recursiveDelete(db.collection('materias'))
    rel.cleanup = `apagados ${resumo}`
  } catch (e) {
    rel.cleanup = 'FALHOU'
    rel.falha(`cleanup: ${errMsg(e)}`)
  }
}

// ================================================================= relatório

function imprimirRelatorio(rel: Relatorio, args: Args, backupFile: string) {
  const titulo = args.dryRun ? 'RELATÓRIO (DRY-RUN — nada foi escrito)' : 'RELATÓRIO DA MIGRAÇÃO'
  console.log(`\n=== ${titulo} ===`)
  console.log(`Backup: ${backupFile}\n`)
  const prev = args.dryRun ? ' (previsto)' : ''
  console.table({
    'Users encontrados': rel.usersEncontrados,
    'Users no formato v1': rel.usersV1,
    'Users já no formato v2': rel.usersJaV2,
    [`Auth importados${prev}`]: rel.authImportados,
    'Auth pulados (já existiam)': rel.authJaExistiam,
    'Auth falhas': rel.authFalhas,
    [`Docs users convertidos${prev}`]: rel.docsUserConvertidos,
    [`features.termo ajustados${prev}`]: rel.featuresAjustadas,
    'Matérias v1 encontradas': rel.materiasEncontradas,
    [`Matérias migradas${prev}`]: rel.materiasMigradas,
    'Matérias puladas (já existiam)': rel.materiasJaExistiam,
    'Matérias órfãs (não migradas)': rel.materiasOrfas,
    'Matérias com falha': rel.materiasFalhas,
    'Faltas ativas v1 (sem órfãs)': rel.faltasAntes,
    [`Faltas na v2${prev}`]: rel.faltasDepois,
    'Faltas ativas em órfãs': rel.faltasOrfas,
  })
  console.log(`Cleanup: ${rel.cleanup}`)

  if (rel.avisos.length > 0) {
    console.log(`\nAvisos (${rel.avisos.length}):`)
    for (const a of rel.avisos) console.log(`  - ${a}`)
  }
  if (rel.falhas.length > 0) {
    console.error(`\nFALHAS (${rel.falhas.length}):`)
    for (const f of rel.falhas) console.error(`  x ${f}`)
    console.error('\nA migração é idempotente: corrija as causas e rode de novo.')
  } else {
    console.log(args.dryRun ? '\nDry-run sem falhas. Para executar: npm run migrate' : '\nMigração concluída sem falhas.')
  }
}

// ===================================================================== main

async function main() {
  let env: MigrationEnv
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
    env = loadEnv()
  } catch (e) {
    if (e instanceof EnvError) {
      console.error(`\nErro de configuração:\n${e.message}\n`)
      process.exit(1)
    }
    throw e
  }

  initializeApp({
    projectId: env.projectId,
    ...(env.credentials
      ? { credential: cert({ projectId: env.projectId, ...env.credentials }) }
      : {}),
  })
  const db = getFirestore()

  console.log(
    `Faltaket migração v1 -> v2 | projeto: ${env.projectId}` +
      `${env.usingEmulators ? ' (EMULADORES)' : ''} | domínio: ${env.authEmailDomain}` +
      `${args.dryRun ? ' | DRY-RUN' : ''}${args.cleanup ? ' | CLEANUP' : ''}`,
  )

  const rel = new Relatorio()

  // 1) leitura + backup (sempre, inclusive no dry-run) ANTES de qualquer escrita
  console.log('Lendo dados v1...')
  const users = await lerUsers(db)
  const { materias, snaps: materiasSnaps } = await lerMateriasV1(db)
  const backupFile = await escreverBackup(users, materiasSnaps, materias, env, args)
  console.log(`Backup salvo em ${backupFile}`)

  // 2) users (Auth + docs)
  console.log('Migrando users...')
  await migrarUsers(db, env, args, users, rel)

  // 3) matérias
  console.log('Migrando matérias...')
  await migrarMaterias(db, args, new Set(users.map((u) => u.id)), materias, rel)

  // 4) cleanup opcional
  await cleanup(db, args, materias, rel)

  imprimirRelatorio(rel, args, backupFile)
  process.exitCode = rel.falhas.length > 0 ? 1 : 0
}

main().catch((e) => {
  console.error('\nErro inesperado durante a migração:', e)
  const msg = errMsg(e)
  if (/credential|invalid_grant|PERMISSION_DENIED|private key|DECODER/i.test(msg)) {
    console.error('\nDica: confira FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY no .env (veja docs/MIGRACAO.md).')
  }
  process.exit(1)
})
