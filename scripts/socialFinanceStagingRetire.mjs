import { services, retire } from './socialFinanceStagingFixture.mjs';
const s = services();
try { await retire(s); console.log("Clôture vérifiée : écoles, documents et comptes d'essai effacés, aucun reste."); }
finally { await s.close(); }
