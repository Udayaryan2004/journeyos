// Canonical domain types. The API, the orchestrator and the client all share these.

export type UUID = string;
export type ISODate = string;      // YYYY-MM-DD
export type ISODateTime = string;

export type TripStatus = "draft" | "planned" | "upcoming" | "active" | "completed" | "archived";
export type TripState = "idle" | "gathering" | "drafting" | "ready" | "refining" | "blocked" | "packaged";
export type Pace = "relaxed" | "balanced" | "packed";
export type HotelTier = "budget" | "mid" | "luxury";
export type AgeBand = "infant" | "child" | "teen" | "adult" | "senior";

export interface Traveller {
  id: UUID;
  name: string;
  birthDate: ISODate | null;
  ageBand: AgeBand;
  nationality: string;
  passportStatus: "valid" | "expiring" | "expired" | "none" | "unknown";
  passportExpiry: ISODate | null;
}

export interface Trip {
  id: UUID;
  userId: UUID;
  title: string;
  status: TripStatus;
  state: TripState;
  destinationCity: string | null;
  destinationCountry: string | null;
  originCity: string | null;
  startDate: ISODate | null;
  endDate: ISODate | null;
  durationDays: number | null;
  partyAdults: number;
  partyChildren: number[];          // ages
  budgetTotal: number | null;
  currency: string;
  pace: Pace;
  interests: string[];
  hotelTier: HotelTier | null;
  assumptions: string[];            // defaults we applied, surfaced in the UI
  shareToken: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface Provenance {
  tool: string;
  fetchedAt: ISODateTime;
}

export interface ItineraryItem {
  id: UUID;
  tripId: UUID;
  dayNumber: number;
  date: ISODate | null;
  slot: "morning" | "afternoon" | "evening";
  sortOrder: number;
  type: "activity" | "meal" | "transport" | "flight" | "checkin" | "free";
  title: string;
  description: string | null;
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  startTime: string | null;         // HH:MM
  durationMin: number | null;
  cost: number | null;
  costCurrency: string | null;
  travelMode: "walk" | "transit" | "taxi" | "drive" | "flight" | null;
  travelMinutes: number | null;
  travelKm: number | null;
  ageBands: string[];
  ticketRequired: boolean;
  bookingUrl: string | null;
  locked: boolean;
  sourceTool: string;
  fetchedAt: ISODateTime;
}

export interface FlightOffer {
  id: string;
  kind: "flight";
  provider: string;
  carrier: string;
  carrierName: string;
  origin: string;
  destination: string;
  departAt: string;
  arriveAt: string;
  durationMin: number;
  stops: number;
  layovers: { airport: string; minutes: number }[];
  baggage: { cabin: number; checked: number };
  price: number;
  currency: string;
  perGroup: boolean;
  valueScore: number;
  reason: string;
  deepLink: string;
  fetchedAt: ISODateTime;
}

export interface HotelOffer {
  id: string;
  kind: "hotel";
  provider: string;
  name: string;
  tier: HotelTier;
  stars: number | null;
  rating: { score: number; count: number };
  area: string;
  lat: number;
  lng: number;
  distanceToCentreKm: number;
  nightly: number;
  total: number;
  currency: string;
  maxAdults: number;
  maxChildren: number;
  amenities: string[];
  familyFriendly: boolean;
  stepFree: boolean;
  valueScore: number;
  reason: string;
  deepLink: string;
  fetchedAt: ISODateTime;
}

export interface EventOffer {
  id: string;
  kind: "event";
  name: string;
  category: string;
  venue: string;
  date: ISODate;
  time: string;
  priceBand: string;
  familyFriendly: boolean;
  url: string;
  fetchedAt: ISODateTime;
}

export interface ComplianceDocument {
  documentType: "passport" | "visa" | "insurance" | "health";
  status: "satisfied" | "required" | "in_progress" | "blocking";
  severity: "info" | "warning" | "blocking";
  outcome: string | null;
  requirement: string;
  shortfallDays: number | null;
  sourceUrl: string;
  verifiedOn: ISODate;
  isStale: boolean;
}

export interface ComplianceTraveller {
  travellerId: UUID;
  name: string;
  nationality: string;
  ageBand: AgeBand;
  documents: ComplianceDocument[];
}

export interface ComplianceResult {
  summary: { blocking: number; required: number; satisfied: number };
  travellers: ComplianceTraveller[];
  sequence: { step: number; task: string; by: ISODate | null }[];
  disclaimer: string;
  provenance: Provenance;
}

export type BudgetCategory = "flights" | "lodging" | "activities" | "food" | "transport" | "other";

export interface Budget {
  currency: string;
  cap: number | null;
  total: number;
  buffer: number;
  categories: Record<BudgetCategory, { planned: number; perPerson: number }>;
  variance: {
    amount: number;
    overBy: number | null;
    causedBy: BudgetCategory | null;
    suggestions: string[];
  };
}

export interface PackingItem { group: string; label: string }

export interface Essentials {
  weather: { date: ISODate; tempC: number; summary: string; rainChance: number }[];
  isForecast: boolean;
  packing: PackingItem[];
  currency: { from: string; to: string; rate: number; asOf: ISODateTime; note: string } | null;
  connectivity: { label: string; price: number; currency: string }[];
  emergency: { label: string; value: string }[];
  tips: string[];
}

/** What the model proposes. The server validates and applies it; the model never writes to the DB. */
export interface TripPatch {
  set?: Partial<{
    title: string;
    destinationCity: string;
    destinationCountry: string;
    originCity: string;
    startDate: ISODate;
    endDate: ISODate;
    durationDays: number;
    partyAdults: number;
    partyChildren: number[];
    budgetTotal: number;
    pace: Pace;
    interests: string[];
    hotelTier: HotelTier;
  }>;
  assumptions?: string[];
  constraints?: string[];
  rationale?: string;
}

/** Server-sent events emitted by /api/trips/[id]/chat */
export type ChatEvent =
  | { type: "state"; state: TripState }
  | { type: "tool_start"; tool: string; label: string }
  | { type: "tool_end"; tool: string; label: string; count?: number; ms: number; warn?: boolean }
  | { type: "token"; text: string }
  | { type: "patch"; scope: "trip" | "itinerary" | "options" | "compliance" | "budget" | "essentials" }
  | { type: "question"; chips: string[] }
  | { type: "done"; state: TripState; costUsd: number; tokensIn: number; tokensOut: number }
  | { type: "error"; code: string; message: string };
