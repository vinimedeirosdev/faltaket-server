/**
 * Envia os lembretes do FaltaKet (push via Firebase Cloud Messaging).
 *
 *   npm run lembretes -- --turno=manha            (só mostra o que enviaria)
 *   npm run lembretes -- --turno=manha --enviar   (envia de verdade)
 *
 * Por segurança o padrão é SIMULAR: só envia com --enviar (o workflow do GitHub usa).
 *
 * Roda pelo GitHub Actions (.github/workflows/lembretes.yml), 07h e 18h de Brasília.
 * Credenciais: FIREBASE_SERVICE_ACCOUNT (JSON inteiro, usado no GitHub) ou
 * FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY (.env local).
 * Com FIRESTORE_EMULATOR_HOST lê do emulador e nunca envia, mesmo com --enviar.
 * Passo a passo: docs/LEMBRETES.md.
 */
import { config } from 'dotenv'
import { cert, initializeApp, type AppOptions } from 'firebase-admin/app'
import { getFirestore, type Timestamp } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import {
  montarLembrete,
  type Evento,
  type Materia,
  type Preferencias,
  type Turno,
} from './lib/lembretes.ts'

const FUSO = 'America/Sao_Paulo'
const TOKEN_INVALIDO = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
])

function argumentos() {
  const args = process.argv.slice(2)
  const turno = args.find((a) => a.startsWith('--turno='))?.split('=')[1]
  if (turno !== 'manha' && turno !== 'noite') {
    throw new Error('Informe --turno=manha ou --turno=noite')
  }
  return { turno: turno as Turno, enviar: args.includes('--enviar') }
}

function inicializar() {
  config({ quiet: true })
  const env = (n: string) => process.env[n]?.trim() || undefined
  const emulador = Boolean(env('FIRESTORE_EMULATOR_HOST'))
  let opcoes: AppOptions
  if (emulador) {
    opcoes = { projectId: env('FIREBASE_PROJECT_ID') ?? 'demo-faltaket' }
  } else if (env('FIREBASE_SERVICE_ACCOUNT')) {
    const conta = JSON.parse(env('FIREBASE_SERVICE_ACCOUNT')!)
    opcoes = { credential: cert(conta), projectId: conta.project_id }
  } else {
    const projectId = env('FIREBASE_PROJECT_ID')
    const clientEmail = env('FIREBASE_CLIENT_EMAIL')
    const privateKey = env('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n')
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        'Credenciais ausentes: defina FIREBASE_SERVICE_ACCOUNT (JSON) ou ' +
          'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY. Ver docs/LEMBRETES.md.',
      )
    }
    opcoes = {
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
    }
  }
  initializeApp(opcoes)
  return { emulador }
}

/** Data e hora no fuso de São Paulo, independente de onde o job roda (o GitHub usa UTC). */
const fmtDia = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const fmtHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
})

async function main() {
  const { turno, enviar } = argumentos()
  const { emulador } = inicializar()
  const dryRun = !enviar || emulador
  const db = getFirestore()
  const hoje = fmtDia.format(new Date())

  console.log(
    `Lembretes · turno ${turno} · ${hoje}${dryRun ? ' · SIMULAÇÃO (nada é enviado; use --enviar)' : ''}`,
  )

  const usuarios = await db.collection('users').get()
  const total = {
    usuarios: usuarios.size,
    comAparelho: 0,
    avisados: 0,
    enviados: 0,
    falhas: 0,
    tokensRemovidos: 0,
  }

  for (const u of usuarios.docs) {
    const dispositivos = await u.ref.collection('dispositivos').get()
    if (dispositivos.empty && !dryRun) continue
    if (!dispositivos.empty) total.comAparelho++

    const n = u.get('config.notificacoes') ?? {}
    const prefs: Preferencias = {
      aulas: n.aulas !== false,
      provas: n.provas !== false,
      entregas: n.entregas !== false,
      risco: n.risco !== false,
    }

    const materiasSnap = await u.ref.collection('materias').get()
    const nomes = new Map(materiasSnap.docs.map((d) => [d.id, d.get('nome') as string]))
    const materias = materiasSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as Materia)
    const eventos: Evento[] = (await u.ref.collection('eventos').get()).docs.map((d) => {
      const data = (d.get('data') as Timestamp).toDate()
      const materiaId = d.get('materiaId') as string | undefined
      return {
        titulo: d.get('titulo'),
        tipo: d.get('tipo'),
        dia: fmtDia.format(data),
        hora: d.get('temHora') ? fmtHora.format(data) : undefined,
        concluido: d.get('concluido') === true,
        materiaNome: materiaId ? nomes.get(materiaId) : undefined,
      }
    })

    const lembrete = montarLembrete(turno, hoje, materias, eventos, prefs)
    if (!lembrete) continue
    total.avisados++

    if (dryRun) {
      console.log(`\n→ ${u.get('username') ?? u.id} (${dispositivos.size} aparelho(s))`)
      console.log(`  ${lembrete.titulo}\n  ${lembrete.corpo.replace(/\n/g, '\n  ')}`)
      continue
    }

    const appUrl = process.env.APP_URL?.trim() || 'https://faltaket.web.app'
    const tokens = dispositivos.docs.map((d) => d.get('token') as string)
    const res = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title: lembrete.titulo, body: lembrete.corpo },
      webpush: {
        notification: {
          icon: `${appUrl}/pwa-192x192.png`,
          badge: `${appUrl}/favicon-48x48.png`,
          tag: `faltaket-${turno}`,
          lang: 'pt-BR',
        },
        fcmOptions: { link: `${appUrl}${lembrete.link}` },
      },
    })
    total.enviados += res.successCount
    total.falhas += res.failureCount
    // aparelho desinstalou/trocou o token: remove para não tentar de novo
    await Promise.all(
      res.responses.map(async (r, i) => {
        if (!r.success && r.error && TOKEN_INVALIDO.has(r.error.code)) {
          await dispositivos.docs[i]?.ref.delete()
          total.tokensRemovidos++
        } else if (!r.success) {
          console.error(`Falha ao enviar para ${u.id}: ${r.error?.code} ${r.error?.message}`)
        }
      }),
    )
  }

  console.log('\n', total)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
