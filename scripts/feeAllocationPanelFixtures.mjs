import assert from 'node:assert/strict';

/** A personnel fixture is a complete AppUser, even without an Auth login. */
export function panelPersonnelFixture(tag, schoolId, yearId) {
  assert.match(tag, /^e2e-allocation-[a-f0-9]{32}$/);
  assert.equal(schoolId, `${tag}-volume`);
  assert.ok(yearId.startsWith(`${tag}-`));
  const id = `${tag}-panel-teacher`;
  return { id, schoolId, activeSchoolYearId: yearId, role: 'teacher',
    name: 'Personnel fictif recette panneau', email: `${id}@example.invalid`, active: true, status: 'active' };
}
