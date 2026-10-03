import { q } from "@/lib/db";
import type { ComplianceResult, ComplianceDocument, ComplianceTraveller, AgeBand } from "@/lib/types";

/**
 * Compliance. The visa decision comes from resolve_compliance() in SQL --
 * the model only phrases the result. Nothing here calls an LLM.
 */

const DISCLAIMER = "Guidance only — confirm with the official source.";

interface Row {
  document_type: ComplianceDocument["documentType"];
  status: ComplianceDocument["status"];
  severity: ComplianceDocument["severity"];
  outcome: string | null;
  requirement: string;
  shortfall_days: number | null;
  source_url: string;
  verified_on: Date;
}

const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString().slice(0, 10));

/** Working days between now and a date, roughly -- used to order the task list. */
function monthsBetween(a: Date, b: Date) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export interface ComplianceInput {
  tripId: string;
  destinationCountry: string;
  departDate: string;
  returnDate: string;
}

export async function checkCompliance(input: ComplianceInput): Promise<ComplianceResult> {
  const travellers = await q<{
    id: string; name: string; nationality: string;
    passport_expiry: Date | null; passport_status: string; age_band: AgeBand;
  }>(
    `select tr.id, tr.name, tr.nationality, tr.passport_expiry, tr.passport_status,
            traveller_age_band(tr.birth_date, $2::date) as age_band
       from travellers tr
       join trip_travellers tt on tt.traveller_id = tr.id
      where tt.trip_id = $1
      order by tr.birth_date nulls last`,
    [input.tripId, input.departDate],
  );

  const out: ComplianceTraveller[] = [];
  const sequence: ComplianceResult["sequence"] = [];
  let blocking = 0, required = 0, satisfied = 0;

  for (const t of travellers) {
    const rows = await q<Row>(
      `select * from resolve_compliance($1, $2, $3::date, $4::date, $5::date)`,
      [
        t.nationality,
        input.destinationCountry,
        t.passport_status === "none" ? null : t.passport_expiry,
        input.departDate,
        input.returnDate,
      ],
    );

    const docs: ComplianceDocument[] = rows.map((r) => ({
      documentType: r.document_type,
      status: r.status,
      severity: r.severity,
      outcome: r.outcome,
      requirement: r.requirement,
      shortfallDays: r.shortfall_days,
      sourceUrl: r.source_url,
      verifiedOn: iso(r.verified_on),
      isStale: (Date.now() - new Date(r.verified_on).getTime()) / 86_400_000 > 30,
    }));

    /*
     * Derived advisory the destination rule does not express.
     *
     * The UK only requires validity for the duration of stay, so a passport
     * expiring two months after the trip resolves as "satisfied". That is
     * correct for this trip and wrong for the traveller: almost no onward
     * country accepts a passport inside six months of expiry, and renewing in
     * a panic later is worse than renewing now. So we add a warning -- we do
     * not fabricate a blocker the rule does not support.
     */
    if (t.passport_expiry && t.passport_status !== "none") {
      const passportDoc = docs.find((d) => d.documentType === "passport");
      const monthsLeft = monthsBetween(new Date(input.returnDate), new Date(t.passport_expiry));
      if (passportDoc?.status === "satisfied" && monthsLeft < 6) {
        docs.push({
          documentType: "passport",
          status: "required",
          severity: "warning",
          outcome: null,
          requirement:
            `Valid for this trip, but expires ${monthsLeft} month${monthsLeft === 1 ? "" : "s"} after you return. ` +
            `Most other countries refuse entry inside six months of expiry — renew now rather than in a panic later.`,
          shortfallDays: null,
          sourceUrl: passportDoc.sourceUrl,
          verifiedOn: passportDoc.verifiedOn,
          isStale: passportDoc.isStale,
        });
        sequence.push({ step: 0, task: `Renew ${t.name}'s passport (expires soon after this trip)`, by: null });
      }
    }

    for (const d of docs) {
      if (d.severity === "blocking") blocking++;
      else if (d.status === "required") required++;
      else satisfied++;
    }

    if (docs.some((d) => d.severity === "blocking" && d.documentType === "passport")) {
      sequence.unshift({ step: 0, task: `Apply for ${t.name}'s passport — this gates the visa`, by: null });
    }

    out.push({
      travellerId: t.id,
      name: t.name,
      nationality: t.nationality,
      ageBand: t.age_band,
      documents: docs,
    });
  }

  if (out.some((t) => t.documents.some((d) => d.documentType === "visa" && d.status === "required"))) {
    sequence.push({ step: 0, task: "Submit visa applications once every passport is in hand", by: null });
  }
  sequence.forEach((s, i) => { s.step = i + 1; });

  // persist, so the Documents tab and the admin inspector agree with the chat
  for (const t of out) {
    for (const d of t.documents) {
      await q(
        `insert into compliance_checks
           (trip_id, traveller_id, document_type, status, severity, outcome,
            requirement, shortfall_days, source_url, verified_on)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (trip_id, traveller_id, document_type) do update
           set status = excluded.status, severity = excluded.severity,
               outcome = excluded.outcome, requirement = excluded.requirement,
               shortfall_days = excluded.shortfall_days,
               source_url = excluded.source_url, verified_on = excluded.verified_on`,
        [input.tripId, t.travellerId, d.documentType, d.status, d.severity, d.outcome,
         d.requirement, d.shortfallDays, d.sourceUrl, d.verifiedOn],
      ).catch(() => { /* a duplicate advisory row is not worth failing the plan over */ });
    }
  }

  // a blocking document blocks the trip -- not a soft warning somewhere in a tab
  await q(
    `update trips set state = $2 where id = $1 and state not in ('packaged')`,
    [input.tripId, blocking > 0 ? "blocked" : "ready"],
  );

  return {
    summary: { blocking, required, satisfied },
    travellers: out,
    sequence,
    disclaimer: DISCLAIMER,
    provenance: { tool: "check_compliance", fetchedAt: new Date().toISOString() },
  };
}

