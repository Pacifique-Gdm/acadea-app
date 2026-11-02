import { readFileSync, readdirSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
let server: Server, origin: string, bundle: string;
test.beforeAll(async () => {
  const fixture = `const year={id:'y',schoolId:'s',name:'2098–2099',status:'active',endsAt:'2099-06-30',currency:'USD'};
 const school={id:'s',name:'École de test local',activeSchoolYearId:'y',currency:'USD',address:'Adresse de test',phone:'',email:'',logoUrl:''};
 const student={id:'p',schoolId:'s',schoolYearId:'y',nom:'Élève',postnom:'Local',prenom:'Test',matricule:'LOCAL-1',className:'1ère Primaire',status:'ACTIVE'};
 const fee={id:'f',schoolId:'s',schoolYearId:'y',name:'Minerval',amount:300};
 const decision={id:'decision-local',schoolId:'s',schoolYearId:'y',studentId:'p',studentName:'Élève Local Test',matricule:'LOCAL-1',className:'1ère Primaire',reason:'social',nature:'fixed',personnelId:null,thirdPartyName:'',observation:'Observation privée locale',lines:{f:{feeName:'Minerval',officialMinor:30000,value:100,reductionMinor:10000,commitmentMinor:0}},status:'active',version:1,validUntil:'2099-06-30',createdAt:'2026-10-30T00:00:00Z',updatedAt:'2026-10-30T00:00:00Z',currency:'USD',history:[]};
 decision.history=[{id:'event-local',action:'create',at:decision.createdAt,actorName:'Admin test',before:null,after:{...decision,history:[]}}];
 const data={users:[],schools:[school],schoolYears:[year],students:[student],feeTypes:[fee],payments:[],parents:[],expenses:[],auditLogs:[],messages:[],notifications:[],valves:[]};`;
  const result = await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{SocialSupportDrawer}from'./src/modules/menu/SocialSupportDrawer';${fixture}
 if(new URL(location.href).searchParams.has('capped')){student.financialSupport={[decision.id]:{id:decision.id,schoolYearId:'y',thirdPartyName:'',lines:decision.lines}};data.payments.push({id:'paid',schoolId:'s',schoolYearId:'y',studentId:'p',feeTypeId:'f',amount:50});}window.__data=data;window.__decision=decision;createRoot(document.getElementById('root')).render(<SocialSupportDrawer user={{id:'a',schoolId:'s',role:'school_admin'}} school={school} years={[year]} data={data}/>);`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    jsx: "automatic",
    bundle: true,
    write: false,
    format: "iife",
    define: { "import.meta.env": "{}" },
    plugins: [
      {
        name: "local-only-services",
        setup(builder) {
          builder.onLoad({ filter: /\/services\/socialSupport\.ts$/ }, () => ({
            contents: `export async function reconcileSupport(){}export function subscribeSupport(id,onData){onData(Array.from({length:Number(new URL(location.href).searchParams.get('rows')||1)},(_,i)=>({...window.__decision,id:'decision-'+i,studentName:window.__decision.studentName+' '+i,history:window.__decision.history.map(e=>({...e,id:'event-'+i}))})));return()=>{};}export function subscribeSupportContext(id,onData){for(const name of ['students','payments','feeTypes'])onData({[name]:window.__data[name]});return()=>{};}export async function saveSupport(input){window.__submitted=input;return {...window.__decision,reason:input.reason};}`,
            loader: "js",
          }));
          builder.onLoad({ filter: /\/services\/personnel\.ts$/ }, () => ({
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
  page.on("pageerror", (error) => console.error("Local UI:", error.message));
});
test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
test("validation des motifs, montants et changement de motif sans Firebase", async ({
  page,
}) => {
  await page.goto(origin);
  await page.getByRole("tab", { name: "Nouvelle prise en charge" }).click();
  await expect(page.getByLabel("Motif de l’avantage *")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Confirmer la prise en charge" }),
  ).toBeDisabled();
  await page
    .getByLabel("Élève bénéficiaire", { exact: true })
    .selectOption("p");
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
  await page.getByLabel("Motif de l’avantage *").selectOption("third-party");
  await page.getByLabel("Nom du tiers responsable *").fill("Tiers de test");
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
  await expect(page.getByRole("status")).toContainText("confirmée");
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
    await page.getByRole("button", { name: "Exporter PDF" }).click();
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
 const search=page.getByLabel('Rechercher les décisions'),button=page.getByRole('button',{name:'Exporter PDF'});
 const a=await search.boundingBox(),b=await button.boundingBox();expect(a).not.toBeNull();expect(b).not.toBeNull();expect(b!.x).toBeGreaterThanOrEqual(a!.x+a!.width);expect(b!.x+b!.width).toBeLessThanOrEqual(391);
 await button.click();await expect.poll(()=>page.evaluate(()=>((window as unknown as {__pdf?:string}).__pdf?.match(/\/Type \/Page\b/g)||[]).length),{timeout:45000}).toBeGreaterThan(1);
});

test('plafond visible et message immédiat pour montant, pourcentage et exonération',async({page})=>{
 await page.goto(`${origin}?capped=1`);
 await page.getByRole('tab',{name:'Nouvelle prise en charge'}).click();
 await page.getByLabel('Élève bénéficiaire',{exact:true}).selectOption('p');
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
