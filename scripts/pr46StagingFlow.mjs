import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { expect } from '@playwright/test';
import { afterEnrollment, beforeEnrollment } from './socialFinanceStagingFixture.mjs';

const supportedRoles = new Set(['school_admin', 'secretary']);

export function pr46EnrollmentIdentity(fixture, role) {
  assert.ok(supportedRoles.has(role), 'Rôle PR46 non autorisé.');
  assert.equal(fixture?.recipe, 'pr46pr47', 'Fixture PR46/PR47 obligatoire.');
  assert.match(fixture.tag, /^e2e-social-[a-f0-9]{32}$/, 'Identifiant de fixture invalide.');
  assert.equal(fixture.schools?.[0], `${fixture.tag}-a`, 'École de recette inattendue.');
  assert.equal(fixture.year, `${fixture.tag}-year`, 'Année de recette inattendue.');
  return {
    role,
    nom: fixture.tag.toUpperCase(),
    postnom: 'PR46',
    prenom: role === 'school_admin' ? 'Admin' : 'Secretaire',
  };
}

function fixtureParent(fixture, suffix, schoolId) {
  const id = `${fixture.tag}-${suffix}`;
  const row = fixture.documents?.find((item) => item.path === `parents/${id}`);
  assert.equal(row?.data?.id, id, 'Parent absent du manifeste de recette.');
  assert.equal(row.data.schoolId, schoolId, 'École du parent incohérente.');
  assert.equal(row.data.fixtureId, fixture.tag, 'Parent étranger à la fixture.');
  return row.data;
}

