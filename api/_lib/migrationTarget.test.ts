import { describe, expect, it } from "vitest";
// @ts-expect-error Outil de migration implémenté en JavaScript.
import { parseMigrationArgs, resolveMigrationTarget } from "../../scripts/migrationTarget.mjs";

const stagingEnv = { GOOGLE_CLOUD_PROJECT: "acadea-staging", ACADEA_IDENTITY_INDEX_STAGING: "YES", ACADEA_STAGING_ACCESS_TOKEN: "jeton-staging" };
const productionEnv = { GOOGLE_CLOUD_PROJECT: "acadea-production", ACADEA_PRODUCTION_MIGRATION: "YES", ACADEA_PRODUCTION_ACCESS_TOKEN: "jeton-production" };
const productionArgs = ["--project=acadea-production", "--confirm-production=acadea-production", "--school=school-a"];
const resolve = (argv: string[], env: Record<string, string>) => resolveMigrationTarget({ args: parseMigrationArgs(argv), env, stagingFlag: "ACADEA_IDENTITY_INDEX_STAGING" });

describe("outils de migration : choix du projet", () => {
  it("staging par défaut, avec les mêmes conditions qu'avant", () => {
    expect(resolve(["--school=school-a"], stagingEnv)).toMatchObject({ projectId: "acadea-staging", bucketName: "acadea-staging.firebasestorage.app", token: "jeton-staging" });
    expect(() => resolve(["--school=school-a"], { ...stagingEnv, ACADEA_IDENTITY_INDEX_STAGING: "" })).toThrow("acadea-staging");
    expect(() => resolve(["--school=school-a"], { ...stagingEnv, GOOGLE_CLOUD_PROJECT: "acadea-production" })).toThrow("acadea-staging");
  });

  it("production seulement avec projet, confirmation, autorisation et jeton de production", () => {
    expect(resolve(productionArgs, productionEnv)).toMatchObject({ projectId: "acadea-production", bucketName: "acadea-production.firebasestorage.app", token: "jeton-production" });
    expect(() => resolve(productionArgs.filter((arg) => !arg.startsWith("--confirm")), productionEnv)).toThrow("confirmation");
    expect(() => resolve(["--project=acadea-production", "--confirm-production=acadea-staging", "--school=school-a"], productionEnv)).toThrow("confirmation");
    expect(() => resolve(productionArgs, { ...productionEnv, ACADEA_PRODUCTION_MIGRATION: "" })).toThrow("confirmation");
    expect(() => resolve(productionArgs, { ...productionEnv, GOOGLE_CLOUD_PROJECT: "acadea-staging" })).toThrow("confirmation");
    // Le jeton du staging ne vaut jamais pour la production.
    expect(() => resolve(productionArgs, { GOOGLE_CLOUD_PROJECT: "acadea-production", ACADEA_PRODUCTION_MIGRATION: "YES", ACADEA_STAGING_ACCESS_TOKEN: "jeton-staging" })).toThrow("confirmation");
  });

  it("refuse un projet inconnu, un émulateur et une école invalide", () => {
    expect(() => resolve(["--project=autre", "--school=school-a"], stagingEnv)).toThrow("Projet inconnu");
    expect(() => resolve(["--project=__proto__", "--school=school-a"], stagingEnv)).toThrow("Projet inconnu");
    expect(() => resolve(productionArgs, { ...productionEnv, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" })).toThrow("Émulateur");
    expect(() => resolve(["--school=../autre"], stagingEnv)).toThrow("école");
    expect(() => resolve([], stagingEnv)).toThrow("école");
  });
});
