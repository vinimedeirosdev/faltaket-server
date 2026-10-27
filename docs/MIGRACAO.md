# Migração de dados v1 -> v2

Este guia leva os dados do formato antigo (API Express) para o formato novo
(Firebase Auth + Firestore acessado direto pelo front).

> **Resumo:** backup -> dry-run -> migrate -> validar login -> (depois) cleanup.
> O script é **idempotente**: pode ser rodado várias vezes sem duplicar nada.

---

## 1. O que muda

| v1 | v2 |
| --- | --- |
| `users/{id}`: `{ name, user, password }` (senha em **texto puro**) | Conta no **Firebase Auth** (uid = mesmo `id`) + `users/{id}`: `{ name, username, createdAt, features? }` |
| Login pela API comparando senha em texto puro | Login no Firebase Auth com e-mail sintético `usernameToEmail(user)` |
| `materias/{id}`: `{ id_user, nome, semana }` | `users/{id_user}/materias/{id}` (mesmo id) |
| `materias/{id}/faltas/{fid}`: `{ active, indice }` — nº de docs = máximo de faltas | Campo `maxFaltas` = nº de docs de falta (limitado a 1..99) |
| | Campo `faltas` = um item `{ id: fid, data: null }` por falta com `active: true` |
| Página "Termo" liberada por um id fixo no front | `features.termo = true` no doc do usuário (gravado só pelo script/Admin) |

Detalhes da conversão:

- **Senhas:** com 6+ caracteres, a conta é criada com `auth.createUser`
  (o Firebase gera o hash). Senhas mais curtas (aceitas na v1, recusadas pelo
  `createUser`) recebem um hash **bcrypt** e são importadas via
  `auth.importUsers` com algoritmo `BCRYPT`, que não aplica o mínimo de 6.
  Assim **todas** as senhas antigas continuam funcionando. O campo `password`
  some do Firestore.
  > ⚠️ O **emulador** de Auth não valida hashes importados: no ensaio local, o
  > login dos usuários de senha curta falha. No Firebase real funciona. Valide
  > esse caso em produção logo depois de migrar (passo 6) e, se preferir, peça
  > para esses usuários trocarem a senha no Perfil.
- **username:** `user.trim().toLowerCase()`. Se dois usuários antigos colidirem
  depois da normalização, o segundo é reportado como falha (resolva à mão).
- **name / nome:** `trim` + corte em 40 caracteres. Vazio vira o username
  (usuário) ou `"Matéria"` (matéria). Cada ajuste aparece nos avisos.
- **diaSemana:** copiado de `semana` (aceita `"3"` como texto). Fora de 1..7 =
  falha daquela matéria.
- **cor:** distribuída em ciclo pela paleta, por usuário.
- **createdAt:** usuários usam a data de criação do doc v1; matérias usam o
  momento da migração (`createdAt = updatedAt = agora`).
- **Datas das faltas:** a v1 não guardava data, então `data: null`.
- **Matérias órfãs** (cujo `id_user` não existe em `users`) **não são migradas**;
  aparecem nos avisos e continuam no backup.

---

## 2. Pré-requisitos

1. Node 22.12+ e `npm install` feito neste repositório.
2. **Service account** do projeto:
   - Console do Firebase -> ⚙ Configurações do projeto -> **Contas de serviço**
     -> **Gerar nova chave privada**.
   - Do JSON baixado, copie `project_id`, `client_email` e `private_key` para o `.env`:
     ```bash
     cp .env.example .env
     ```
     ```dotenv
     FIREBASE_PROJECT_ID=meu-projeto
     FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@meu-projeto.iam.gserviceaccount.com
     FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
     AUTH_EMAIL_DOMAIN=faltaket.app
     TERMO_USER_IDS=<id que estava fixo no front da v1>
     ```
   - **Nunca** commite o `.env` nem o JSON da chave (ambos estão no `.gitignore`).
     Apague a chave no console quando terminar a migração.
3. No Console do Firebase -> **Authentication** -> **Método de login**: habilite
   **E-mail/senha**.
4. `AUTH_EMAIL_DOMAIN` precisa ser **igual** ao configurado no front.

---

## 3. Backup completo (gcloud) — antes de tudo

O script já gera um backup JSON próprio (passo 4), mas faça também um export
oficial do Firestore, que permite restauração total:

```bash
gcloud auth login
gcloud config set project MEU-PROJETO

# bucket para guardar o export (uma vez só)
gsutil mb -l southamerica-east1 gs://MEU-PROJETO-backups

gcloud firestore export gs://MEU-PROJETO-backups/v1-$(date +%Y%m%d-%H%M)
```

> O export exige o plano **Blaze**. Se o projeto estiver no Spark, conte só com o
> backup JSON do script (passo 4) e guarde-o em lugar seguro.

Para restaurar um export: `gcloud firestore import gs://MEU-PROJETO-backups/<pasta>`.
(O import sobrescreve docs com o mesmo caminho, mas **não apaga** docs criados depois.)

---

## 4. Dry-run (simulação)

```bash
npm run migrate:dry
```

- Lê `users` e `materias` (+ `faltas`).
- **Grava o backup** `backups/v1-<data>.json` — mesmo no dry-run.
- Não escreve nada no Auth nem no Firestore.
- Mostra a tabela de relatório com os números **previstos**, os avisos e as falhas.

> ⚠️ O arquivo de backup contém as **senhas em texto puro** da v1. A pasta
> `backups/` está no `.gitignore`; não compartilhe e apague quando não precisar mais.

Analise o relatório:

