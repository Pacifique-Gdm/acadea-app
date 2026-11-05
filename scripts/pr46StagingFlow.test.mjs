import assert from 'node:assert/strict';
import test from 'node:test';
import { pr46EnrollmentIdentity } from './pr46StagingFlow.mjs';

const tag = `e2e-social-${'a'.repeat(32)}`;
const fixture = { recipe: 'pr46pr47', tag, schools: [`${tag}-a`, `${tag}-b`], year: `${tag}-year` };

test('PR46 enrollment identities are unique, fixture-bound, and role-specific', () => {
  const admin = pr46EnrollmentIdentity(fixture, 'school_admin');
  const secretary = pr46EnrollmentIdentity(fixture, 'secretary');
  assert.deepEqual(admin, { role: 'school_admin', nom: tag.toUpperCase(), postnom: 'PR46', prenom: 'Admin' });
  assert.deepEqual(secretary, { role: 'secretary', nom: tag.toUpperCase(), postnom: 'PR46', prenom: 'Secretaire' });
  assert.notEqual(admin.prenom, secretary.prenom);
});

test('PR46 enrollment refuses another role, recipe, school, or malformed fixture tag', () => {
  assert.throws(() => pr46EnrollmentIdentity(fixture, 'teacher'), /Rôle PR46/);
  assert.throws(() => pr46EnrollmentIdentity({ ...fixture, recipe: 'navigation' }, 'school_admin'), /Fixture PR46/);
  assert.throws(() => pr46EnrollmentIdentity({ ...fixture, schools: ['real-school'] }, 'school_admin'), /École de recette/);
  assert.throws(() => pr46EnrollmentIdentity({ ...fixture, tag: 'e2e-social-short' }, 'school_admin'), /Identifiant de fixture/);
});
