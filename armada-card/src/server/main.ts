import { startServer } from './server';

const port = Number(process.env.PORT) || 8787;
// ARMADA_DB permet de pointer une base jetable (vérifications, bac à sable).
const dbPath = process.env.ARMADA_DB || 'data/armada.db';
startServer({ port, dbPath });
console.log(`Serveur ARMADA en écoute sur ws://localhost:${port} — base ${dbPath}`);
console.log('Timeout de tour : 90 s · matchmaking : file d’attente + parties privées par code.');
console.log('Comptes : pseudo + mot de passe (créés au vol), collection et boosters persistants.');
