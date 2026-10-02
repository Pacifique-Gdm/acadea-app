const fail = (message, statusCode = 409) => { throw Object.assign(new Error(message), { statusCode, code: statusCode === 403 ? "permission-denied" : "failed-precondition" }); };
const unique = (values) => [...new Set(values)];
const id = (value) => typeof value === "string" && value.length > 0 && value.length <= 500 && !value.includes("/") ? value : fail("Identifiant pédagogique invalide.", 400);
const grantKey = ({ schoolId, schoolYearId, teacherId, id: assignmentId }) => [schoolId, schoolYearId, teacherId, assignmentId].join("/");
const groupKey = (selection) => selection.courseScope ? `${selection.courseScope}--${unique(selection.targetOptionIds || []).sort().map(encodeURIComponent).join("--")}` : undefined;
const assignmentId = (scope) => [scope.schoolId, scope.schoolYearId, scope.teacherId, scope.subjectId, scope.classId, scope.studentGroupKey].filter(Boolean).join("__");
const lockId = (scope) => [scope.schoolId, scope.schoolYearId, scope.subjectId, scope.classId, scope.studentGroupKey].filter(Boolean).join("__");
const active = (value) => value?.status !== "inactive" && value?.active !== false;
const optionKey = (value) => value?.classOptionKey || (value?.option?.trim() || !value?.subClassLabel && value?.id?.includes("::") ? value.id : undefined);

async function checkScope(transaction, db, caller, schoolId, schoolYearId) {
  if (caller.role !== "study_director" || caller.schoolId !== schoolId) fail("Accès Directeur des études refusé.", 403);
  const [actor, school, year] = await Promise.all([transaction.get(db.doc(`users/${caller.uid}`)), transaction.get(db.doc(`schools/${schoolId}`)), transaction.get(db.doc(`schoolYears/${schoolYearId}`))]);
  if (!actor.exists || actor.data().role !== "study_director" || actor.data().schoolId !== schoolId || !active(actor.data())) fail("Directeur des études inactif ou hors périmètre.", 403);
  if (!school.exists || school.data().status !== "active" || school.data().activeSchoolYearId !== schoolYearId || !year.exists || year.data().schoolId !== schoolId || year.data().status !== "active") fail("Année scolaire ou école inactive.", 403);
  return actor.data();
}

function grants(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) fail("Droits Storage du compte incohérents.");
  return value;
}

function updateUserGrants(transaction, snapshot, additions, removals) {
  if (!snapshot) return;
  const current = grants(snapshot.data().storageAssignmentKeys);
  const next = unique([...current.filter((key) => !removals.includes(key)), ...additions]).sort();
  if (JSON.stringify(current) !== JSON.stringify(next)) transaction.update(snapshot.ref, { storageAssignmentKeys: next });
}

async function linkedUser(transaction, db, teacher, schoolId, requireActive = true) {
  const userId = teacher?.userId;
  if (!userId) return undefined; // Enseignant historique : pédagogie préservée, Storage fermé.
  id(userId);
  const user = await transaction.get(db.doc(`users/${userId}`));
  if (!user.exists || user.data().role !== "teacher" || user.data().schoolId !== schoolId || (requireActive && !active(user.data()))) fail("Compte Enseignant inactif ou hors périmètre.");
  return user.data().status === "active" && user.data().active === true ? user : undefined;
}

function validatedPattern(pattern, periods) {
  if (pattern == null) return undefined;
  if (pattern.mode !== "blocks" || !Array.isArray(pattern.blocks) || pattern.blocks.length < 1 || pattern.blocks.length > 6 || pattern.blocks.some((item) => !Number.isInteger(item) || item < 1 || item > 6) || pattern.blocks.reduce((sum, item) => sum + item, 0) !== periods) fail("Organisation des périodes invalide.", 400);
  return { mode: "blocks", blocks: [...pattern.blocks].sort((a, b) => a - b) };
}

