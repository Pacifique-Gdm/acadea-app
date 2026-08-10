import { describe,expect,it } from "vitest";
import { validateAvailabilityRequest } from "./teacherAvailabilityRequests";

describe("demandes d’indisponibilité",()=>{
  it("valide une journée complète et une plage",()=>{
    expect(validateAvailabilityRequest({requestedDate:"2026-08-11",requestType:"FULL_DAY",reason:"Obligation"},"2026-08-10")).toBe("");
    expect(validateAvailabilityRequest({requestedDate:"2026-08-11",requestType:"TIME_RANGE",startTime:"10:00",endTime:"12:00",reason:"Rendez-vous"},"2026-08-10")).toBe("");
  });
  it("refuse motif vide, date passée et plage inversée",()=>{
    expect(validateAvailabilityRequest({requestedDate:"2026-08-11",requestType:"FULL_DAY",reason:""},"2026-08-10")).toContain("motif");
    expect(validateAvailabilityRequest({requestedDate:"2026-08-09",requestType:"FULL_DAY",reason:"x"},"2026-08-10")).toContain("date");
    expect(validateAvailabilityRequest({requestedDate:"2026-08-11",requestType:"TIME_RANGE",startTime:"12:00",endTime:"10:00",reason:"x"},"2026-08-10")).toContain("postérieure");
  });
});
