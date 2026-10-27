/**
 * Testes das Security Rules do Firestore (firestore.rules).
 *
 * Rodar com:  npm run test:rules
 * (sobe o emulador do Firestore via `firebase emulators:exec` — exige Java 21+)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
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
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = "demo-faltaket";
const ALICE = "alice-uid";
const BOB = "bob-uid";
const MATERIA_ID = "materia-1";
const FOTO_WEBP =
  "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

let env: RulesTestEnvironment;

// O contexto do rules-unit-testing devolve a instância "compat"; as funções
// modulares aceitam essa instância em runtime (elas desembrulham `_delegate`).
function dbAs(uid: string | null): Firestore {
  const ctx = uid
    ? env.authenticatedContext(uid)
    : env.unauthenticatedContext();
  return ctx.firestore() as unknown as Firestore;
}

function validUser(overrides: Record<string, unknown> = {}) {
  return {
    name: "Alice",
    username: "alice",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function validMateria(overrides: Record<string, unknown> = {}) {
  return {
    nome: "Cálculo I",
    diaSemana: 1,
    maxFaltas: 10,
    cor: "violet",
    faltas: [
      { id: "f1", data: Timestamp.now() },
      { id: "f2", data: null, obs: "atestado" },
    ],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

/** Popula dados ignorando as rules (como o Admin SDK faria). */
async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(db, "users", ALICE), {
      name: "Alice",
      username: "alice",
      createdAt: Timestamp.now(),
    });
    await setDoc(doc(db, "users", ALICE, "materias", MATERIA_ID), {
      ...validMateria(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await setDoc(doc(db, "users", BOB), {
      name: "Bob",
      username: "bob",
      createdAt: Timestamp.now(),
      features: { termo: true },
    });
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(
        fileURLToPath(new URL("../firestore.rules", import.meta.url)),
        "utf8",
      ),
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

// ======================================================================== users

describe("users/{uid}", () => {
  it("dono cria o próprio perfil com o formato válido", async () => {
    await assertSucceeds(setDoc(doc(dbAs(ALICE), "users", ALICE), validUser()));
  });

  it("dono lê, atualiza o name e apaga o próprio perfil", async () => {
    await seed();
    const db = dbAs(ALICE);
    await assertSucceeds(getDoc(doc(db, "users", ALICE)));
    await assertSucceeds(
      updateDoc(doc(db, "users", ALICE), { name: "Alice Silva" }),
    );
    await assertSucceeds(deleteDoc(doc(db, "users", ALICE)));
  });

  it("outro usuário não lê nem escreve o perfil alheio", async () => {
    await seed();
    const db = dbAs(BOB);
    await assertFails(getDoc(doc(db, "users", ALICE)));
    await assertFails(updateDoc(doc(db, "users", ALICE), { name: "Hacker" }));
    await assertFails(deleteDoc(doc(db, "users", ALICE)));
    await assertFails(
      setDoc(doc(db, "users", "novo-uid"), validUser({ username: "novo" })),
    );
  });

  it("não autenticado é negado", async () => {
    await seed();
    const db = dbAs(null);
    await assertFails(getDoc(doc(db, "users", ALICE)));
    await assertFails(setDoc(doc(db, "users", ALICE), validUser()));
    await assertFails(deleteDoc(doc(db, "users", ALICE)));
  });

  it("cliente não consegue criar perfil com features", async () => {
    await assertFails(
      setDoc(
        doc(dbAs(ALICE), "users", ALICE),
        validUser({ features: { termo: true } }),
      ),
    );
    await assertFails(
      setDoc(
        doc(dbAs(ALICE), "users", ALICE),
        validUser({ features: { termo: false } }),
      ),
    );
  });

  it("cliente não consegue adicionar, alterar ou remover features", async () => {
    await seed();
    // Alice não tem features: não pode se dar o Termo.
    await assertFails(
      updateDoc(doc(dbAs(ALICE), "users", ALICE), {
        features: { termo: true },
      }),
    );
    await assertFails(
      updateDoc(doc(dbAs(ALICE), "users", ALICE), { "features.termo": true }),
    );
    // Bob tem features: não pode alterar nem remover.
    await assertFails(
      updateDoc(doc(dbAs(BOB), "users", BOB), { "features.termo": false }),
    );
    await assertFails(
      updateDoc(doc(dbAs(BOB), "users", BOB), { features: deleteField() }),
    );
    // set sem merge sobrescreveria o doc inteiro (removendo features): negado.
    await assertFails(
      setDoc(
        doc(dbAs(BOB), "users", BOB),
        validUser({ name: "Bob", username: "bob" }),
      ),
    );
    // Mas Bob pode trocar o próprio nome normalmente.
    await assertSucceeds(
      updateDoc(doc(dbAs(BOB), "users", BOB), { name: "Bob Souza" }),
    );
  });

  it("update só pode alterar name", async () => {
    await seed();
    const db = dbAs(ALICE);
    await assertFails(
      updateDoc(doc(db, "users", ALICE), { username: "outra" }),
    );
    await assertFails(
      updateDoc(doc(db, "users", ALICE), { createdAt: Timestamp.now() }),
    );
    await assertFails(updateDoc(doc(db, "users", ALICE), { password: "123" }));
    await assertFails(updateDoc(doc(db, "users", ALICE), { name: "" }));
    await assertFails(
      updateDoc(doc(db, "users", ALICE), { name: "x".repeat(41) }),
    );
  });

  it("dono adiciona, troca e remove a foto de perfil", async () => {
    await seed();
    const ref = doc(dbAs(ALICE), "users", ALICE);
    await assertSucceeds(updateDoc(ref, { foto: FOTO_WEBP }));
    await assertSucceeds(
      updateDoc(ref, { foto: "data:image/jpeg;base64,/9j/4AAQSkZJRg==" }),
    );
    await assertSucceeds(updateDoc(ref, { foto: deleteField() }));
  });

  it("foto inválida, grande demais ou de outro usuário é negada", async () => {
    await seed();
    const ref = doc(dbAs(ALICE), "users", ALICE);
    await assertFails(updateDoc(ref, { foto: "https://exemplo.com/foto.png" }));
    await assertFails(
      updateDoc(ref, { foto: "data:image/svg+xml;base64,PHN2Zz4=" }),
    );
    await assertFails(
      updateDoc(ref, { foto: "data:text/html;base64,PGgxPg==" }),
    );
    await assertFails(updateDoc(ref, { foto: 123 }));
    await assertFails(
      updateDoc(ref, { foto: "data:image/webp;base64," + "A".repeat(150_000) }),
    );
    await assertFails(
      updateDoc(doc(dbAs(BOB), "users", ALICE), { foto: FOTO_WEBP }),
    );
  });

  it("create rejeita campos inválidos", async () => {
    const ref = doc(dbAs(ALICE), "users", ALICE);
    await assertFails(setDoc(ref, validUser({ name: "" })));
    await assertFails(setDoc(ref, validUser({ name: "x".repeat(41) })));
    await assertFails(setDoc(ref, validUser({ name: 123 })));
    await assertFails(setDoc(ref, validUser({ username: "Alice" })));
    await assertFails(setDoc(ref, validUser({ username: " alice " })));
    await assertFails(setDoc(ref, validUser({ username: "" })));
    await assertFails(setDoc(ref, validUser({ createdAt: "ontem" })));
    await assertFails(setDoc(ref, validUser({ password: "segredo" })));
    await assertFails(setDoc(ref, { name: "Alice", username: "alice" })); // sem createdAt
  });
});

// ===================================================================== materias

describe("users/{uid}/materias/{materiaId}", () => {
  it("dono faz CRUD completo", async () => {
    await seed();
    const db = dbAs(ALICE);
    const ref = doc(db, "users", ALICE, "materias", "nova");
    await assertSucceeds(setDoc(ref, validMateria()));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(
      updateDoc(ref, {
        faltas: [{ id: "f9", data: Timestamp.now(), obs: "chuva" }],
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(deleteDoc(ref));
  });

  it("faltas podem ultrapassar maxFaltas (reprovou)", async () => {
    await seed();
    const faltas = Array.from({ length: 15 }, (_, i) => ({
      id: `f${i}`,
      data: null,
    }));
    await assertSucceeds(
      setDoc(
        doc(dbAs(ALICE), "users", ALICE, "materias", "m"),
        validMateria({ maxFaltas: 3, faltas }),
      ),
    );
  });

  it("outro usuário não lê nem escreve matérias alheias", async () => {
    await seed();
    const db = dbAs(BOB);
    const ref = doc(db, "users", ALICE, "materias", MATERIA_ID);
    await assertFails(getDoc(ref));
    await assertFails(updateDoc(ref, { nome: "Hackeada" }));
    await assertFails(deleteDoc(ref));
    await assertFails(
      setDoc(doc(db, "users", ALICE, "materias", "x"), validMateria()),
    );
  });

  it("não autenticado é negado", async () => {
    await seed();
    const db = dbAs(null);
    const ref = doc(db, "users", ALICE, "materias", MATERIA_ID);
    await assertFails(getDoc(ref));
    await assertFails(
      setDoc(doc(db, "users", ALICE, "materias", "x"), validMateria()),
    );
    await assertFails(deleteDoc(ref));
  });

  it("rejeita campos inválidos na criação", async () => {
    await seed();
    const ref = doc(dbAs(ALICE), "users", ALICE, "materias", "invalida");
    const invalidos: Record<string, unknown>[] = [
      { nome: "" },
      { nome: "x".repeat(41) },
      { nome: 42 },
      { diaSemana: 0 },
      { diaSemana: 8 },
      { diaSemana: 1.5 },
      { diaSemana: "1" },
      { maxFaltas: 0 },
      { maxFaltas: 100 },
      { maxFaltas: 2.5 },
      { cor: "red" },
      { cor: "VIOLET" },
      { faltas: "nenhuma" },
      { faltas: { a: 1 } },
      {
        faltas: Array.from({ length: 201 }, (_, i) => ({
          id: `f${i}`,
          data: null,
        })),
      },
      { createdAt: "hoje" },
      { updatedAt: 123 },
      { extra: true },
      { id_user: ALICE },
    ];
    for (const override of invalidos) {
      await assertFails(setDoc(ref, validMateria(override)));
    }
  });

  it("rejeita matéria sem campos obrigatórios", async () => {
    await seed();
    const ref = doc(dbAs(ALICE), "users", ALICE, "materias", "incompleta");
    const { cor: _cor, ...semCor } = validMateria();
    await assertFails(setDoc(ref, semCor));
  });

  it("rejeita update que deixa a matéria inválida", async () => {
    await seed();
    const ref = doc(dbAs(ALICE), "users", ALICE, "materias", MATERIA_ID);
    await assertFails(updateDoc(ref, { maxFaltas: 0 }));
    await assertFails(updateDoc(ref, { cor: "black" }));
    await assertFails(updateDoc(ref, { diaSemana: 9 }));
    await assertFails(updateDoc(ref, { nome: deleteField() }));
    await assertFails(updateDoc(ref, { semana: 1 }));
    await assertSucceeds(
      updateDoc(ref, {
        nome: "Cálculo II",
        diaSemana: 7,
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

// ============================================================ v3: horários, notas, config

function materiaV3(overrides: Record<string, unknown> = {}) {
  const { diaSemana: _d, ...base } = validMateria();
  return {
    ...base,
    horarios: [
      { dia: 2, inicio: "19:00", fim: "20:40", sala: "204", aulas: 2 },
      { dia: 4, aulas: 1 },
    ],
    professor: { nome: "Dra. Ana", email: "ana@uni.br" },
    notas: [
      { id: "n1", nome: "P1", peso: 2, valor: 7.5 },
      { id: "n2", nome: "P2", peso: 1, valor: null },
    ],
    mediaAprovacao: 6.5,
    ...overrides,
  };
}

describe("matérias v3", () => {
  it("cria com horarios (sem diaSemana), professor, notas e média própria", async () => {
    await seed();
    await assertSucceeds(
      setDoc(doc(dbAs(ALICE), "users", ALICE, "materias", "v3"), materiaV3()),
    );
  });

  it("converte matéria antiga: apaga diaSemana e grava horarios", async () => {
    await seed();
    const ref = doc(dbAs(ALICE), "users", ALICE, "materias", MATERIA_ID);
    await assertSucceeds(
      updateDoc(ref, {
        diaSemana: deleteField(),
        horarios: [{ dia: 3, aulas: 1 }],
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("matéria antiga (só diaSemana) continua editável", async () => {
    await seed();
    const ref = doc(dbAs(ALICE), "users", ALICE, "materias", MATERIA_ID);
    await assertSucceeds(
      updateDoc(ref, { faltas: [], updatedAt: serverTimestamp() }),
    );
  });

  it("rejeita v3 inválida", async () => {
    await seed();
    const ref = doc(dbAs(ALICE), "users", ALICE, "materias", "ruim");
    const invalidos: Record<string, unknown>[] = [
      { horarios: [] },
      { horarios: "seg" },
      { horarios: Array.from({ length: 15 }, () => ({ dia: 1, aulas: 1 })) },
      { professor: "Ana" },
      { professor: { nome: "" } },
      { professor: { nome: "Ana", telefone: "123" } },
      { notas: "nenhuma" },
      {
        notas: Array.from({ length: 31 }, (_, i) => ({
          id: "n" + i,
          nome: "P",
          peso: 1,
          valor: null,
        })),
      },
      { mediaAprovacao: 11 },
      { mediaAprovacao: "7" },
    ];
    for (const o of invalidos) await assertFails(setDoc(ref, materiaV3(o)));
    // sem horarios e sem diaSemana: não sabe quando é a aula
    const { horarios: _h, ...semDia } = materiaV3();
    await assertFails(setDoc(ref, semDia));
  });
});

describe("users/{uid}.config", () => {
  it("dono atualiza preferências válidas, inclusive campo a campo", async () => {
    await seed();
    const ref = doc(dbAs(ALICE), "users", ALICE);
    await assertSucceeds(
      updateDoc(ref, {
        config: {
          mediaAprovacao: 7,
          mediaExame: 4.5,
          semestreInicio: "2026-08-01",
          semestreFim: "2026-12-15",
          notificacoes: { aulas: true, provas: false },
        },
      }),
    );
    await assertSucceeds(updateDoc(ref, { "config.mediaAprovacao": 6 }));
    await assertSucceeds(
      updateDoc(ref, { "config.mediaExame": deleteField() }),
    );
  });

  it("rejeita config inválida", async () => {
    await seed();
    const ref = doc(dbAs(ALICE), "users", ALICE);
    const invalidas: Record<string, unknown>[] = [
      { mediaAprovacao: 12 },
      { mediaExame: -1 },
      { semestreFim: "dezembro" },
      { notificacoes: { aulas: "sim" } },
      { notificacoes: { spam: true } },
      { features: { termo: true } },
      { outra: 1 },
    ];
    for (const c of invalidas) await assertFails(updateDoc(ref, { config: c }));
  });
});

// ====================================================================== eventos

function validEvento(overrides: Record<string, unknown> = {}) {
  return {
    tipo: "prova",
    titulo: "P1 de Anatomia",
    materiaId: MATERIA_ID,
    data: Timestamp.now(),
    temHora: true,
    local: "Sala 12",
    descricao: "Capítulos 1 a 4",
    concluido: false,
    checklist: [{ id: "c1", texto: "Revisar", feito: false }],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

describe("users/{uid}/eventos/{id}", () => {
  it("dono faz CRUD; campos opcionais podem faltar", async () => {
    await seed();
    const db = dbAs(ALICE);
    const ref = doc(db, "users", ALICE, "eventos", "e1");
    await assertSucceeds(setDoc(ref, validEvento()));
    await assertSucceeds(
      updateDoc(ref, { concluido: true, updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(
      updateDoc(ref, {
        local: deleteField(),
        materiaId: deleteField(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(deleteDoc(ref));
  });

  it("outro usuário e anônimo são negados", async () => {
    await seed();
    await assertFails(
      setDoc(doc(dbAs(BOB), "users", ALICE, "eventos", "x"), validEvento()),
    );
    await assertFails(getDoc(doc(dbAs(null), "users", ALICE, "eventos", "x")));
  });

  it("rejeita evento inválido", async () => {
    await seed();
    const ref = doc(dbAs(ALICE), "users", ALICE, "eventos", "ruim");
    const invalidos: Record<string, unknown>[] = [
      { tipo: "festa" },
      { titulo: "" },
      { titulo: "x".repeat(61) },
      { data: "2026-10-10" },
      { temHora: "sim" },
      { local: "" },
      { descricao: "x".repeat(501) },
      { concluido: 1 },
      {
        checklist: Array.from({ length: 31 }, (_, i) => ({
          id: "c" + i,
          texto: "a",
          feito: false,
        })),
      },
      { extra: true },
    ];
    for (const o of invalidos) await assertFails(setDoc(ref, validEvento(o)));
  });
});

describe("users/{uid}/dispositivos/{id}", () => {
  it("dono registra e remove o token; outro usuário não", async () => {
    await seed();
    const ref = doc(dbAs(ALICE), "users", ALICE, "dispositivos", "hash1");
    await assertSucceeds(
      setDoc(ref, {
        token: "tok",
        plataforma: "Android",
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      getDoc(doc(dbAs(BOB), "users", ALICE, "dispositivos", "hash1")),
    );
    await assertFails(setDoc(ref, { token: "", createdAt: serverTimestamp() }));
    await assertFails(
      setDoc(ref, { token: "tok", createdAt: serverTimestamp(), uid: BOB }),
    );
    await assertSucceeds(deleteDoc(ref));
  });
});

// ============================================================ caminhos inválidos

describe("negado por padrão", () => {
  it("coleções fora do contrato são negadas, inclusive para logados", async () => {
    const db = dbAs(ALICE);
    await assertFails(getDoc(doc(db, "materias", "qualquer")));
    await assertFails(setDoc(doc(db, "materias", "qualquer"), { nome: "x" }));
    await assertFails(setDoc(doc(db, "outra", "x"), { a: 1 }));
    await assertFails(
      setDoc(doc(db, "users", ALICE, "materias", MATERIA_ID, "faltas", "f1"), {
        active: true,
      }),
    );
  });
});
