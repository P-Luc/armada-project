/** Client WebSocket minimal vers le serveur de jeu. */
export interface NetConnection {
  send: (m: unknown) => void;
  close: () => void;
}

/**
 * Deux façons de s'annoncer au serveur (phase 4, comptes persistants) :
 * `auth` crée le compte ou s'y connecte (pseudo + mot de passe), `hello`
 * reprend une session avec le jeton conservé dans le localStorage. Le mot de
 * passe ne quitte jamais la mémoire de la page — seul le jeton est stocké.
 */
export type Identifiants = { pseudo: string; password: string } | { token: string };

export function connect(
  ident: Identifiants,
  handlers: { onMsg: (m: never) => void; onClose: () => void },
): NetConnection {
  const url =
    (import.meta as { env?: Record<string, string> }).env?.VITE_WS_URL ??
    `ws://${location.hostname}:8787`;
  const ws = new WebSocket(url);
  ws.onopen = () =>
    ws.send(
      JSON.stringify(
        'token' in ident
          ? { t: 'hello', token: ident.token }
          : { t: 'auth', pseudo: ident.pseudo, password: ident.password },
      ),
    );
  ws.onmessage = (e) => {
    try {
      handlers.onMsg(JSON.parse(e.data as string) as never);
    } catch {
      /* message illisible : ignoré */
    }
  };
  ws.onclose = () => handlers.onClose();
  return {
    send: (m) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    },
    close: () => ws.close(),
  };
}
