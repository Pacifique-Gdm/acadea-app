import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { guard, services, prepare, retire } from './socialFinanceStagingFixture.mjs';

const origin = 'https://acadea-staging.vercel.app';
const output = 'diagnostics/navigation-staging';
const results = [];
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
const s=services(); let browser, fixture, password;
const check=async(name,run)=>{try{await run();results.push({name,result:'PASS'});}catch(e){results.push({name,result:'FAIL',error:String(e.message).slice(0,800)});process.exitCode=1;}};
try {
  ({m:fixture,password}=await prepare(s,'navigation'));
  browser=await chromium.launch({headless:true});
  for(const role of ['school_admin','secretary','cashier','study_director','discipline_director']) {
    const account=fixture.users.find(u=>u.role===role);
    const context=await browser.newContext({viewport:{width:1365,height:1000},serviceWorkers:'allow'});
    await context.addInitScript(()=>{ window.addEventListener('acadea:offline-context-ready',()=>{window.__recipeOfflineReady=true;}); });
    const page=await context.newPage();page.setDefaultTimeout(30000);
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
        for(const label of [...labels,...labels].filter(t=>!t.includes('Installer'))) {
          const button=nav.getByRole('button',{name:label.trim(),exact:true});
          await button.click();await expect(button).toHaveAttribute('aria-current','page');
        }
        await page.screenshot({path:`${output}/${role}-navigation.png`,fullPage:true});
      });
      if(role==='discipline_director') await check('Présences par classes opérationnelles hébergées',async()=>{
        await page.getByRole('button',{name:'Présence',exact:true}).last().click();
        for(const name of ['1ère Primaire A','1ère Primaire B','2ème Primaire']) await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
        await page.screenshot({path:`${output}/presence.png`,fullPage:true});
      });
      if(['school_admin','secretary'].includes(role)) {
        await check(`Recherche parent ${role}`,async()=>{
          await page.getByRole('button',{name:'Élèves',exact:true}).last().click();
          await page.getByRole('button',{name:'Ajouter un élève',exact:true}).click();
          await page.getByRole('combobox',{name:'Rechercher un parent'}).fill('emilie');
          await expect(page.getByRole('option',{name:/Émilie Parent Fictif/})).toHaveCount(1);
          await page.getByRole('option',{name:/Émilie Parent Fictif/}).click();
          await expect(page.getByRole('button',{name:'Retirer le parent sélectionné'})).toBeVisible();
          await page.screenshot({path:`${output}/${role}-parent.png`,fullPage:true});
          await page.keyboard.press('Escape');
        });
        await check(`Inscription hors réseau et synchronisation ${role}`,async()=>{
          // Wait for the application-owned preparation, never inject a session/cache.
          await expect.poll(()=>page.evaluate(()=>window.__recipeOfflineReady===true),{timeout:60000}).toBe(true);
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
          await page.screenshot({path:`${output}/${role}-offline.png`,fullPage:true});
          await context.setOffline(false);
          await expect.poll(async()=> (await read()).docs.filter(d=>d.data().nom?.startsWith(`LOCAL-${role}-`)).length,{timeout:90000}).toBe(2);
          await page.reload();
          await expect.poll(async()=> (await read()).docs.filter(d=>d.data().nom?.startsWith(`LOCAL-${role}-`)).length).toBe(2);
        });
      }
      if(role==='school_admin') await check('Drawer social — transaction serveur et identifiant conservé',async()=>{
        await context.setOffline(false);await page.goto(origin+'/dashboard');
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
    finally {await context.close();}
  }
} finally {
  if(browser) await browser.close();
  await check('Clôture Auth et établissements fictifs',()=>retire(s));
  await s.close();
  writeFileSync(`${output}/results.json`,JSON.stringify({sha:process.env.ACADEA_EXPECTED_SHA,results},null,2));
  for(const result of results) console.log(JSON.stringify(result));
}
