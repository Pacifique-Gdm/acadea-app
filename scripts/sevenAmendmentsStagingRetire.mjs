import { guard, services, retire } from './sevenAmendmentsStagingFixture.mjs';

guard();
const s = services();
try {
  await retire(s);
  console.log('Clôture PR48 vérifiée : écoles, documents et comptes d\x27essai effacés, aucun reste.');
} finally { await s.close(); }
