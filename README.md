# faltaket-server (infra Firebase)

> A partir da **v2.0.0** este repositório **não é mais uma API**.
> O front-end React do Faltaket fala direto com o **Firebase Auth** e o **Firestore**,
> e quem protege os dados são as **Security Rules** versionadas aqui.

O nome `faltaket-server` foi mantido por histórico. Hoje o repositório contém:

| O quê                                     | Onde                                                                                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security Rules do Firestore               | [`firestore.rules`](firestore.rules)                                                                                                                                 |
| Índices do Firestore (vazio por enquanto) | [`firestore.indexes.json`](firestore.indexes.json)                                                                                                                   |
| Config do Firebase CLI + emuladores       | [`firebase.json`](firebase.json), [`.firebaserc.example`](.firebaserc.example)                                                                                       |
| Testes das rules (emulador + Vitest)      | [`tests/rules.test.ts`](tests/rules.test.ts)                                                                                                                         |
| Lembretes push (script + agendamento)     | [`scripts/lembretes.ts`](scripts/lembretes.ts), [`.github/workflows/lembretes.yml`](.github/workflows/lembretes.yml)                                                 |
| Script de migração v1 -> v2               | [`scripts/migrate-v1-to-v2.ts`](scripts/migrate-v1-to-v2.ts)                                                                                                         |
| Função compartilhada username -> e-mail   | [`scripts/lib/username.ts`](scripts/lib/username.ts)                                                                                                                 |
| Documentação                              | [`docs/MIGRACAO.md`](docs/MIGRACAO.md), [`docs/LEMBRETES.md`](docs/LEMBRETES.md), [`docs/SECURITY_RULES.md`](docs/SECURITY_RULES.md), [`CHANGELOG.md`](CHANGELOG.md) |

A API Express da v1 (`/login`, `/getMaterias`, ...) foi removida. Ela continua
disponível na branch `v1`.

---

## Modelo de dados (v3)

Detalhes de cada campo: [DATA_MODEL.md do front](https://github.com/vinimedeirosdev/faltaket/blob/main/docs/DATA_MODEL.md).

```
users/{uid}                        uid == id do doc da v1 (mantido)
  name, username, createdAt
  foto?: string                    // data URL webp/jpeg 256x256 (dono altera/remove)
  config?: { mediaAprovacao?, mediaExame?, semestreInicio?, semestreFim?,
             notificacoes?: { aulas?, provas?, entregas?, risco? } }
  features?: { termo: bool }       // só o Admin SDK grava

users/{uid}/materias/{materiaId}   materiaId == id do doc da v1
  nome, maxFaltas (1..99), cor, createdAt, updatedAt
  horarios: [{ dia 1..7, inicio?, fim?, sala?, aulas 1|2 }]          (1..14)
  diaSemana?: int 1..7             // LEGADO v2.0: aceito até a matéria ser editada
  faltas: [{ id, data|null, obs?, aulas?: 2, justificada?: true }]  (até 200)
  professor?: { nome, email? }
  notas?: [{ id, nome, peso, valor|null }]                          (até 30)
  mediaAprovacao?: 0..10

users/{uid}/eventos/{eventoId}     provas, trabalhos e entregas
  tipo, titulo, materiaId?, data, temHora, local?, descricao?, concluido, checklist[]

users/{uid}/dispositivos/{hash}    tokens do FCM para os lembretes
  token, plataforma?, createdAt
```

### Login por username

O Firebase Auth usa e-mail/senha. O usuário digita só o **username**, e o front
converte em um e-mail sintético com `usernameToEmail(username, AUTH_EMAIL_DOMAIN)`
(domínio padrão `faltaket.app`). A função está em
[`scripts/lib/username.ts`](scripts/lib/username.ts) e **o front precisa usar
exatamente a mesma implementação**, senão os usuários migrados não conseguem entrar.

Exemplos: `Vinicius` -> `vinicius@faltaket.app`, `joão` -> `jo+e3o@faltaket.app`.

---

## Requisitos

- Node.js **22.12+** (testado com Node 24)
- Java **21+** — apenas para os emuladores (testes das rules / migração local)
- Firebase CLI: já vem como dependência de desenvolvimento (`npx firebase ...`)

## Setup

```bash
npm install
cp .firebaserc.example .firebaserc   # coloque o project id real
cp .env.example .env                 # só se for rodar a migração
npx firebase login                   # só para deploy
```

## Scripts

| Script                               | O que faz                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                  | Checagem de tipos (TypeScript) de scripts e testes                                                                           |
| `npm run emulators`                  | Sobe os emuladores de Auth (9099) e Firestore (8080) + UI, no projeto `demo-faltaket`                                        |
| `npm run test:rules`                 | Sobe o emulador do Firestore e roda `vitest run` contra `firestore.rules` (exige Java 21+)                                   |
| `npm run migrate:dry`                | Migração v1 -> v2 em modo simulação: faz backup e mostra o relatório, **sem escrever nada**                                  |
| `npm run migrate`                    | Executa a migração (idempotente). Para apagar a coleção antiga: `npm run migrate -- --cleanup`                               |
| `npm run test:unit`                  | Testes da montagem das mensagens de lembrete (não precisa de emulador)                                                       |
| `npm run lembretes -- --turno=manha` | **Simula** os lembretes (mostra o que enviaria). Com `--enviar` envia de verdade. Ver [docs/LEMBRETES.md](docs/LEMBRETES.md) |
| `npm run deploy:rules`               | Publica rules e índices no projeto do `.firebaserc`                                                                          |

## Fluxo de trabalho

1. Alterou `firestore.rules`? Rode `npm run test:rules` (e adicione testes).
2. Publique com `npm run deploy:rules`.
3. Mudou o contrato de dados? Atualize rules, testes, este README e avise o front.

## Documentação

- [docs/MIGRACAO.md](docs/MIGRACAO.md) — passo a passo da migração, validação, cleanup e rollback
- [docs/SECURITY_RULES.md](docs/SECURITY_RULES.md) — cada regra explicada + como testar
- [CHANGELOG.md](CHANGELOG.md)