async function openStudentForm(page) {
  const add = page.getByRole('button', { name: 'Ajouter un élève', exact: true });
  if (!(await add.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Élèves', exact: true }).last().click();
  }
  await expect(add).toBeVisible();
  await add.click();
  const drawer = page.getByRole('dialog', { name: 'Ajouter un élève' });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function findParent(drawer, searchTerm, fullName) {
  const search = drawer.getByRole('combobox', { name: 'Rechercher un parent' });
  await expect(search).toBeVisible();
  await search.fill(searchTerm);
  const list = drawer.getByRole('listbox', { name: 'Parents correspondants' });
  await expect(list).toBeVisible();
  const option = list.getByRole('option').filter({ hasText: fullName });
  await expect(option).toHaveCount(1);
  await option.click();
  await expect(search).toHaveCount(0);
  await expect(list).toHaveCount(0);
  await expect(drawer.getByLabel('Parent sélectionné', { exact: true })).toContainText(fullName);
}

async function parentIdsForSchool(services, schoolId) {
  const snapshot = await services.db.collection('parents').where('schoolId', '==', schoolId).get();
  return snapshot.docs.map((doc) => doc.id).sort();
}

/**
 * Authenticated UI flow, invoked only after SHA/project checks and fixture
 * preparation by the staging recipe. Both the real API and Firestore are used.
 * The fixture module durably plans the UI-created pupil before the save click
 * and archives only that exact pupil on retirement.
 */
export async function runPr46ParentEnrollment({ page, role, fixture, services, evidenceDir }) {
  const candidate = pr46EnrollmentIdentity(fixture, role);
  assert.ok(page && services?.db, 'Navigateur authentifié et accès Staging requis.');
  const schoolId = fixture.schools[0];
  const chosen = fixtureParent(fixture, 'parent-alt', schoolId);
  const removed = fixtureParent(fixture, 'parent', schoolId);
  const foreign = fixtureParent(fixture, 'parent-foreign', fixture.schools[1]);
  const parentIdsBefore = await parentIdsForSchool(services, schoolId);
  assert.ok(parentIdsBefore.includes(chosen.id) && parentIdsBefore.includes(removed.id));
  assert.ok(!parentIdsBefore.includes(foreign.id));

  const drawer = await openStudentForm(page);
  await findParent(drawer, 'emilie', removed.fullName);
  await drawer.getByRole('button', { name: 'Retirer le parent sélectionné' }).click();
  const search = drawer.getByRole('combobox', { name: 'Rechercher un parent' });
  await expect(search).toBeVisible();
  await search.fill('etranger');
  const list = drawer.getByRole('listbox', { name: 'Parents correspondants' });
  await expect(list.getByRole('option')).toHaveCount(0);
  await expect(list).toContainText('Aucun parent trouvé.');
  await findParent(drawer, 'basile', chosen.fullName);
  // The default class has a required sub-class. Select the dedicated class
  // without sub-classes before exercising the application-level rejection;
  // otherwise native HTML validation prevents onSave from running at all.
  await drawer.getByLabel('Classe', { exact: true }).selectOption({ label: '2ème Primaire' });
  await expect(drawer.getByLabel('Sous-classe', { exact: true })).toHaveCount(0);

  // A confirmed form rejection must neither clear the selected parent nor
  // create an unmanifested student. This is deliberately a client validation
  // failure; the hosted recipe must not synthesize an API response.
  const birthDate = drawer.getByLabel('Date de naissance', { exact: true });
  await birthDate.pressSequentially('01012090');
  await expect(birthDate).toHaveValue('01/01/2090');
  await drawer.getByRole('button', { name: 'Sauver', exact: true }).click();
  await expect(drawer.getByRole('alert').filter({ hasText: 'Le nom de l’élève est obligatoire.' })).toHaveCount(1);
  await expect(drawer.getByLabel('Parent sélectionné', { exact: true })).toContainText(chosen.fullName);
  await expect(drawer).toBeVisible();

  await drawer.getByLabel('Nom', { exact: true }).fill(candidate.nom);
  await drawer.getByLabel('Postnom', { exact: true }).fill(candidate.postnom);
  await drawer.getByLabel('Prénom', { exact: true }).fill(candidate.prenom);
  await expect(drawer.getByRole('button', { name: 'Ajouter sous-classe', exact: true })).toBeEnabled({ timeout: 60000 });
  await expect(drawer.getByLabel('Sous-classe', { exact: true })).toHaveCount(0);
  await expect(drawer.getByLabel('Parent sélectionné', { exact: true })).toContainText(chosen.fullName);

  // No application write may happen before the durable, narrowly scoped plan.
  const planned = await beforeEnrollment(services, fixture, candidate);
  let uiFailure;
  try {
    await drawer.getByRole('button', { name: 'Sauver', exact: true }).click();
    await expect(page.getByText('Élève enregistré avec succès.', { exact: true })).toBeVisible({ timeout: 60000 });
    await expect(drawer).toHaveCount(0);
  } catch (error) {
    uiFailure = error;
  }
  let recorded;
  try {
    recorded = await afterEnrollment(services, fixture, planned);
  } catch (error) {
    throw new AggregateError([...(uiFailure ? [uiFailure] : []), error], 'Inscription PR46 non confirmée; la clôture utilisera le manifeste pré-enregistré.');
  }
  if (uiFailure) throw uiFailure;

  const saved = await services.db.doc(recorded.path).get();
  assert.equal(saved.exists, true, 'Élève absent après confirmation UI.');
  assert.equal(saved.data().schoolId, schoolId);
  assert.equal(saved.data().schoolYearId, fixture.year);
  assert.equal(saved.data().parentId, chosen.id, 'Liaison au mauvais parent.');
  assert.equal(saved.data().fixtureId, fixture.tag);
  assert.equal(saved.data().className, '2ème Primaire');
  const [chosenAfter, removedAfter] = await Promise.all([
    services.db.doc(`parents/${chosen.id}`).get(), services.db.doc(`parents/${removed.id}`).get(),
  ]);
  assert.ok(chosenAfter.data()?.studentIds?.includes(saved.id), 'Lien réciproque du parent manquant.');
  assert.ok(!removedAfter.data()?.studentIds?.includes(saved.id), 'Le parent retiré conserve un lien erroné.');
  assert.deepEqual(await parentIdsForSchool(services, schoolId), parentIdsBefore, 'Création de parent en double.');

  const resetDrawer = await openStudentForm(page);
  await expect(resetDrawer.getByLabel('Nom', { exact: true })).toHaveValue('');
  await expect(resetDrawer.getByRole('combobox', { name: 'Rechercher un parent' })).toBeVisible();
  await expect(resetDrawer.getByLabel('Parent sélectionné', { exact: true })).toHaveCount(0);
  if (evidenceDir) {
    mkdirSync(evidenceDir, { recursive: true });
    await page.screenshot({ path: `${evidenceDir}/${role}-parent-reset.png`, fullPage: true });
  }
  await resetDrawer.getByRole('button', { name: 'Fermer le formulaire élève' }).click();
  return { role, studentPath: recorded.path, parentId: chosen.id, foreignParentExcluded: true, parentCreated: false, selectedParentReset: true };
}
