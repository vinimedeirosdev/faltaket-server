# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [2.0.0] - 2026-10-27

O repositório deixa de ser uma API e passa a ser a **infraestrutura Firebase** do
Faltaket. O front React acessa Firebase Auth + Firestore diretamente, protegido
por Security Rules.

### ⚠️ Breaking changes

- **API Express removida** (`/register`, `/login`, `/getMaterias`, `/addMateria`,
  `/editMateria`, `/deleteMateria`, `/activeFalta`, `/editUser`). O front v1 não
  funciona com os dados v2.
- **Novo modelo de dados:** matérias passam para `users/{uid}/materias/{id}` e as
  faltas viram uma lista dentro do doc da matéria (`faltas`), com `maxFaltas`
  explícito. Detalhes no [README](README.md#modelo-de-dados-v2).
- **Login via Firebase Auth** com e-mail sintético derivado do username
  (`scripts/lib/username.ts`).
- Pacote agora é ESM (`"type": "module"`); scripts `build`, `start` e `dev` removidos.

### Adicionado

- `firestore.rules`: nega tudo por padrão; cada usuário só acessa `users/{uid}` e
  `users/{uid}/materias/*`; validação de formato; `features` (Termo) protegido
  contra escrita do cliente.
- `firestore.indexes.json`, `firebase.json` (emuladores Auth 9099, Firestore 8080, UI)
  e `.firebaserc.example`.
- `tests/rules.test.ts`: testes das rules com `@firebase/rules-unit-testing` + Vitest
  (`npm run test:rules`).
- `scripts/migrate-v1-to-v2.ts` (`npm run migrate:dry` / `npm run migrate`):
  backup JSON, criação das contas no Auth (createUser; bcrypt via importUsers para senhas < 6), conversão de users e matérias,
  `--dry-run`, `--cleanup`, idempotente, relatório final.
- Documentação: `docs/MIGRACAO.md`, `docs/SECURITY_RULES.md`, `.env.example`.

### Segurança

- **Senhas deixam de ser guardadas em texto puro** no Firestore; passam a ser
  geridas pelo Firebase Auth.
- O acesso à página "Termo" deixa de depender de um id fixo no código do front e
  passa a ser `features.termo`, gravável só pelo Admin SDK.

### Removido

- Dependências `express`, `cors`, `nodemon`, `ts-node` e tipos relacionados.
- SDK cliente `firebase` saiu das dependências de runtime (fica só em `devDependencies`,
  pois é peer dependency obrigatória de `@firebase/rules-unit-testing`).

## [1.0.0]

- API Express + firebase-admin (versão original).
