# Security Rules do Firestore

Arquivo: [`../firestore.rules`](../firestore.rules) · Testes: [`../tests/rules.test.ts`](../tests/rules.test.ts)

Na v2 o front acessa o Firestore **direto**. Não existe mais servidor no meio,
então as rules são a **única** barreira entre um usuário e os dados de outro.
Toda mudança nelas precisa de teste.

---

## Visão geral

| Caminho                                             | Ler  | Criar                                    | Atualizar            | Apagar |
| --------------------------------------------------- | ---- | ---------------------------------------- | -------------------- | ------ |
| `users/{uid}`                                       | dono | dono, formato válido, **sem** `features` | dono, **só** `name`  | dono   |
| `users/{uid}/materias/{id}`                         | dono | dono, formato válido                     | dono, formato válido | dono   |
| qualquer outro caminho (inclusive `materias` da v1) | ❌   | ❌                                       | ❌                   | ❌     |

"Dono" = usuário logado com `request.auth.uid == uid`.

O Admin SDK (script de migração, console do Firebase) **ignora** as rules.

---

## Regras, uma a uma

### Negado por padrão

Não existe nenhum `match` genérico (`/{document=**}`). Qualquer caminho que não
esteja listado é negado — incluindo a coleção antiga `materias` e qualquer
subcoleção dentro de uma matéria (ex.: `users/{uid}/materias/{id}/faltas`).

### Helpers

| Função                      | Significado                                          |
| --------------------------- | ---------------------------------------------------- |
| `isSignedIn()`              | `request.auth != null`                               |
| `isOwner(uid)`              | logado **e** `request.auth.uid == uid`               |
| `isNonEmptyString(v, max)`  | string com 1..max caracteres                         |
| `isIntInRange(v, min, max)` | inteiro (não aceita `1.5` nem `"1"`) entre min e max |

### `users/{uid}`

- **read / delete:** só o dono.
- **create:** só o dono e:
  - chaves **exatamente** `name`, `username`, `createdAt` (`hasOnly` + `hasAll`);
  - `name`: string 1..40;
  - `username`: string não vazia e **já normalizada**
    (`username == username.trim().lower()`), igual ao `normalizeUsername` do front;
  - `createdAt`: timestamp (use `serverTimestamp()`).
  - Como `features` não está na lista, o cliente **não consegue** se dar o Termo.
- **update:** só o dono, e `diff(...).affectedKeys().hasOnly(['name', 'foto', 'config'])`:
  - só `name` (1..40), `foto` e `config` podem mudar. `foto` pode ser removida ou ser uma data URL `data:image/(webp|jpeg);base64,...` com até 150 mil caracteres (a foto de perfil fica no próprio doc, sem Firebase Storage);
  - `config` (map, tudo opcional): `mediaAprovacao` e `mediaExame` números 0..10,
    `semestreInicio`/`semestreFim` no formato `AAAA-MM-DD`, `notificacoes` só com as
    chaves `aulas`, `provas`, `entregas`, `risco` (bool). Qualquer outra chave é negada;
  - `username`, `createdAt` e `features` ficam congelados — não dá para adicionar,
    alterar nem remover `features`;
  - um `setDoc` sem `merge` que "esqueça" `features` também é negado (seria remoção).

> `features.termo` é gravado somente via Admin SDK (script de migração ou
> console). Ausente equivale a `false`.

### `users/{uid}/materias/{materiaId}`

- **read / delete:** só o dono.
- **create / update:** só o dono, e o documento **resultante** precisa ser válido:

| Campo                    | Regra                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| chaves permitidas        | `nome`, `diaSemana`, `horarios`, `maxFaltas`, `cor`, `faltas`, `professor`, `notas`, `mediaAprovacao`, `createdAt`, `updatedAt` |
| chaves obrigatórias      | `nome`, `maxFaltas`, `cor`, `faltas`, `createdAt`, `updatedAt` **e** (`horarios` **ou** `diaSemana`)                            |
| `nome`                   | string 1..40                                                                                                                    |
| `horarios`               | lista com 1..14 itens (v3)                                                                                                      |
| `diaSemana`              | inteiro 1..7: **legado da v2.0**, aceito para as matérias ainda não editadas                                                    |
| `maxFaltas`              | inteiro 1..99                                                                                                                   |
| `cor`                    | uma de `violet`, `pink`, `rose`, `amber`, `emerald`, `sky`, `indigo`, `teal`                                                    |
| `faltas`                 | lista com no máximo 200 itens (pode passar de `maxFaltas` = "reprovou")                                                         |
| `professor`              | map só com `nome` (1..60) e `email` opcional (1..100)                                                                           |
| `notas`                  | lista com no máximo 30 itens                                                                                                    |
| `mediaAprovacao`         | número 0..10                                                                                                                    |
| `createdAt`, `updatedAt` | timestamp                                                                                                                       |

