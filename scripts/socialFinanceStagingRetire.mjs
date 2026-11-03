import { services, retire } from './socialFinanceStagingFixture.mjs';
const s = services();
try { await retire(s); console.log('Clôture vérifiée ; aucune suppression effectuée.'); }
finally { await s.close(); }