| Linha | O que esperar |
| --- | --- |
| Users encontrados / no formato v1 | Total de usuários antigos |
| Auth importados (previsto) | Quantos serão criados no Auth |
| Auth pulados (já existiam) | 0 na primeira execução |
| Matérias órfãs | Idealmente 0; se houver, confira nos avisos |
| Faltas ativas v1 vs Faltas na v2 | Devem ser iguais |
| FALHAS | Devem ser 0 antes de seguir |

Se houver falhas (username duplicado, senha vazia, `semana` inválida...),
corrija os docs v1 no console e rode o dry-run de novo.

### Testando no emulador (opcional, recomendado)

Exige Java 21+.

```bash
npm run emulators            # em um terminal
# em outro terminal, importe dados de teste no emulador e rode:
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run migrate
```

Com as duas variáveis de emulador definidas, as credenciais não são exigidas e o
projeto padrão é `demo-faltaket`.

---

## 5. Executar a migração

```bash
npm run migrate
```

Ordem do que acontece:

1. Backup JSON em `backups/`.
2. **Auth:** para cada usuário v1 sem conta no Auth, cria a conta com
   `uid = id antigo`, `email = usernameToEmail(user)`, `displayName = name` e a
   senha antiga (`createUser`, ou importação bcrypt se tiver < 6 caracteres).
   Contas que já existem são puladas.
3. **users/{uid}:** reescreve o doc no formato v2 (sem `password`), com
   `features.termo = true` para os ids de `TERMO_USER_IDS`. Se a conta do Auth
   falhou, o doc v1 é mantido para tentar de novo.
4. **Matérias:** cria `users/{id_user}/materias/{id}` para cada matéria v1. Se o
   destino já existe, pula (não sobrescreve edições feitas pelo usuário na v2).
5. Relê os docs v2 e confere o total de faltas.
6. Imprime o relatório. **Código de saída ≠ 0 se houver qualquer falha.**

Pode rodar de novo quantas vezes quiser: o que já foi migrado é pulado.

> A coleção antiga `materias` **não é apagada** nesta etapa.

---

## 6. Validar

1. **Console -> Authentication -> Usuários:** confira a quantidade e alguns e-mails
   (`<username>@faltaket.app`).
2. **Console -> Firestore:** abra `users/<algum uid>` — deve ter `name`,
   `username`, `createdAt` e **nenhum** `password`. Abra
   `users/<uid>/materias` e compare com a v1.
3. **Login real no front v2** com 2 ou 3 usuários (de preferência um com senha
   curta, < 6 caracteres) usando a senha antiga.
4. Usuário de `TERMO_USER_IDS` enxerga a página "Termo"; outro usuário não.
5. Marque/desmarque uma falta no front e confira no console.
6. Publique as rules, se ainda não publicou: `npm run deploy:rules`.

---

## 7. Cleanup (só depois de validar)

Quando o front v2 estiver em produção e tudo conferido:

```bash
npm run migrate:dry -- --cleanup   # mostra quantos docs seriam apagados
npm run migrate -- --cleanup       # apaga de verdade
```

- Apaga **toda** a coleção top-level `materias` e as subcoleções `faltas`
  (incluindo as órfãs — elas continuam no backup JSON).
- **Recusado automaticamente** se a execução tiver qualquer falha.
- Nunca roda sem a flag `--cleanup`.
- A coleção `users` não é apagada: os docs já foram convertidos no lugar.

Depois do cleanup: revogue/apague a chave da service account usada e guarde (ou
apague) o backup JSON com segurança.

---

## 8. Rollback

### Antes do cleanup

Os dados v1 de matérias continuam intactos; só os usuários foram alterados.

1. Volte o front/API para a v1.
2. Restaure os docs `users` a partir do backup JSON (`backups/v1-<data>.json`).
   Exemplo de script de restauração (rode com `npx tsx restore.ts <arquivo>`;
   usa o mesmo `.env`):

   ```ts
   import { readFileSync } from 'node:fs'
   import { config } from 'dotenv'
   import { cert, initializeApp } from 'firebase-admin/app'
   import { getFirestore } from 'firebase-admin/firestore'

   config({ quiet: true })
   initializeApp({
     credential: cert({
       projectId: process.env.FIREBASE_PROJECT_ID,
       clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
       privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
     }),
   })
   const db = getFirestore()
   const backup = JSON.parse(readFileSync(process.argv[2]!, 'utf8'))

   for (const u of backup.users) {
     await db.collection('users').doc(u.id).set(u.data) // volta { name, user, password }
   }
   // Só se o cleanup já tiver rodado:
   for (const m of backup.materias) {
     const ref = db.collection('materias').doc(m.id)
     await ref.set(m.data)
     for (const f of m.faltas) await ref.collection('faltas').doc(f.id).set(f.data)
   }
   console.log('Restaurado.')
   ```

   > Os dados v1 não têm timestamps; se algum campo vier como
   > `{ "__type": "timestamp", "iso": ... }`, converta com `Timestamp.fromDate(new Date(iso))`.

3. (Opcional) Apague as subcoleções `users/{uid}/materias` e as contas do Auth
   criadas pela migração (Console -> Authentication, ou `auth.deleteUsers(uids)`).

### Depois do cleanup

Mesmo procedimento, executando também o trecho que recria `materias` +
`faltas`. Alternativa: `gcloud firestore import` do export feito no passo 3
(restaura tudo como estava no momento do export).

> Alterações feitas pelos usuários na v2 depois da migração **não** voltam para a
> v1 no rollback.
