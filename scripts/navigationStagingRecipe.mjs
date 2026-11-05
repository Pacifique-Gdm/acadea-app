import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect as playwrightExpect } from '@playwright/test';
import { guard, services, prepare, retire } from './socialFinanceStagingFixture.mjs';

const origin = 'https://acadea-staging.vercel.app';
const output = 'diagnostics/navigation-staging';
const results = [];
const expect=playwrightExpect.configure({timeout:30000});
const firebaseAuthStoreCount=page=>page.evaluate(async()=>{
  const databases=await indexedDB.databases();
  if(!databases.some(item=>item.name==='firebaseLocalStorageDb'))return 0;
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open('firebaseLocalStorageDb');
    open.onerror=()=>reject(new Error('Auth IndexedDB unavailable'));
    open.onsuccess=()=>{
      const database=open.result;
      if(!database.objectStoreNames.contains('firebaseLocalStorage')){database.close();resolve(0);return;}
      const count=database.transaction('firebaseLocalStorage','readonly').objectStore('firebaseLocalStorage').count();
      count.onsuccess=()=>{database.close();resolve(count.result);};
      count.onerror=()=>{database.close();reject(new Error('Auth IndexedDB count unavailable'));};
    };
  });
});
const offlineAccessStoreCount=page=>page.evaluate(async()=>{
  const databases=await indexedDB.databases();
  if(!databases.some(item=>item.name==='acadea-offline-access-v1'))return 0;
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open('acadea-offline-access-v1');
    open.onerror=()=>reject(new Error('Offline access IndexedDB unavailable'));
    open.onsuccess=()=>{
      const database=open.result;
      if(!database.objectStoreNames.contains('access')){database.close();resolve(0);return;}
      const count=database.transaction('access','readonly').objectStore('access').count();
      count.onsuccess=()=>{database.close();resolve(count.result);};
      count.onerror=()=>{database.close();reject(new Error('Offline access record unavailable'));};
    };
  });
});
const offlineOperationMetadata=(page,scope)=>page.evaluate(async scope=>{
  const partition=JSON.stringify([scope.userId,scope.schoolId,scope.schoolYearId]);
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open('acadea-offline-operations-v1');
    open.onerror=()=>reject(new Error('Offline operations IndexedDB unavailable'));
    open.onsuccess=()=>{
      const database=open.result;
      if(!database.objectStoreNames.contains('operations')){database.close();resolve([]);return;}
      const rows=database.transaction('operations','readonly').objectStore('operations').index('partition').getAll(partition);
      rows.onsuccess=()=>{database.close();resolve(rows.result.map(({id,kind,status,attempts})=>({id,kind,status,attempts})));};
      rows.onerror=()=>{database.close();reject(new Error('Offline operations metadata unavailable'));};
    };
  });
},scope);
const responsive=async(page,label)=>{
  for(const width of [320,360,375,390,414,768,1024,1280,1440]){
    await page.setViewportSize({width,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Débordement horizontal ${label}, largeur ${width}`);
    await page.screenshot({path:`${output}/${label}-${width}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1365,height:1000});
};
guard();
assert.match(process.env.ACADEA_EXPECTED_SHA || '', /^[a-f0-9]{40}$/);
assert.ok(process.env.STAGING_FIREBASE_API_KEY);
const version = await (await fetch(origin+'/version.json')).json();
assert.equal(version.version,process.env.ACADEA_EXPECTED_SHA);
const html = await (await fetch(origin)).text();
const asset = html.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
assert.ok(asset);
const bundle = await (await fetch(origin+asset)).text();
assert.ok(bundle.includes('acadea-staging') && !bundle.includes('acadea-production.firebaseapp.com'));
mkdirSync(output,{recursive:true});
const s=services(); let browser, fixture, password, activePage;
const check=async(name,run)=>{try{await run();results.push({name,result:'PASS'});}catch(e){
  if(activePage&&!activePage.isClosed())await activePage.screenshot({path:`${output}/failure-${results.length}.png`,fullPage:true}).catch(()=>{});
  results.push({name,result:'FAIL',error:String(e.message).slice(0,800)});process.exitCode=1;}};
try {
  ({m:fixture,password}=await prepare(s,'navigation'));
  browser=await chromium.launch({headless:true});
  for(const role of ['school_admin','secretary','cashier','study_director','discipline_director','coordination_admin','sub_coordination_admin']) {
    const account=fixture.users.find(u=>u.role===role);
    const context=await browser.newContext({viewport:{width:1365,height:1000},serviceWorkers:'allow'});
    await context.addInitScript(()=>{ window.addEventListener('acadea:offline-context-ready',()=>{window.__recipeOfflineReady=true;}); });
    const page=await context.newPage();page.setDefaultTimeout(30000);
    const authEvents=[];
    page.on('console',event=>{
      const message=event.text();
      if(message.includes('Profil utilisateur introuvable'))authEvents.push('profile-not-found');
      else if(message.includes('Session Firebase invalide'))authEvents.push('session-invalid');
      else if(message.includes('Chargement Firestore indisponible'))authEvents.push('firestore-load-unavailable');
    });
    activePage=page;
    try {
      await page.goto(origin+'/login');
      await page.getByPlaceholder('email@ecole.com').fill(account.email);
      await page.getByPlaceholder('Votre mot de passe').fill(password);
      await page.getByRole('button',{name:'Se connecter',exact:true}).click();
      await expect(page.getByRole('button',{name:'Menu',exact:true}).last()).toBeVisible({timeout:60000});
      results.push({name:`Authentification ${role}`,result:'PASS'});
      await check(`Navigation ${role}`,async()=>{
        const nav=page.locator('nav.mobile-bottom-navigation');
        const labels=await nav.locator('button').allTextContents();
        const timings=[];
        for(const label of [...labels,...labels].filter(t=>!t.includes('Installer'))) {
          const button=nav.getByRole('button',{name:label.trim(),exact:true});
          const started=Date.now();
          await button.click();await expect(button).toHaveAttribute('aria-current','page');
          timings.push(Date.now()-started);
        }
        results.push({name:`Navigation ${role} — clic vers indicateur actif, sans référence avant`,result:'MEASURED',milliseconds:timings});
        await page.screenshot({path:`${output}/${role}-navigation.png`,fullPage:true});
      });
      if(role==='discipline_director') await check('Présences par classes opérationnelles hébergées',async()=>{
        const started=Date.now();
        await page.getByRole('button',{name:'Présence',exact:true}).last().click();
        for(const name of ['1ère Primaire A','1ère Primaire B','2ème Primaire']) await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
        results.push({name:'Temps d’ouverture Présences (mesure hébergée, sans référence avant)',milliseconds:Date.now()-started,result:'MEASURED'});
        await page.screenshot({path:`${output}/presence.png`,fullPage:true});
      });
      if(role==='cashier')await check('Caissier hors réseau : élèves triés et obligations sans doublons',async()=>{
        await expect.poll(()=>page.evaluate(()=>window.__recipeOfflineReady===true),{timeout:60000}).toBe(true);
        await expect.poll(()=>offlineAccessStoreCount(page),{timeout:60000}).toBe(1);
        await context.setOffline(true);
        await page.getByRole('button',{name:'Voir les opérations'}).click();
        const form=page.getByRole('region',{name:'État des opérations hors connexion'});
        await expect.poll(()=>form.getByLabel('Élève',{exact:true}).locator('option').count()).toBeGreaterThanOrEqual(3);
        const names=(await form.getByLabel('Élève',{exact:true}).locator('option').allTextContents()).slice(1);
        assert.ok(names.length>=2);assert.deepEqual(names,[...names].sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base',numeric:true})));
        await form.getByLabel('Élève',{exact:true}).selectOption(fixture.student);
        await expect(form.getByLabel('Type de frais').locator(`option[value="${fixture.fee}"]`)).toHaveCount(1);
        const ids=await form.getByLabel('Type de frais').locator('option').evaluateAll(nodes=>nodes.map(n=>n.value).filter(Boolean));
        assert.ok(ids.includes(fixture.fee));assert.equal(ids.length,new Set(ids).size);
        await page.screenshot({path:`${output}/cashier-offline.png`,fullPage:true});
        await context.setOffline(false);
      });
      if(['school_admin','secretary'].includes(role)) {
        await check(`Recherche parent ${role}`,async()=>{
          await page.getByRole('button',{name:'Élèves',exact:true}).last().click();
          await page.getByRole('button',{name:'Ajouter un élève',exact:true}).click();
          await page.getByRole('combobox',{name:'Rechercher un parent'}).fill('emilie');
          await expect(page.getByRole('combobox',{name:'Rechercher un parent'})).toHaveValue('emilie');
          await expect(page.getByRole('option',{name:/Émilie Parent Fictif/})).toHaveCount(1);
          await page.getByRole('option',{name:/Émilie Parent Fictif/}).click();
          await expect(page.getByRole('button',{name:'Retirer le parent sélectionné'})).toBeVisible();
          await page.screenshot({path:`${output}/${role}-parent.png`,fullPage:true});
          if(role==='school_admin')await check('Responsive formulaire parent — neuf largeurs Chromium',()=>responsive(page,'parent'));
          await page.keyboard.press('Escape');
        });
        await check(`Inscription hors réseau et synchronisation ${role}`,async()=>{
          // Wait for the application-owned preparation, never inject a session/cache.
          await expect.poll(()=>page.evaluate(()=>window.__recipeOfflineReady===true),{timeout:60000}).toBe(true);
          await expect.poll(()=>offlineAccessStoreCount(page),{timeout:60000}).toBe(1);
          await expect.poll(()=>page.evaluate(()=>Boolean(navigator.serviceWorker.controller)),{timeout:60000}).toBe(true);
          await context.setOffline(true);
          await page.getByRole('button',{name:'Voir les opérations'}).click();
          const form=page.getByRole('region',{name:'État des opérations hors connexion'});
          await expect(form.getByLabel('Classe préchargée')).toBeVisible();
          const values=await form.getByLabel('Classe préchargée').locator('option').evaluateAll(nodes=>nodes.map(n=>n.value));
          assert.ok(!values.includes(fixture.tag+'-class'));assert.ok(values.includes(fixture.tag+'-class-A'));
          for(const index of [1,2]) {
            await form.getByLabel('Classe préchargée').selectOption(fixture.tag+'-class-A');
            await form.getByRole('textbox',{name:'Nom',exact:true}).fill(`LOCAL-${role}-${index}`);
            await form.getByRole('textbox',{name:'Post-nom',exact:true}).fill('FICTIF');
            await form.getByRole('textbox',{name:'Prénom',exact:true}).fill('Recette');
            await form.getByLabel('Date de naissance').fill('2016-01-01');
            await form.getByRole('button',{name:'Enregistrer le brouillon local'}).click();
            await expect(form.getByRole('textbox',{name:'Nom',exact:true})).toHaveValue('');
          }
          const read=()=>s.db.collection('students').where('schoolId','==',fixture.schools[0]).get();
          const initial=await read();assert.ok(!initial.docs.some(d=>d.data().nom===`LOCAL-${role}-1`));
          const scope={userId:account.uid,schoolId:fixture.schools[0],schoolYearId:fixture.year};
          const pending=(await offlineOperationMetadata(page,scope)).filter(row=>row.kind==='student_enrollment');
          assert.equal(pending.length,2);
          assert.ok(pending.every(row=>row.status==='LOCAL_PENDING'));
          assert.equal(new Set(pending.map(row=>row.id)).size,2);
          await page.screenshot({path:`${output}/${role}-offline.png`,fullPage:true});
          const beforeReloadAuthRecords=await firebaseAuthStoreCount(page);
          await page.reload();
          await expect(page.getByRole('heading',{name:'Acadéa hors connexion'})).toBeVisible();
          await expect(page.getByRole('region',{name:'État des opérations hors connexion'}).getByRole('listitem').filter({hasText:"Inscription d'élève"})).toHaveCount(2);
          assert.deepEqual((await offlineOperationMetadata(page,scope)).filter(row=>row.kind==='student_enrollment').map(row=>row.id).sort(),pending.map(row=>row.id).sort());
          const offlineAuthRecords=await firebaseAuthStoreCount(page);
          await context.setOffline(false);
          const menu=page.getByRole('button',{name:'Menu',exact:true}).last();
          const login=page.getByPlaceholder('email@ecole.com');
          await expect.poll(async()=>await menu.isVisible()?'authenticated':await login.isVisible()?'login':'restoring',{timeout:60000}).not.toBe('restoring');
          const promptedForLogin=await login.isVisible();
          const onlineAuthRecords=await firebaseAuthStoreCount(page);
          results.push({name:`Restauration Auth ${role}`,result:'OBSERVED',state:promptedForLogin?'login-required':'restored',
            authStoreCounts:[beforeReloadAuthRecords,offlineAuthRecords,onlineAuthRecords],authEvents:[...authEvents]});
          assert.equal(promptedForLogin,false,'La session doit être restaurée sans nouvelle connexion.');
          assert.deepEqual([beforeReloadAuthRecords,offlineAuthRecords,onlineAuthRecords],[1,1,1]);
          await expect(menu).toBeVisible({timeout:60000});
          await expect.poll(async()=>{
            const rows=await offlineOperationMetadata(page,scope);
            return rows.filter(row=>pending.some(item=>item.id===row.id)&&row.status==='SERVER_CONFIRMED').length;
          },{timeout:90000}).toBe(2);
          await expect.poll(async()=> (await read()).docs.filter(d=>d.data().nom?.startsWith(`LOCAL-${role}-`)).length,{timeout:90000}).toBe(2);
          const created=(await read()).docs.filter(d=>d.data().nom?.startsWith(`LOCAL-${role}-`));
          assert.deepEqual(created.map(d=>d.data().nom).sort(),[`LOCAL-${role}-1`,`LOCAL-${role}-2`]);
          assert.equal(new Set(created.map(d=>d.id)).size,2);
          for(const doc of created){
            assert.equal(doc.data().schoolId,fixture.schools[0]);
            assert.equal(doc.data().schoolYearId,fixture.year);
            assert.equal(doc.data().classId,fixture.tag+'-class');
            assert.equal(doc.data().subClassId,fixture.tag+'-class-A');
          }
          for(const operation of pending){
            const student=await s.db.doc(`students/student-${operation.id}`).get();
            assert.ok(student.exists);
            assert.equal(student.data().schoolId,scope.schoolId);
            assert.equal(student.data().schoolYearId,scope.schoolYearId);
            const receiptId=createHash('sha256').update(`${account.uid}\0${scope.schoolId}\0${operation.id}`).digest('hex');
            const receipt=await s.db.doc(`offlineOperationReceipts/${receiptId}`).get();
            assert.ok(receipt.exists);
            assert.equal(receipt.data().actorId,account.uid);
            assert.equal(receipt.data().schoolId,scope.schoolId);
            assert.equal(receipt.data().schoolYearId,scope.schoolYearId);
            assert.equal(receipt.data().operationId,operation.id);
            assert.equal(receipt.data().studentId,student.id);
          }
          await page.reload();
          assert.ok((await offlineOperationMetadata(page,scope)).filter(row=>pending.some(item=>item.id===row.id)&&row.status==='SERVER_CONFIRMED').length===2);
          await expect.poll(async()=> (await read()).docs.filter(d=>d.data().nom?.startsWith(`LOCAL-${role}-`)).length).toBe(2);
          results.push({name:`Preuve opérations et reçus ${role}`,result:'PASS',operations:2,receipts:2});
        });
      }
      if(role==='school_admin') await check('Drawer social — transaction serveur et identifiant conservé',async()=>{
        await context.setOffline(false);
        await expect(page.getByRole('button',{name:'Menu',exact:true}).last()).toBeVisible({timeout:60000});
        await page.getByRole('button',{name:'Menu',exact:true}).last().click();
        await page.getByRole('button',{name:/Cas sociaux et prises en charge/}).click();
        await page.getByRole('tab',{name:'Nouveau',exact:true}).click();
        await page.getByRole('combobox',{name:'Rechercher un élève'}).fill('SOCIAL');
        await page.getByRole('option',{name:/E2E-0/}).click();
        await page.getByRole('checkbox').check();
        await page.getByLabel('Minerval — Montant').fill('100');
        await page.getByLabel('Motif de l’avantage *').selectOption('social');
        await page.getByRole('button',{name:'Confirmer la prise en charge'}).click();
        await expect(page.getByRole('status').filter({hasText:'confirmée'})).toBeVisible();
        const before=await s.db.collection('socialSupportDecisions').where('schoolId','==',fixture.schools[0]).get();
        assert.equal(before.size,1);
        await page.getByRole('button',{name:'Modifier',exact:true}).click();
        const editor=page.getByRole('dialog',{name:'Modifier la décision sociale'});
        await expect(page.getByRole('tab',{name:'Nouveau',exact:true})).toHaveAttribute('aria-selected','false');
        await check('Responsive drawer social — neuf largeurs Chromium',()=>responsive(page,'social-editor'));
        await editor.getByLabel('Minerval — Montant').fill('80');
        await editor.getByRole('button',{name:'Modifier',exact:true}).click();
        await editor.getByLabel('Saisissez JE CONFIRME LA MODIFICATION').fill('incorrect');
        await expect(editor.getByRole('button',{name:'Confirmer la modification'})).toBeDisabled();
        await editor.getByLabel('Saisissez JE CONFIRME LA MODIFICATION').fill('JE CONFIRME LA MODIFICATION');
        await editor.getByRole('button',{name:'Confirmer la modification'}).click();
        await expect(editor).toHaveCount(0);
        const after=await before.docs[0].ref.get();assert.equal(after.id,before.docs[0].id);
        assert.equal(after.data().version,before.docs[0].data().version+1);
        assert.equal(after.data().lines[fixture.fee].reductionMinor,8000);
        await page.screenshot({path:`${output}/social-modified.png`,fullPage:true});
      });
    } catch(e) {results.push({name:`Parcours ${role}`,result:'FAIL',error:String(e.message).slice(0,800)});process.exitCode=1;}
    finally {await context.setOffline(false);await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${output}/${role}-mobile.png`,fullPage:true}).catch(()=>{});await context.close();activePage=undefined;}
  }
} finally {
  if(browser) await browser.close();
  await check('Clôture Auth et établissements fictifs',()=>retire(s));
  await s.close();
  writeFileSync(`${output}/results.json`,JSON.stringify({sha:process.env.ACADEA_EXPECTED_SHA,results},null,2));
  for(const result of results) console.log(JSON.stringify(result));
}
