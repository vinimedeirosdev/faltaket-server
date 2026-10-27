/**
 * Normalização de username e geração do e-mail sintético usado no Firebase Auth.
 *
 * ATENÇÃO: este arquivo é o contrato compartilhado com o front-end (React).
 * O front DEVE usar exatamente as mesmas funções; qualquer divergência impede o login
 * dos usuários migrados.
 */
export function normalizeUsername(u: string) { return u.trim().toLowerCase() }
export function usernameToEmail(u: string, domain: string) {
  const local = Array.from(normalizeUsername(u))
    .map((c) => (/[a-z0-9._-]/.test(c) ? c : `+${c.codePointAt(0)!.toString(16)}`))
    .join('')
  return `${local}@${domain}`
}
