import { readFileSync, readdirSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
let server: Server, origin: string, bundle: string;
async function selectPupil(page: Page) {
  await page.getByRole("combobox", { name: "Rechercher un élève" }).fill("Local");
  await page.getByRole("option", { name: /LOCAL-1/ }).click();
}
test.beforeAll(async () => {
  test.setTimeout(120000);
  const fixture = `const year={id:'y',schoolId:'s',name:'2098–2099',status:'active',endsAt:'2099-06-30',currency:'USD'};
 const school={id:'s',name:'École de test local',activeSchoolYearId:'y',currency:'USD',address:'Adresse de test',phone:'',email:'',logoUrl:''};
 const student={id:'p',schoolId:'s',schoolYearId:'y',nom:'Élève',postnom:'Local',prenom:'Test',matricule:'LOCAL-1',className:'1ère Primaire',status:'ACTIVE'};
 const fee={id:'f',schoolId:'s',schoolYearId:'y',name:'Minerval',amount:300};
 const decision={id:'decision-local',schoolId:'s',schoolYearId:'y',studentId:'p',studentName:'Élève Local Test',matricule:'LOCAL-1',className:'1ère Primaire',reason:'social',nature:'fixed',personnelId:null,thirdPartyName:'',observation:'Observation privée locale',lines:{f:{feeName:'Minerval',officialMinor:30000,value:100,reductionMinor:10000,commitmentMinor:0}},status:'active',version:1,validUntil:'2099-06-30',createdAt:'2026-10-30T00:00:00Z',updatedAt:'2026-10-30T00:00:00Z',currency:'USD',history:[]};
 decision.history=[{id:'event-local',action:'create',at:decision.createdAt,actorName:'Admin test',before:null,after:{...decision,history:[]}}];
 const secondSchool={...school,id:'school-b',name:'École B',activeSchoolYearId:'year-b'};const secondYear={...year,id:'year-b',schoolId:'school-b'};
 const data={users:[],schools:[school,secondSchool],schoolYears:[year,secondYear],students:[student],feeTypes:[fee],payments:[],parents:[],expenses:[],auditLogs:[],messages:[],notifications:[],valves:[]};
 if(new URL(location.href).searchParams.has('students'))data.students.push({...student,id:'p2',nom:'Marie',matricule:'LOCAL-2'});`;
  const result = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{SocialSupportDrawer}from'./src/modules/menu/SocialSupportDrawer';${fixture}
 if(new URL(location.href).searchParams.has('capped')){student.financialSupport={[decision.id]:{id:decision.id,schoolYearId:'y',thirdPartyName:'',lines:decision.lines}};data.payments.push({id:'paid',schoolId:'s',schoolYearId:'y',studentId:'p',feeTypeId:'f',amount:50});}window.__data=data;window.__decision=decision;const role=new URL(location.href).searchParams.get('role')||'school_admin';const multi=new URL(location.href).searchParams.has('multi');createRoot(document.getElementById('root')).render(<SocialSupportDrawer user={{id:'a',schoolId:'s',role}} school={school} scopeSchools={multi?[school,secondSchool]:undefined} years={multi?[year,secondYear]:[year]} data={data} readOnly={role==='coordination_admin'||role==='sub_coordination_admin'}/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    jsx: "automatic",
    bundle: true,
    write: false,
    format: "iife",
    define: { "import.meta.env": JSON.stringify({ VITE_APP_ENV: "staging", VITE_FIREBASE_API_KEY: "test-public-api-key", VITE_FIREBASE_AUTH_DOMAIN: "acadea-staging.firebaseapp.com", VITE_FIREBASE_PROJECT_ID: "acadea-staging", VITE_FIREBASE_STORAGE_BUCKET: "acadea-staging.firebasestorage.app", VITE_FIREBASE_MESSAGING_SENDER_ID: "123", VITE_FIREBASE_APP_ID: "1:123:web:test" }) },
    plugins: [
      {
        name: "local-only-services",
        setup(builder) {
          builder.onLoad({ filter: /[\\/]services[\\/]socialSupport\.ts$/ }, () => ({
            contents: `export async function reconcileSupport(){}export async function loadSupportPersonnel(){return [];}export function subscribeSupport(id,onData){onData(Array.from({length:Number(new URL(location.href).searchParams.get('rows')||1)},(_,i)=>({...window.__decision,id:'decision-'+id+'-'+i,schoolId:id,schoolYearId:id==='s'?'y':'year-b',studentName:window.__decision.studentName+' '+i,history:window.__decision.history.map(e=>({...e,id:'event-'+id+'-'+i}))})));return()=>{};}export function subscribeSupportContext(id,onData){for(const name of ['students','payments','feeTypes'])onData({[name]:window.__data[name]});return()=>{};}export async function saveSupport(input){window.__submitted=input;(window.__requests??=[]).push(input);if(input.studentId==='p2'&&new URL(location.href).searchParams.has('partial')&&!window.__failedOnce){window.__failedOnce=true;throw Error('Refus fictif individuel');}return {...window.__decision,id:input.decisionId||'decision-'+input.studentId,studentId:input.studentId,reason:input.reason};}`,
            loader: "js",
          }));
          builder.onLoad({ filter: /[\\/]services[\\/]personnel\.ts$/ }, () => ({
            contents: `export const personnelRoleLabels={teacher:'Enseignant'};export const isServicePersonnel=p=>p.kind==='service';export function subscribeToSchoolPersonnel({onData}){onData([{id:'staff',name:'Personnel test',role:'teacher'}]);return()=>{};}export function subscribeToServicePersonnel({onData}){onData([]);return()=>{};}`,
            loader: "js",
          }));
        },
      },
    ],
  });
  bundle = result.outputFiles[0].text;
  const cssFile=readdirSync('dist/assets').find(name=>name.endsWith('.css'));
  const css=cssFile?readFileSync(`dist/assets/${cssFile}`,'utf8'):'';
  server = createServer((req, res) => {
    if(req.url==='/styles.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
    res.setHeader(
      "Content-Type",
      req.url === "/app.js" ? "text/javascript" : "text/html",
    );
    res.end(
      req.url === "/app.js"
        ? bundle
        : '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>',
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Serveur local indisponible");
  origin = `http://127.0.0.1:${address.port}`;
});
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort("blockedbyclient"));
  page.on("pageerror", (error) => console.error("Local UI:", error.message));
});
for (const role of ["cashier", "secretary"]) {
  test(`${role} peut préparer une décision avec le même plafond`, async ({ page }) => {
    await page.goto(`${origin}/?role=${role}`);
    await page.getByRole("tab", { name: "Nouveau" }).click();
    await selectPupil(page);
    await page.getByRole("checkbox").check();
    await page.getByLabel("Minerval — Montant").fill("100");
    await page.getByLabel("Motif de l’avantage *").selectOption("social");
    await expect(page.getByRole("button", { name: "Confirmer la prise en charge" })).toBeEnabled();
    await page.getByRole("button", { name: "Confirmer la prise en charge" }).click();
    await expect(page.getByRole("status").filter({ hasText: "confirmée" })).toBeVisible();
  });
}
for (const role of ["coordination_admin", "sub_coordination_admin"]) {
  test(`${role} ne dispose que de la consultation et de l'export`, async ({ page }) => {
    await page.goto(`${origin}/?role=${role}`);
    await expect(page.getByRole("tab", { name: "Bénéficiaires" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Historique" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Nouveau" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Modifier" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Annuler la décision" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "PDF", exact: true })).toBeEnabled();
  });
}
test("la consultation multi-établissements respecte le filtre école", async ({ page }) => {
  await page.goto(`${origin}/?role=sub_coordination_admin&multi=1`);
  const details = page.locator("article");
  await expect(details).toHaveCount(2);
  await expect(page.getByText(/École B — Élève Local Test/)).toBeVisible();
  await page.getByLabel("Filtres", { exact: true }).selectOption("school");
  await page.getByLabel("Établissement", { exact: true }).selectOption("school-b");
  await expect(details).toHaveCount(1);
  await expect(page.getByText(/École B — Élève Local Test/)).toBeVisible();
  await expect(page.getByText(/École de test local — Élève Local Test/)).toHaveCount(0);
  await page.getByLabel("Établissement", { exact: true }).selectOption("s");
  await expect(details).toHaveCount(1);
  await expect(page.getByText(/École de test local — Élève Local Test/)).toBeVisible();
});
test.afterAll(async () => { if (server) await new Promise<void>((r) => server.close(() => r())); });
test("validation des motifs, montants et changement de motif sans Firebase", async ({
  page,
}) => {
  await page.goto(origin);
  await page.getByRole("tab", { name: "Nouveau" }).click();
  await expect(page.getByLabel("Motif de l’avantage *")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Confirmer la prise en charge" }),
  ).toBeDisabled();
  await selectPupil(page);
  await page.getByRole("checkbox").check();
  await page.getByLabel("Minerval — Montant").fill("100");
  await page.getByLabel("Motif de l’avantage *").selectOption("personnel");
  await expect(
    page.getByRole("button", { name: "Confirmer la prise en charge" }),
  ).toBeDisabled();
  await page.getByLabel("Personnel concerné *").selectOption("staff");
  await expect(
    page.getByRole("button", { name: "Confirmer la prise en charge" }),
  ).toBeEnabled();
  await expect(page.getByLabel("Motif de l’avantage *").locator('option[value="third-party"]')).toHaveCount(0);
  await page.getByLabel("Motif de l’avantage *").selectOption("direction");
  await page.getByLabel("Motif de l’avantage *").selectOption("personnel");
  await expect(page.getByLabel("Personnel concerné *")).toHaveValue("");
  await page.getByLabel("Motif de l’avantage *").selectOption("social");
  await page.getByLabel("Nature de l’avantage").selectOption("percent");
  const percent = page.getByLabel("Minerval — Pourcentage entier");
  await percent.fill("12.5");
  await expect(percent).toHaveValue("");
  await percent.fill("25");
  await expect(
    page.getByText("Valable jusqu’au : Clôture de l'année active"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Confirmer la prise en charge" })
    .click();
  await expect(page.getByRole("status").filter({ hasText: "confirmée" })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __submitted: { personnelId: string } })
          .__submitted.personnelId,
    ),
  ).toBe("");
});
for (const tab of ["Bénéficiaires", "Historique"])
  test(`PDF véritable et filtre — ${tab}`, async ({ page }) => {
    await page.addInitScript(() => {
      const original = URL.createObjectURL;
      URL.createObjectURL = function (blob) {
        if (blob instanceof Blob && blob.type === "application/pdf") {
          void blob.text().then((text) => {
            (window as unknown as { __pdf: string }).__pdf = text;
          });
        }
        return original(blob);
      };
    });
    await page.goto(origin);
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.getByRole("button", { name: "PDF", exact: true }).click();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as unknown as { __pdf?: string }).__pdf?.slice(0, 5),
          ),
        { timeout: 30000 },
      )
      .toBe("%PDF-");
    await page.getByLabel("Rechercher les décisions").fill("introuvable");
    await expect(
      page.getByText("Aucun résultat.", { exact: true }),
    ).toBeVisible();
  });

