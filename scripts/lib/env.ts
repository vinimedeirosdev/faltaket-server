import { config } from 'dotenv'

export interface MigrationEnv {
  projectId: string
  /** Ausente quando rodando contra os emuladores. */
  credentials: { clientEmail: string; privateKey: string } | null
  authEmailDomain: string
  termoUserIds: Set<string>
  usingEmulators: boolean
}

export class EnvError extends Error {}

/**
 * Lê e valida as variáveis de ambiente (arquivo .env + ambiente do processo).
 * Lança EnvError com uma mensagem clara em pt-BR quando algo está faltando.
 */
export function loadEnv(): MigrationEnv {
  config({ quiet: true })

  const get = (name: string) => process.env[name]?.trim() || undefined

  const firestoreEmu = get('FIRESTORE_EMULATOR_HOST')
  const authEmu = get('FIREBASE_AUTH_EMULATOR_HOST')

  if (Boolean(firestoreEmu) !== Boolean(authEmu)) {
    throw new EnvError(
      'Defina FIRESTORE_EMULATOR_HOST e FIREBASE_AUTH_EMULATOR_HOST juntos (ou nenhum dos dois).\n' +
        'Misturar emulador com produção não é suportado: a migração escreve no Auth e no Firestore.',
    )
  }
  const usingEmulators = Boolean(firestoreEmu && authEmu)

  const missing: string[] = []
  const projectId = get('FIREBASE_PROJECT_ID') ?? (usingEmulators ? 'demo-faltaket' : undefined)
  if (!projectId) missing.push('FIREBASE_PROJECT_ID')

  let credentials: MigrationEnv['credentials'] = null
  if (!usingEmulators) {
    const clientEmail = get('FIREBASE_CLIENT_EMAIL')
    const privateKey = get('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n')
    if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL')
    if (!privateKey) missing.push('FIREBASE_PRIVATE_KEY')
    if (clientEmail && privateKey) credentials = { clientEmail, privateKey }
  }

  if (missing.length > 0) {
    throw new EnvError(
      `Variáveis de ambiente obrigatórias ausentes: ${missing.join(', ')}.\n` +
        'Copie .env.example para .env e preencha com os dados da service account\n' +
        '(Console do Firebase > Configurações do projeto > Contas de serviço > Gerar nova chave privada).\n' +
        'Para testar localmente sem credenciais, defina FIRESTORE_EMULATOR_HOST e FIREBASE_AUTH_EMULATOR_HOST.\n' +
        'Passo a passo completo em docs/MIGRACAO.md.',
    )
  }

  const termoUserIds = new Set(
    (get('TERMO_USER_IDS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )

  return {
    projectId: projectId!,
    credentials,
    authEmailDomain: get('AUTH_EMAIL_DOMAIN') ?? 'faltaket.app',
    termoUserIds,
    usingEmulators,
  }
}
