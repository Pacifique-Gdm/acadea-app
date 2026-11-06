import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
type Harness = { operations: () => Promise<unknown[]>; expire: () => Promise<void>; baseSubscriptions: number };
let server: Server, origin: string;
test.beforeAll(async () => {
  test.setTimeout(120000);
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{OfflineDraftForms}from'./src/components/offline/OfflineDraftForms';
import{ParentSearchPicker}from'./src/components/parents/ParentSearchPicker';
import{rememberOfflineAccess}from'./src/services/offlineAccess';
import{saveOfflineContext,listOfflineOperations}from'./src/services/offlineQueue';
import{useStudyData}from'./src/modules/studies/useStudyData';
const scope={userId:'local-test',schoolId:'s',schoolYearId:'y'};
const mode=new URL(location.href).searchParams.get('mode')||'school_admin';
const references={role:mode,savedAt:new Date().toISOString(),schoolId:'s',schoolYearId:'y',courses:[],existingAttendanceIds:[],
classes:[{id:'base',name:'1ère Primaire',operational:false},{id:'a',name:'1ère Primaire A',parentClassId:'base',operational:true},{id:'old',name:'Archive',operational:false}],
students:[{id:'z',name:'Zola',className:'1ère Primaire',feeTypeIds:['f']},{id:'a',name:'Alice',className:'1ère Primaire',feeTypeIds:['f','f2']}],
fees:[{id:'f',name:'Minerval',amount:100,currency:'USD'},{id:'f',name:'Minerval',amount:100,currency:'USD'},{id:'f2',name:'Minerval',amount:200,currency:'USD'},{id:'other',name:'Autre classe',amount:5,currency:'USD'}]};
window.operations=()=>listOfflineOperations(scope);
window.expire=()=>rememberOfflineAccess({...scope,role:mode,schoolName:'Local',schoolYearName:'Local'},Date.now()-9*3600000);
function Parent(){const[id,setId]=useState();const[parents,setParents]=useState([{id:'p',schoolId:'s',fullName:'Émilie Test',phone:'12345678'},{id:'second',schoolId:'s',fullName:'Basile Test',phone:'87654321'},{id:'q',schoolId:'other',fullName:'Émilie Autre',phone:'99999999'}]);return <><ParentSearchPicker parents={parents} schoolId='s' selectedId={id} onChange={setId}/><button type='button' onClick={()=>setParents([...parents,{id:'late',schoolId:'s',fullName:'Arrivée tardive',phone:'11111111'}])}>Simuler réponse tardive</button><output>{id}</output></>}
const user={id:'u',schoolId:'s',role:'study_director',sectionIds:['Primaire']};
function Study(){const[tab,setTab]=useState('dashboard');const data=useStudyData(user,'s','y',0,tab!=='students');return <><nav>{['dashboard','students','schedules'].map(t=><button onClick={()=>setTab(t)} key={t}>{t}</button>)}</nav><main data-tab={tab}>{tab}</main><output>{data.generationReady?'ready':'loading'}</output></>}
async function start(){if(mode==='parent'){createRoot(document.getElementById('root')).render(<Parent/>);return;}if(mode==='study'){createRoot(document.getElementById('root')).render(<Study/>);return;}
await rememberOfflineAccess({...scope,role:mode,schoolName:'Local',schoolYearName:'Local'});await saveOfflineContext(scope,references);
createRoot(document.getElementById('root')).render(<OfflineDraftForms scope={scope} role={mode}/>);}start();
` }, bundle: true, write: false, jsx: "automatic", format: "iife", define: { "import.meta.env": JSON.stringify({ VITE_APP_ENV:"staging",VITE_FIREBASE_API_KEY:"test",VITE_FIREBASE_AUTH_DOMAIN:"acadea-staging.firebaseapp.com",VITE_FIREBASE_PROJECT_ID:"acadea-staging",VITE_FIREBASE_STORAGE_BUCKET:"acadea-staging.firebasestorage.app",VITE_FIREBASE_MESSAGING_SENDER_ID:"123",VITE_FIREBASE_APP_ID:"1:123:web:test" }) }, plugins:[{ name:"study-listeners-local", setup(b){b.onLoad({filter:/[\\/]modules[\\/]studies[\\/]studyService\.ts$/},()=>({loader:"js",contents:`
export function subscribeToStudyData(input){window.baseSubscriptions=(window.baseSubscriptions||0)+1;for(const key of Object.keys(input))if(key.startsWith('on')&&key!=='onError')input[key]([]);return[()=>{}];}
export function subscribeToStudyStudents(user,s,y,onData){window.late=()=>onData([{id:'stale',schoolId:s,schoolYearId:y,className:'1ère Primaire',section:'Primaire'}]);onData([]);return()=>{};}` }));} }] });
  const cssName=readdirSync('dist/assets').find(x=>x.endsWith('.css'));
  const css=cssName?readFileSync(`dist/assets/${cssName}`,'utf8'):'';
  server=createServer((req,res)=>{const js=req.url==='/app.js';res.setHeader('Content-Type',js?'text/javascript':req.url==='/styles.css'?'text/css':'text/html');res.end(js?bundle.outputFiles[0].text:req.url==='/styles.css'?css:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve)); const address=server.address();if(!address||typeof address==='string')throw Error('Server missing');origin=`http://127.0.0.1:${address.port}`;
});
test.afterAll(()=>new Promise<void>(resolve=>server.close(()=>resolve())));