test('export multipage et disposition mobile',async({page})=>{
 test.setTimeout(60000);
 await page.addInitScript(()=>{const original=URL.createObjectURL;URL.createObjectURL=function(blob){if(blob instanceof Blob&&blob.type==='application/pdf')void blob.text().then(text=>{(window as unknown as {__pdf:string}).__pdf=text;});return original(blob);};});
 await page.setViewportSize({width:390,height:844});await page.goto(`${origin}?rows=35`);
 const search=page.getByLabel('Rechercher les décisions'),button=page.getByRole('button',{name:'PDF',exact:true});
 const a=await search.boundingBox(),b=await button.boundingBox();expect(a).not.toBeNull();expect(b).not.toBeNull();expect(b!.x).toBeGreaterThanOrEqual(a!.x+a!.width);expect(b!.x+b!.width).toBeLessThanOrEqual(391);
 await button.click();await expect.poll(()=>page.evaluate(()=>((window as unknown as {__pdf?:string}).__pdf?.match(/\/Type \/Page\b/g)||[]).length),{timeout:45000}).toBeGreaterThan(1);
});

test('plafond visible et message immédiat pour montant, pourcentage et exonération',async({page})=>{
 await page.goto(`${origin}?capped=1`);
 await page.getByRole('tab',{name:'Nouveau'}).click();
 await selectPupil(page);
 await expect(page.getByText(/Montant maximal de réduction :.*150/)).toBeVisible();
 await page.getByRole('checkbox').check();
 await page.getByLabel('Motif de l’avantage *').selectOption('social');
 const fixed=page.getByLabel('Minerval — Montant');await fixed.fill('151');
 const exact='Réduction non autorisée. Le montant demandé dépasse le plafond applicable à ce frais. Le montant maximal pouvant être accordé est de 150.00 USD, compte tenu des réductions et des paiements déjà enregistrés. Veuillez ajuster le montant pour poursuivre.';
 await expect(page.getByRole('alert')).toHaveText(exact);
 await expect(page.getByRole('button',{name:'Confirmer la prise en charge'})).toBeDisabled();
 await fixed.fill('150');await expect(page.getByRole('button',{name:'Confirmer la prise en charge'})).toBeEnabled();
 await page.getByLabel('Nature de l’avantage').selectOption('percent');
 await page.getByLabel('Minerval — Pourcentage entier').fill('100');
 await expect(page.getByRole('alert')).toHaveText(exact);
 await page.getByLabel('Nature de l’avantage').selectOption('full');
 await expect(page.getByRole('alert')).toHaveText(exact);
});

