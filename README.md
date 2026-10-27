# faltaket-server (infra Firebase)

> A partir da **v2.0.0** este repositório **não é mais uma API**.
> O front-end React do Faltaket fala direto com o **Firebase Auth** e o **Firestore**,
> e quem protege os dados são as **Security Rules** versionadas aqui.

O nome `faltaket-server` foi mantido por histórico. Hoje o repositório contém:

| O quê | Onde |
| --- | --- |
| Security Rules do Firestore | [`firestore.rules`](firestore.rules) |
| Índices do Firestore (vazio por enquanto) | [`firestore.indexes.json`](firestore.indexes.json) |
| Config do Firebase CLI + emuladores | [`firebase.json`](firebase.json), [`.firebaserc.example`](.firebaserc.example) |
| Testes das rules (emulador + Vitest) | [`tests/rules.test.ts`](tests/rules.test.ts) |
| Script de migração v1 -> v2 | [`scripts/migrate-v1-to-v2.ts`](scripts/migrate-v1-to-v2.ts) |
| Função compartilhada username -> e-mail | [`scripts/lib/username.ts`](scripts/lib/username.ts) |
| Documentação | [`docs/MIGRACAO.md`](docs/MIGRACAO.md), [`docs/SECURITY_RULES.md`](docs/SECURITY_RULES.md), [`CHANGELOG.md`](CHANGELOG.md) |

A API Express da v1 (`/login`, `/getMaterias`, ...) foi removida. Ela continua
disponível no histórico do git (branch `master`).

---

## Modelo de dados (v2)

```
users/{uid}                        uid == id do doc da v1 (mantido)
  name: string (1..40)
  username: string (normalizado: trim + lowercase)
  createdAt: timestamp
  features?: { termo: bool }       // só o Admin SDK grava; ausente == false

users/{uid}/materias/{materiaId}   materiaId == id do doc da v1
  nome: string (1..40)
  diaSemana: int 1..7              // 1 = segunda ... 7 = domingo
  maxFaltas: int 1..99
  cor: 'violet' | 'pink' | 'rose' | 'amber' | 'emerald' | 'sky' | 'indigo' | 'teal'
  faltas: list (até 200 itens; pode passar de maxFaltas = "reprovou")
    item: { id: string, data: timestamp | null, obs?: string (<= 140) }
  createdAt: timestamp
  updatedAt: timestamp
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

| Script | O que faz |
| --- | --- |
| `npm run typecheck` | Checagem de tipos (TypeScript) de scripts e testes |
| `npm run emulators` | Sobe os emuladores de Auth (9099) e Firestore (8080) + UI, no projeto `demo-faltaket` |
| `npm run test:rules` | Sobe o emulador do Firestore e roda `vitest run` contra `firestore.rules` (exige Java 21+) |
| `npm run migrate:dry` | Migração v1 -> v2 em modo simulação: faz backup e mostra o relatório, **sem escrever nada** |
| `npm run migrate` | Executa a migração (idempotente). Para apagar a coleção antiga: `npm run migrate -- --cleanup` |
| `npm run deploy:rules` | Publica rules e índices no projeto do `.firebaserc` |

## Fluxo de trabalho

1. Alterou `firestore.rules`? Rode `npm run test:rules` (e adicione testes).
2. Publique com `npm run deploy:rules`.
3. Mudou o contrato de dados? Atualize rules, testes, este README e avise o front.

## Documentação

- [docs/MIGRACAO.md](docs/MIGRACAO.md) — passo a passo da migração, validação, cleanup e rollback
- [docs/SECURITY_RULES.md](docs/SECURITY_RULES.md) — cada regra explicada + como testar
- [CHANGELOG.md](CHANGELOG.md)