export async function saveStudyAssignments({ db, caller, body }) {
  const schoolId = id(body.schoolId), schoolYearId = id(body.schoolYearId), teacherId = id(body.teacherId);
  const subjectIds = unique(Array.isArray(body.subjectIds) ? body.subjectIds.map(id) : []);
  const selections = Array.isArray(body.classSelections) ? body.classSelections.map((selection) => ({ classId: id(selection.classId), courseScope: selection.courseScope || undefined, targetOptionIds: unique(Array.isArray(selection.targetOptionIds) ? selection.targetOptionIds.map(id) : []).sort() })) : [];
  const weeklyPeriods = body.weeklyPeriods;
  if (!subjectIds.length || !selections.length || subjectIds.length * selections.length > 60 || !Number.isInteger(weeklyPeriods) || weeklyPeriods < 1 || weeklyPeriods > 60) fail("Affectation pédagogique invalide.", 400);
  const pattern = validatedPattern(body.sessionPattern, weeklyPeriods);
  const currentId = body.currentId ? id(body.currentId) : undefined;
  const titularClassIds = body.active === true ? unique(Array.isArray(body.titularClassIds) ? body.titularClassIds.map(id) : []) : [];
  const legacyClasses = Array.isArray(body.legacyClasses) ? body.legacyClasses : [];
  const relevantClasses = new Set([...selections.map((selection) => selection.classId), ...selections.flatMap((selection) => selection.targetOptionIds), ...titularClassIds]);
  if (legacyClasses.some((item) => !item || !relevantClasses.has(id(item.id)))) fail("Classe historique hors affectation.", 400);
  const activeAssignment = body.active === true;
  if (body.active !== true && body.active !== false) fail("Statut d'affectation invalide.", 400);
  const now = new Date().toISOString();
  return db.runTransaction(async (transaction) => {
    const actorProfile = await checkScope(transaction, db, caller, schoolId, schoolYearId);
    const teacherRef = db.doc(`teachers/${teacherId}`);
    const teacher = await transaction.get(teacherRef);
    if (!teacher.exists || teacher.data().schoolId !== schoolId || teacher.data().schoolYearId !== schoolYearId || !active(teacher.data())) fail("Enseignant inactif ou hors périmètre.");
    const teacherUser = await linkedUser(transaction, db, teacher.data(), schoolId);
    const currentRef = currentId ? db.doc(`pedagogicalAssignments/${currentId}`) : undefined;
    const current = currentRef ? await transaction.get(currentRef) : undefined;
    if (currentRef && (!current?.exists || current.data().schoolId !== schoolId || current.data().schoolYearId !== schoolYearId)) fail("Affectation à modifier introuvable.");
    const previousTeacherRef = current?.exists && current.data().teacherId !== teacherId ? db.doc(`teachers/${id(current.data().teacherId)}`) : undefined;
    const previousTeacher = previousTeacherRef ? await transaction.get(previousTeacherRef) : undefined;
    if (previousTeacher && (!previousTeacher.exists || previousTeacher.data().schoolId !== schoolId || previousTeacher.data().schoolYearId !== schoolYearId)) fail("Ancien enseignant hors périmètre.");
    const previousUser = previousTeacher ? await linkedUser(transaction, db, previousTeacher.data(), schoolId, false) : undefined;
    const subjectRefs = subjectIds.map((subjectId) => db.doc(`subjects/${subjectId}`));
    const requiredClassIds = unique([...selections.map((selection) => selection.classId), ...titularClassIds, ...legacyClasses.map((item) => id(item.id))]);
    const classRefs = unique([...requiredClassIds, ...selections.flatMap((selection) => selection.targetOptionIds.map(id))]).map((classId) => db.doc(`classes/${classId}`));
    const optionQueries = unique(selections.map((selection) => selection.classId)).map((classId) => db.collection("classes").where("parentClassId", "==", classId));
    const [subjects, classes, optionChildren] = await Promise.all([Promise.all(subjectRefs.map((ref) => transaction.get(ref))), Promise.all(classRefs.map((ref) => transaction.get(ref))), Promise.all(optionQueries.map((query) => transaction.get(query)))]);
    if (subjects.some((snapshot) => !snapshot.exists || snapshot.data().schoolId !== schoolId || snapshot.data().schoolYearId !== schoolYearId || snapshot.data().active === false)) fail("Cours inconnu ou hors périmètre.");
    const legacyById = new Map(legacyClasses.map((item) => [id(item.id), item]));
    const classById = new Map(classRefs.map((ref, index) => [ref.id, classes[index].exists ? classes[index].data() : undefined]));
    for (const classId of requiredClassIds) {
      const value = classById.get(classId) || legacyById.get(classId);
      if (!value || value.schoolId !== schoolId || value.schoolYearId !== schoolYearId || value.active === false || !String(value.name || "").trim()) fail("Classe inconnue ou hors périmètre.");
      if (!classById.get(classId) && (!legacyById.has(classId) || !classId.startsWith(`${schoolId}__${schoolYearId}__`))) fail("Classe historique invalide.");
    }
    const allowedSections = Array.isArray(actorProfile.sectionIds) && actorProfile.sectionIds.length ? actorProfile.sectionIds : actorProfile.section ? [actorProfile.section] : [];
    if (allowedSections.length && requiredClassIds.some((classId) => {
      const item = classById.get(classId) || legacyById.get(classId);
      return item?.section && !allowedSections.includes(item.section);
    })) fail("Classe hors périmètre du Directeur des études.", 403);
    const optionClassValues = [...classRefs.map((ref) => classById.get(ref.id) || legacyById.get(ref.id)), ...optionChildren.flatMap((result) => result.docs.map((snapshot) => snapshot.data()))].filter(Boolean);
    for (const selection of selections) {
      const targets = selection.targetOptionIds;
      const availableOptionIds = new Set(optionClassValues.filter((item) => item.schoolId === schoolId && item.schoolYearId === schoolYearId && item.active !== false && (item.parentClassId === selection.classId || (!item.parentClassId && item.id?.startsWith(`${selection.classId}::`)))).map(optionKey).filter(Boolean));
      if (!selection.courseScope && targets.length) fail("Portée de cours invalide.", 400);
      if (!selection.courseScope && availableOptionIds.size) fail("Choisissez le type de cours pour cette classe.", 400);
      if (selection.courseScope && !["common", "option"].includes(selection.courseScope)) fail("Portée de cours invalide.", 400);
      if (selection.courseScope && !availableOptionIds.size) fail("Cette classe ne possède aucune option configurable.", 400);
      if (selection.courseScope === "common" && targets.length < 2 || selection.courseScope === "option" && targets.length !== 1) fail("Options de cours invalides.", 400);
      if (targets.some((target) => !target.startsWith(`${selection.classId}::`) || !availableOptionIds.has(target))) fail("Option hors périmètre.", 400);
    }
    const combinations = subjectIds.flatMap((subjectId) => selections.map((selection) => ({ schoolId, schoolYearId, teacherId, subjectId, classId: selection.classId, ...(selection.courseScope ? { courseScope: selection.courseScope, targetOptionIds: selection.targetOptionIds, studentGroupKey: groupKey(selection) } : {}) })));
    const targets = combinations.map((scope) => ({ ...scope, id: assignmentId(scope), lockId: lockId(scope) }));
    if (new Set(targets.map((target) => target.lockId)).size !== targets.length) fail("Portée pédagogique dupliquée.", 400);
    if (titularClassIds.some((classId) => !selections.some((selection) => selection.classId === classId || selection.targetOptionIds.includes(optionKey(classById.get(classId)) || classId)))) fail("Titularité hors affectation.", 400);
    const lockRefs = targets.map((target) => db.doc(`pedagogicalAssignmentLocks/${target.lockId}`));
    const titularRefs = titularClassIds.map((classId) => db.doc(`classTitulars/${schoolId}__${schoolYearId}__${classId}`));
    const [locks, titulars] = await Promise.all([Promise.all(lockRefs.map((ref) => transaction.get(ref))), Promise.all(titularRefs.map((ref) => transaction.get(ref)))]);
    const occupied = locks.filter((snapshot) => snapshot.exists && snapshot.data().assignmentId !== currentId);
    const occupiedAssignments = await Promise.all(occupied.map((snapshot) => transaction.get(db.doc(`pedagogicalAssignments/${id(snapshot.data().assignmentId)}`))));
    if (activeAssignment && occupiedAssignments.some((snapshot) => !snapshot.exists || snapshot.data().active !== false)) fail("Ce cours est déjà affecté activement à cette classe.");
    if (titulars.some((snapshot) => snapshot.exists && snapshot.data().active !== false && snapshot.data().teacherId !== teacherId)) fail("Cette classe possède déjà un autre titulaire actif.");
    const previousTitularRefs = unique([...(current?.data().titularClassId ? [current.data().titularClassId] : []), ...(Array.isArray(body.existingTitularIds) ? body.existingTitularIds.map(id) : [])].filter((item) => !titularClassIds.includes(item))).map((classId) => db.doc(`classTitulars/${schoolId}__${schoolYearId}__${classId}`));
    const previousTitulars = await Promise.all(previousTitularRefs.map((ref) => transaction.get(ref)));
    const targetIds = new Set(targets.map((target) => target.id));
    const removed = current?.exists && (!targetIds.has(current.id) || current.data().teacherId !== teacherId) ? [grantKey({ ...current.data(), id: current.id })] : [];
    const additions = activeAssignment ? targets.map(grantKey) : [];
    const removals = [...removed, ...(!activeAssignment ? targets.map(grantKey) : [])];
    // Toutes les lectures précèdent les écritures ci-dessous.
    for (const [classId, item] of legacyById) if (!classById.get(classId)) transaction.create(db.doc(`classes/${classId}`), { id: classId, schoolId, schoolYearId, name: item.name.trim(), active: true, ...(item.parentClassId ? { parentClassId: id(item.parentClassId) } : {}), ...(item.classOptionKey ? { classOptionKey: String(item.classOptionKey) } : {}), ...(item.subClassLabel ? { subClassLabel: String(item.subClassLabel) } : {}), ...(item.option ? { option: String(item.option) } : {}), ...(item.vacation ? { vacation: item.vacation } : {}), ...(item.saturdayEnabled !== undefined ? { saturdayEnabled: item.saturdayEnabled } : {}), ...(item.saturdayVacation !== undefined ? { saturdayVacation: item.saturdayVacation } : {}), createdBy: caller.uid, createdAt: now, updatedAt: now });
    if (current?.exists && removed.length) transaction.update(current.ref, { active: false, titularClassId: null, updatedAt: now, updatedBy: caller.uid });
    for (const target of targets) {
      const selectedTitular = target.subjectId === subjectIds[0] ? titularClassIds.find((classId) => classId === target.classId || target.targetOptionIds?.includes(optionKey(classById.get(classId)) || classId)) : undefined;
      transaction.set(db.doc(`pedagogicalAssignments/${target.id}`), { ...Object.fromEntries(Object.entries(target).filter(([key]) => key !== "lockId")), weeklyPeriods, blockSize: pattern ? 1 : current?.id === target.id ? current.data().blockSize ?? 1 : 1, ...(pattern ? { sessionPattern: pattern } : {}), preferredRoomId: current?.id === target.id ? current.data().preferredRoomId ?? null : null, titularClassId: selectedTitular || null, active: activeAssignment, createdAt: current?.id === target.id ? current.data().createdAt : now, createdBy: current?.id === target.id ? current.data().createdBy : caller.uid, updatedAt: now, updatedBy: caller.uid });
      if (activeAssignment) transaction.set(db.doc(`pedagogicalAssignmentLocks/${target.lockId}`), { id: target.lockId, schoolId, schoolYearId, subjectId: target.subjectId, classId: target.classId, ...(target.studentGroupKey ? { studentGroupKey: target.studentGroupKey, courseScope: target.courseScope, targetOptionIds: target.targetOptionIds } : {}), teacherId, assignmentId: target.id, updatedAt: now, updatedBy: caller.uid });
    }
    previousTitularRefs.forEach((ref, index) => { if (previousTitulars[index].exists && previousTitulars[index].data().teacherId === (current?.data().teacherId || teacherId)) transaction.delete(ref); });
    titularClassIds.forEach((classId) => {
      const target = targets.find((item) => item.subjectId === subjectIds[0] && (item.classId === classId || item.targetOptionIds?.includes(optionKey(classById.get(classId)) || classId)));
      if (!target) fail("Affectation titulaire introuvable.");
      transaction.set(db.doc(`classTitulars/${schoolId}__${schoolYearId}__${classId}`), { id: `${schoolId}__${schoolYearId}__${classId}`, schoolId, schoolYearId, classId, teacherId, assignmentId: target.id, active: true, updatedAt: now, updatedBy: caller.uid });
    });
    updateUserGrants(transaction, teacherUser, additions, removals);
    if (previousUser && previousUser.id !== teacherUser?.id) updateUserGrants(transaction, previousUser, [], removed);
    return { count: targets.length };
  });
}