test("modification : confirmation exacte avant toute écriture du composant", async ({ page }) => {
  await page.goto(origin);
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { __submitted?: unknown }).__submitted)).toBeUndefined();
  const confirm = page.getByRole("button", { name: "Confirmer la modification", exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Saisissez JE CONFIRME LA MODIFICATION").fill("JE CONFIRME");
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Saisissez JE CONFIRME LA MODIFICATION").fill("JE CONFIRME LA MODIFICATION");
  await confirm.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __submitted?: { confirmation?: string } }).__submitted?.confirmation)).toBe("JE CONFIRME LA MODIFICATION");
});

test("sélection multiple persistante, sans doublon, avec retrait", async ({ page }) => {
  await page.goto(`${origin}?students=2`);
  await page.getByRole("tab", { name: "Nouveau" }).click();
  await selectPupil(page);
  await page.getByRole("option", { name: /LOCAL-1/ }).click();
  await expect(page.getByText("1 élève(s) sélectionné(s)", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Rechercher un élève" }).fill("Marie");
  await page.getByRole("option", { name: /LOCAL-2/ }).click();
  await expect(page.getByText("2 élève(s) sélectionné(s)", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Marie.*×/ }).click();
  await expect(page.getByText("1 élève(s) sélectionné(s)", { exact: true })).toBeVisible();
});

test("création groupée : échec individuel visible et clés de réessai conservées", async ({ page }) => {
  await page.goto(`${origin}?students=2&partial=1`);
  await page.getByRole("tab", { name: "Nouveau" }).click();
  await selectPupil(page);
  await page.getByRole("option", { name: /LOCAL-2/ }).click();
  await page.getByRole("checkbox").check();
  await page.getByLabel("Minerval — Montant").fill("100");
  await page.getByLabel("Motif de l’avantage *").selectOption("social");
  await page.getByRole("button", { name: "Confirmer la prise en charge" }).click();
  await expect(page.getByRole("alert")).toContainText("Refus fictif individuel");
  await expect(page.getByText("1 décision(s) confirmée(s) par le serveur.")).toBeVisible();
  await page.getByRole("button", { name: "Confirmer la prise en charge" }).click();
  await expect(page.getByText("2 décision(s) confirmée(s) par le serveur.")).toBeVisible();
  const requests = await page.evaluate(() => (window as unknown as { __requests: { studentId: string; clientRequestId: string }[] }).__requests);
  expect(requests.map((row) => row.studentId)).toEqual(["p", "p2", "p", "p2"]);
  expect(requests[0].clientRequestId).toBe(requests[2].clientRequestId);
  expect(requests[1].clientRequestId).toBe(requests[3].clientRequestId);
  expect(requests[0].clientRequestId).not.toBe(requests[1].clientRequestId);
});

for (const width of [320, 360, 375, 390, 414, 768, 1024, 1280, 1440]) {
  test(`barre sociale et filtres sans débordement à ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    const tabs = page.getByRole("tab");
    const boxes = await Promise.all([0, 1, 2].map((index) => tabs.nth(index).boundingBox()));
    expect(boxes.every(Boolean)).toBe(true);
    expect(Math.abs(boxes[0]!.y - boxes[2]!.y)).toBeLessThan(2);
    expect(Math.abs(boxes[0]!.width - boxes[2]!.width)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.getByRole("button", { name: "Détails", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Annuler la décision", exact: true })).toHaveCount(0);
    await page.getByLabel("Filtres", { exact: true }).selectOption("status");
    await page.getByLabel("Statut", { exact: true }).selectOption("Active");
    await page.getByLabel("Filtres", { exact: true }).selectOption("reason");
    await page.getByLabel("Motif", { exact: true }).selectOption("social");
    await expect(page.getByRole("button", { name: "Retirer le filtre Active", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Retirer le filtre Cas social", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`social-${width}.png`), fullPage: true });
  });
}