for(const role of ['school_admin','secretary']) test(`${role}: sauvegarde durable hors réseau, reset et reprise`,async({page,context})=>{
  await page.goto(`${origin}?mode=${role}`);
  await expect(page.getByLabel('Classe préchargée')).toBeVisible();
  await expect(page.getByLabel('Classe préchargée').locator('option')).toHaveCount(2);
  await context.setOffline(true);
  for(const name of ['Premier','Deuxième']){
    await page.getByLabel('Classe préchargée').selectOption('a');
    await page.getByRole('textbox',{name:'Nom',exact:true}).fill(name);
    await page.getByRole('textbox',{name:'Post-nom',exact:true}).fill('Test');
    await page.getByRole('textbox',{name:'Prénom',exact:true}).fill('Local');
    await page.getByLabel('Date de naissance').fill('2016-01-01');
    await page.getByRole('button',{name:'Enregistrer le brouillon local'}).click();
    await expect(page.getByRole('status')).toContainText('Brouillon local enregistré');
    await expect(page.getByRole('textbox',{name:'Nom',exact:true})).toHaveValue('');
    await expect(page.getByLabel('Classe préchargée')).toHaveValue('');
  }
  expect(await page.evaluate(async()=> (await (window as unknown as Harness).operations()).length)).toBe(2);
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByLabel('Classe préchargée')).toBeVisible();
  expect(await page.evaluate(async()=> (await (window as unknown as Harness).operations()).length)).toBe(2);
  await page.getByLabel('Classe préchargée').selectOption('a');
  await page.getByRole('textbox',{name:'Nom',exact:true}).fill('Conservé');
  await page.evaluate(()=> (window as unknown as Harness).expire());
  await page.getByRole('button',{name:'Enregistrer le brouillon local'}).click();
  await expect(page.getByRole('status')).toContainText('Session locale');
  await expect(page.getByRole('textbox',{name:'Nom',exact:true})).toHaveValue('Conservé');
});
test('caissier: ordre et obligations propres à chaque élève sans réseau',async({page,context})=>{
 await page.goto(`${origin}?mode=cashier`);await expect(page.getByLabel('Élève',{exact:true})).toBeVisible();await context.setOffline(true);
 expect(await page.getByLabel('Élève',{exact:true}).locator('option').allTextContents()).toEqual(['Choisir un élève','Alice','Zola']);
 await page.getByLabel('Élève',{exact:true}).selectOption('a');await expect(page.getByLabel('Type de frais').locator('option')).toHaveCount(3);
 await page.getByLabel('Type de frais').selectOption('f2');await page.getByLabel('Élève',{exact:true}).selectOption('z');
 await expect(page.getByLabel('Type de frais')).toHaveValue('');await expect(page.getByLabel('Type de frais').locator('option')).toHaveCount(2);
});
test('parent: suggestions accentuées, périmètre, sélection et retrait',async({page})=>{
 await page.goto(`${origin}?mode=parent`);await page.getByRole('combobox').fill('emil');await expect(page.getByRole('option')).toHaveCount(1);
 await page.getByRole('option').click();await expect(page.locator('output')).toHaveText('p');await expect(page.locator('select')).toHaveCount(0);
 await expect(page.getByRole('combobox')).toHaveCount(0);await expect(page.getByRole('listbox')).toHaveCount(0);
 await expect(page.getByLabel('Parent sélectionné',{exact:true})).toContainText('Émilie Test');
 await page.getByRole('button',{name:'Simuler réponse tardive'}).click();await expect(page.getByRole('combobox')).toHaveCount(0);
 await page.getByRole('button',{name:'Retirer le parent sélectionné'}).click();await expect(page.locator('output')).toHaveText('');
 await expect(page.getByRole('combobox')).toBeVisible();await expect(page.getByLabel('Parent sélectionné',{exact:true})).toHaveCount(0);
 await page.getByRole('combobox').fill('basile');await page.getByRole('option').click();await expect(page.locator('output')).toHaveText('second');
 await expect(page.getByRole('combobox')).toHaveCount(0);
 await page.getByRole('button',{name:'Retirer le parent sélectionné'}).click();
 await page.getByRole('combobox').fill('absent');await expect(page.getByRole('status').filter({hasText:'Aucun parent trouvé.'})).toHaveText('Aucun parent trouvé.');
});
test('navigation pédagogique: pas de réabonnement global ni de retour au dashboard',async({page})=>{
 await page.goto(`${origin}?mode=study`);await expect(page.locator('output')).toHaveText('ready');
 for(const tab of ['students','schedules','students','schedules']){await page.getByRole('button',{name:tab,exact:true}).click();await expect(page.locator('main')).toHaveText(tab);await expect(page.locator('output')).toHaveText('ready');}
 expect(await page.evaluate(()=> (window as unknown as Harness).baseSubscriptions)).toBe(1);
});
