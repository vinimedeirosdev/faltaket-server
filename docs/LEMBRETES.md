# Lembretes no celular

Notificações push do FaltaKet, **sem custo** (plano Spark do Firebase + GitHub Actions).

| Quando           | O que avisa                                                                                      | Preferência                               |
| ---------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| 07:00 (Brasília) | Aulas de hoje com horário e sala, alerta de matéria no limite de faltas, provas/entregas de hoje | Aulas, Limite de faltas, Provas, Entregas |
| 18:00 (Brasília) | Provas e entregas de **amanhã**; trabalhos/entregas em **3 dias**                                | Provas, Entregas                          |

Cada pessoa liga os lembretes **em cada aparelho** (Perfil → Lembretes) e escolhe os tipos.

## Como funciona

```
Celular ── Perfil → "Ligar" ──► Firebase Cloud Messaging gera um token
   │                                         │
   └── grava users/{uid}/dispositivos/{hash} ┘   (Security Rules: só o dono)

GitHub Actions (cron 10h e 21h UTC)
   └── npm run lembretes -- --turno=manha|noite --enviar
         ├── lê users, materias, eventos e dispositivos (Admin SDK)
         ├── monta a mensagem (scripts/lib/lembretes.ts, com testes)
         ├── envia pelo FCM (gratuito)
         └── apaga tokens inválidos (app desinstalado, permissão revogada)
```

No celular, o service worker do app (`faltaket/src/sw.ts`) recebe a mensagem e mostra
a notificação mesmo com o app fechado. Tocar nela abre o app na tela certa.

## Configuração (uma vez só)

### 1. Chave Web Push (front)

1. Console do Firebase → ⚙ **Configurações do projeto** → aba **Cloud Messaging**.
2. Em **Configuração da Web** → **Certificados push da Web** → **Gerar par de chaves**.
3. Copie a **chave pública** para o `faltaket/.env.local`:
   ```dotenv
   VITE_FIREBASE_VAPID_KEY=BPx...
   ```
4. Confira que `VITE_FIREBASE_MESSAGING_SENDER_ID` também está preenchido.
5. Faça o deploy do front: `npm run deploy` (no repositório `faltaket`).

> A chave pública **não é segredo** (ela vai para o navegador).

### 2. Publicar as regras

As regras que permitem gravar `dispositivos` precisam estar no ar:

```bash
npm run deploy:rules
```

### 3. GitHub Actions (envio agendado)

O workflow está em [`.github/workflows/lembretes.yml`](../.github/workflows/lembretes.yml).

1. Gere uma **chave nova** de service account: Console → ⚙ Configurações do projeto →
   **Contas de serviço** → **Gerar nova chave privada**. Use uma chave só para isso
   (se uma vazar, você revoga só ela).
2. No GitHub: repositório `faltaket-server` → **Settings → Secrets and variables →
   Actions → New repository secret**:
   - Nome: `FIREBASE_SERVICE_ACCOUNT`
   - Valor: o **conteúdo inteiro** do JSON baixado.
3. (Opcional) Em **Variables**, crie `APP_URL` se o app tiver domínio próprio
   (padrão: `https://faltaket.web.app`).
4. Faça push da branch com o workflow para a branch padrão (`main`). O GitHub só
   agenda workflows que estão na branch padrão.
5. Teste: aba **Actions → Lembretes → Run workflow** (deixe "Enviar de verdade"
   desmarcado para só ver no log o que seria enviado; marque para enviar).

> O cron do GitHub pode atrasar de alguns minutos até ~1 hora em horários de pico.
> Em repositórios sem nenhuma atividade por 60 dias, o GitHub pausa os agendamentos:
> basta reativar na aba Actions.

## Rodar localmente

```bash
npm run lembretes -- --turno=manha            # SIMULA: mostra o que enviaria a quem
npm run lembretes -- --turno=noite --enviar   # envia de verdade (usa o .env)
```

- **O padrão é simular.** Só envia com `--enviar` (que o workflow usa).
- Com `FIRESTORE_EMULATOR_HOST` definido, lê do emulador e **nunca** envia.

## No celular

- **Android (Chrome)**: funciona no navegador e no app instalado.
- **iPhone**: só com o app **instalado na tela de início** (Safari → Compartilhar →
  Adicionar à Tela de Início) e iOS 16.4 ou mais novo. O Perfil explica isso quando
  o app é aberto pelo Safari.
- **Computador**: Chrome/Edge/Firefox funcionam com a aba fechada (o navegador precisa
  estar aberto).
- Com o app aberto, o aviso aparece como um toast em vez de notificação do sistema.
- Os lembretes só funcionam no app publicado (`npm run build`/`deploy`), não no
  `npm run dev`, porque o service worker só existe no build.

## Problemas comuns

| Sintoma                                          | Causa provável                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| Perfil mostra "Lembretes ainda não configurados" | `VITE_FIREBASE_VAPID_KEY` vazio no build                             |
| "Permissão de notificação negada"                | O usuário bloqueou; liberar nas configurações do navegador/site      |
| Workflow falha com "Credenciais ausentes"        | Secret `FIREBASE_SERVICE_ACCOUNT` não criado (ou com outro nome)     |
| Workflow roda mas `enviados: 0`                  | Ninguém ligou os lembretes, ou não havia nada a avisar naquele turno |
| `tokensRemovidos` > 0                            | Normal: aparelhos que desinstalaram o app ou revogaram a permissão   |