export async function loadCompliance(tripId: string): Promise<ComplianceResult | null> {
  const rows = await q<{
    traveller_id: string; name: string; nationality: string; birth_date: Date | null;
    document_type: ComplianceDocument["documentType"]; status: ComplianceDocument["status"];
    severity: ComplianceDocument["severity"]; outcome: string | null; requirement: string;
    shortfall_days: number | null; source_url: string; verified_on: Date;
  }>(
    `select c.traveller_id, t.name, t.nationality, t.birth_date,
            c.document_type, c.status, c.severity, c.outcome, c.requirement,
            c.shortfall_days, c.source_url, c.verified_on
       from compliance_checks c
       join travellers t on t.id = c.traveller_id
      where c.trip_id = $1
      order by t.birth_date nulls last, c.severity desc`,
    [tripId],
  );
  if (!rows.length) return null;

  const byTraveller = new Map<string, ComplianceTraveller>();
  let blocking = 0, required = 0, satisfied = 0;

  for (const r of rows) {
    if (!byTraveller.has(r.traveller_id)) {
      byTraveller.set(r.traveller_id, {
        travellerId: r.traveller_id, name: r.name, nationality: r.nationality,
        ageBand: "adult", documents: [],
      });
    }
    byTraveller.get(r.traveller_id)!.documents.push({
      documentType: r.document_type, status: r.status, severity: r.severity,
      outcome: r.outcome, requirement: r.requirement, shortfallDays: r.shortfall_days,
      sourceUrl: r.source_url, verifiedOn: iso(r.verified_on),
      isStale: (Date.now() - new Date(r.verified_on).getTime()) / 86_400_000 > 30,
    });
    if (r.severity === "blocking") blocking++;
    else if (r.status === "required") required++;
    else satisfied++;
  }

  return {
    summary: { blocking, required, satisfied },
    travellers: [...byTraveller.values()],
    sequence: [],
    disclaimer: DISCLAIMER,
    provenance: { tool: "check_compliance", fetchedAt: new Date().toISOString() },
  };
}

/** Country-specific passport application guidance. No uploads, no identity data. */
export const PASSPORT_GUIDANCE: Record<string, { route: string; docs: string[]; fee: string; days: string; url: string }> = {
  IN: {
    route: "Apply online at the Passport Seva portal, then attend an appointment at a Passport Seva Kendra.",
    docs: ["Birth certificate", "Both parents' passports or ID", "Annexure D (consent, for a minor)", "Address proof"],
    fee: "₹1,000 for a minor, ₹1,500 for an adult (36 pages)",
    days: "30–45 days normal, faster under tatkal",
    url: "https://www.passportindia.gov.in",
  },
  GB: {
    route: "Apply online at GOV.UK with a digital photo.",
    docs: ["Birth certificate", "Previous passport", "Countersignatory for a first adult passport"],
    fee: "£88.50 adult, £57.50 child (online)",
    days: "about 3 weeks",
    url: "https://www.gov.uk/apply-renew-passport",
  },
  US: {
    route: "Form DS-11 in person at an acceptance facility, or DS-82 by mail to renew.",
    docs: ["Proof of citizenship", "Photo ID", "Passport photo"],
    fee: "$165 adult, $135 child",
    days: "6–8 weeks routine, 2–3 weeks expedited",
    url: "https://travel.state.gov",
  },
};