Como a validação é do documento final (`request.resource.data`), um `updateDoc`
parcial funciona desde que o resultado continue válido. Isso inclui a conversão
das matérias antigas, em que o front apaga `diaSemana` e grava `horarios` no mesmo update.

### `users/{uid}/eventos/{eventoId}`

Provas, trabalhos e entregas. Só o dono lê, cria, edita e apaga.

| Campo                 | Regra                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------- |
| obrigatórios          | `tipo`, `titulo`, `data`, `temHora`, `concluido`, `checklist`, `createdAt`, `updatedAt` |
| `tipo`                | `prova`, `trabalho`, `entrega` ou `outro`                                               |
| `titulo`              | string 1..60                                                                            |
| `materiaId`           | opcional, string 1..128                                                                 |
| `data`                | timestamp; `temHora` bool                                                               |
| `local` / `descricao` | opcionais, string 1..60 / 1..500                                                        |
| `concluido`           | bool                                                                                    |
| `checklist`           | lista com no máximo 30 itens                                                            |

### `users/{uid}/dispositivos/{id}`

Tokens dos lembretes (Firebase Cloud Messaging). Só o dono lê, cria e apaga.
Chaves: `token` (string 1..4096, obrigatório), `plataforma` (opcional, 1..120) e
`createdAt` (timestamp). O script de lembretes usa o Admin SDK, que ignora as rules.

### Limitações conhecidas

- **Itens de listas (`faltas`, `horarios`, `notas`, `checklist`):** as rules não conseguem iterar listas, então o formato de
  cada item (`{ id, data, obs? }`, `obs` <= 140) **não** é validado no servidor.
  O tamanho máximo (200) limita o estrago; o front deve validar os itens.
- **Timestamps:** só o tipo é validado (não se é `request.time`). Prefira
  `serverTimestamp()` no front.
- **Unicidade de username:** é garantida pelo Firebase Auth (o e-mail sintético é
  único), não pelas rules.

---

## Como rodar os testes

Os testes usam [`@firebase/rules-unit-testing`](https://firebase.google.com/docs/rules/unit-tests)
\+ Vitest contra o **emulador do Firestore**.

### Requisito: Java 21+

O Firebase CLI (firebase-tools 15) só roda os emuladores com **Java 21 ou
superior**. Com Java 8/11/17 aparece:

```
Error: firebase-tools no longer supports Java version before 21.
```

Instale um JDK 21+ (ex.: [Eclipse Temurin](https://adoptium.net/)) e confira:

```bash
java -version   # deve mostrar 21 ou maior
```

No Windows, se houver mais de um Java instalado, ajuste o `PATH`/`JAVA_HOME`
para o JDK 21 antes de rodar.

### Rodando

```bash
npm run test:rules
```

Esse script executa
`firebase emulators:exec --only firestore --project demo-faltaket "vitest run"`:
sobe o emulador, roda os testes e derruba o emulador. O projeto `demo-*` garante
que nada toca a produção e dispensa `firebase login`.

Para iterar mais rápido, deixe o emulador rodando e chame o Vitest direto:

```bash
npm run emulators                                   # terminal 1 (UI em http://127.0.0.1:4000)
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest   # terminal 2 (modo watch)
```

### O que é testado

- Dono: CRUD completo do perfil e das matérias; faltas acima de `maxFaltas`.
- Outro usuário: não lê nem escreve perfil/matérias alheios.
- Não autenticado: tudo negado.
- `features`: não pode ser enviado no create, nem adicionado/alterado/removido no update.
- Perfil: update só de `name`; create rejeita name/username/createdAt inválidos e campos extras.
- Matérias: rejeita cada campo inválido (nome, diaSemana, maxFaltas, cor, faltas, timestamps,
  campos extras, campo obrigatório faltando) no create e no update.
- Caminhos fora do contrato (`materias` v1, subcoleções) negados.

---

## Deploy

```bash
npm run deploy:rules   # firebase deploy --only firestore:rules,firestore:indexes
```

Usa o projeto do `.firebaserc` (copie de `.firebaserc.example`). Rode os testes antes.
