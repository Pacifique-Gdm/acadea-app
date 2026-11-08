import { guard, services, retire } from './sevenAmendmentsStagingFixture.mjs';

guard();
const s = services();
try {
  await retire(s);
  console.log('Clôture PR48 vérifiée : comptes désactivés, sessions révoquées, écoles inactives ; aucune suppression.');
} finally { await s.close(); }