export async function setStudyAssignmentActive({ db, caller, body }) {
  const targetId = id(body.assignmentId), schoolId = id(body.schoolId), schoolYearId = id(body.schoolYearId);
  if (body.active !== true && body.active !== false) fail("Statut d'affectation invalide.", 400);
  return db.runTransaction(async (transaction) => {
    await checkScope(transaction, db, caller, schoolId, schoolYearId);
    const targetRef = db.doc(`pedagogicalAssignments/${targetId}`);
    const target = await transaction.get(targetRef);
    if (!target.exists || target.data().schoolId !== schoolId || target.data().schoolYearId !== schoolYearId) fail("Affectation introuvable.");
    const scope = target.data();
    const teacher = await transaction.get(db.doc(`teachers/${id(scope.teacherId)}`));
    if (!teacher.exists || teacher.data().schoolId !== schoolId || teacher.data().schoolYearId !== schoolYearId || !active(teacher.data())) fail("Enseignant inactif ou hors périmètre.");
    const user = await linkedUser(transaction, db, teacher.data(), schoolId);
    const lock = await transaction.get(db.doc(`pedagogicalAssignmentLocks/${lockId(scope)}`));
    const occupied = body.active && lock.exists && lock.data().assignmentId !== targetId ? await transaction.get(db.doc(`pedagogicalAssignments/${id(lock.data().assignmentId)}`)) : undefined;
    if (occupied && (!occupied.exists || occupied.data().active !== false)) fail("Ce cours est déjà affecté activement à cette classe.");
    transaction.update(targetRef, { active: body.active, updatedAt: new Date().toISOString(), updatedBy: caller.uid });
    if (body.active) transaction.set(db.doc(`pedagogicalAssignmentLocks/${lockId(scope)}`), { id: lockId(scope), schoolId, schoolYearId, subjectId: scope.subjectId, classId: scope.classId, ...(scope.studentGroupKey ? { studentGroupKey: scope.studentGroupKey, courseScope: scope.courseScope, targetOptionIds: scope.targetOptionIds } : {}), teacherId: scope.teacherId, assignmentId: targetId, updatedAt: new Date().toISOString(), updatedBy: caller.uid });
    updateUserGrants(transaction, user, body.active ? [grantKey({ ...scope, id: targetId })] : [], body.active ? [] : [grantKey({ ...scope, id: targetId })]);
    return { active: body.active };
  });
}
