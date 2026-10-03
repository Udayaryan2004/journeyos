/**
 * Seeded supplier data.
 *
 * Real carriers, real properties, real attractions with true opening hours and
 * coordinates -- realism matters more than volume, because fake-looking data
 * destroys the credibility the rest of the product earns. Prices are indicative
 * and clearly labelled "sample data" in the UI.
 *
 * Swap these modules for live APIs behind lib/providers/* without touching
 * anything above them.
 */

export interface City {
  key: string;
  name: string;
  country: string;      // ISO-3166 alpha-2
  iata: string;
  lat: number;
  lng: number;
  currency: string;
  tz: string;
  aliases: string[];
}

export const CITIES: City[] = [
  { key: "london",    name: "London",    country: "GB", iata: "LHR", lat: 51.5074, lng: -0.1278, currency: "GBP", tz: "Europe/London",   aliases: ["london", "uk", "england", "britain"] },
  { key: "dubai",     name: "Dubai",     country: "AE", iata: "DXB", lat: 25.2048, lng: 55.2708, currency: "AED", tz: "Asia/Dubai",      aliases: ["dubai", "uae", "emirates"] },
  { key: "singapore", name: "Singapore", country: "SG", iata: "SIN", lat: 1.3521,  lng: 103.8198, currency: "SGD", tz: "Asia/Singapore", aliases: ["singapore", "sg"] },
  { key: "bangkok",   name: "Bangkok",   country: "TH", iata: "BKK", lat: 13.7563, lng: 100.5018, currency: "THB", tz: "Asia/Bangkok",   aliases: ["bangkok", "thailand", "krung thep"] },
  { key: "paris",     name: "Paris",     country: "FR", iata: "CDG", lat: 48.8566, lng: 2.3522,  currency: "EUR", tz: "Europe/Paris",    aliases: ["paris", "france"] },
  { key: "tokyo",     name: "Tokyo",     country: "JP", iata: "HND", lat: 35.6762, lng: 139.6503, currency: "JPY", tz: "Asia/Tokyo",     aliases: ["tokyo", "japan"] },
];

export const ORIGINS: City[] = [
  { key: "bengaluru", name: "Bengaluru", country: "IN", iata: "BLR", lat: 12.9716, lng: 77.5946, currency: "INR", tz: "Asia/Kolkata", aliases: ["bengaluru", "bangalore", "blr"] },
  { key: "mumbai",    name: "Mumbai",    country: "IN", iata: "BOM", lat: 19.076,  lng: 72.8777, currency: "INR", tz: "Asia/Kolkata", aliases: ["mumbai", "bombay", "bom"] },
  { key: "delhi",     name: "Delhi",     country: "IN", iata: "DEL", lat: 28.6139, lng: 77.209,  currency: "INR", tz: "Asia/Kolkata", aliases: ["delhi", "new delhi", "del"] },
  { key: "chennai",   name: "Chennai",   country: "IN", iata: "MAA", lat: 13.0827, lng: 80.2707, currency: "INR", tz: "Asia/Kolkata", aliases: ["chennai", "madras", "maa"] },
];

export function findCity(text: string): City | null {
  const t = text.toLowerCase().trim();
  const all = [...CITIES, ...ORIGINS];
  return (
    all.find((c) => c.name.toLowerCase() === t) ??
    all.find((c) => c.iata.toLowerCase() === t) ??
    all.find((c) => c.aliases.some((a) => t.includes(a))) ??
    null
  );
}

/* ------------------------------------------------------------------ flights */

export interface SeedFlight {
  carrier: string;
  carrierName: string;
  depart: string;        // local HH:MM
  durationMin: number;
  stops: number;
  layover?: { airport: string; minutes: number };
  /** indicative return fare per adult in INR, from an Indian metro */
  farePerAdult: number;
  checked: number;
  cabin: number;
}

/** Routes keyed by destination city key. Fares are indicative return, per adult. */
export const FLIGHTS: Record<string, SeedFlight[]> = {
  london: [
    { carrier: "BA", carrierName: "British Airways", depart: "01:45", durationMin: 635, stops: 0, farePerAdult: 56000, checked: 2, cabin: 1 },
    { carrier: "AI", carrierName: "Air India",       depart: "06:00", durationMin: 690, stops: 0, farePerAdult: 52750, checked: 2, cabin: 1 },
    { carrier: "VS", carrierName: "Virgin Atlantic", depart: "03:20", durationMin: 650, stops: 0, farePerAdult: 59400, checked: 1, cabin: 1 },
    { carrier: "QR", carrierName: "Qatar Airways",   depart: "04:10", durationMin: 1195, stops: 1, layover: { airport: "DOH", minutes: 545 }, farePerAdult: 44000, checked: 2, cabin: 1 },
    { carrier: "EK", carrierName: "Emirates",        depart: "21:30", durationMin: 1080, stops: 1, layover: { airport: "DXB", minutes: 330 }, farePerAdult: 47800, checked: 2, cabin: 1 },
    { carrier: "LH", carrierName: "Lufthansa",       depart: "02:40", durationMin: 1010, stops: 1, layover: { airport: "FRA", minutes: 190 }, farePerAdult: 51200, checked: 1, cabin: 1 },
    { carrier: "TK", carrierName: "Turkish Airlines",depart: "05:05", durationMin: 1140, stops: 1, layover: { airport: "IST", minutes: 260 }, farePerAdult: 45600, checked: 2, cabin: 1 },
  ],
  dubai: [
    { carrier: "EK", carrierName: "Emirates",        depart: "04:30", durationMin: 235, stops: 0, farePerAdult: 24800, checked: 2, cabin: 1 },
    { carrier: "6E", carrierName: "IndiGo",          depart: "09:15", durationMin: 240, stops: 0, farePerAdult: 17200, checked: 1, cabin: 1 },
    { carrier: "AI", carrierName: "Air India",       depart: "20:05", durationMin: 245, stops: 0, farePerAdult: 21400, checked: 2, cabin: 1 },
    { carrier: "FZ", carrierName: "flydubai",        depart: "22:40", durationMin: 250, stops: 0, farePerAdult: 18900, checked: 1, cabin: 1 },
  ],
  singapore: [
    { carrier: "SQ", carrierName: "Singapore Airlines", depart: "23:30", durationMin: 265, stops: 0, farePerAdult: 32400, checked: 2, cabin: 1 },
    { carrier: "6E", carrierName: "IndiGo",             depart: "01:10", durationMin: 275, stops: 0, farePerAdult: 21800, checked: 1, cabin: 1 },
    { carrier: "AI", carrierName: "Air India",          depart: "20:45", durationMin: 280, stops: 0, farePerAdult: 27600, checked: 2, cabin: 1 },
    { carrier: "TR", carrierName: "Scoot",              depart: "02:25", durationMin: 285, stops: 0, farePerAdult: 16400, checked: 0, cabin: 1 },
  ],
  bangkok: [
    { carrier: "TG", carrierName: "Thai Airways",   depart: "01:00", durationMin: 240, stops: 0, farePerAdult: 24600, checked: 2, cabin: 1 },
    { carrier: "6E", carrierName: "IndiGo",         depart: "05:40", durationMin: 250, stops: 0, farePerAdult: 15800, checked: 1, cabin: 1 },
    { carrier: "AI", carrierName: "Air India",      depart: "22:15", durationMin: 245, stops: 0, farePerAdult: 19900, checked: 2, cabin: 1 },
  ],
  paris: [
    { carrier: "AF", carrierName: "Air France",     depart: "02:20", durationMin: 605, stops: 0, farePerAdult: 54200, checked: 1, cabin: 1 },
    { carrier: "AI", carrierName: "Air India",      depart: "03:45", durationMin: 620, stops: 0, farePerAdult: 50800, checked: 2, cabin: 1 },
    { carrier: "EK", carrierName: "Emirates",       depart: "21:15", durationMin: 1050, stops: 1, layover: { airport: "DXB", minutes: 300 }, farePerAdult: 44900, checked: 2, cabin: 1 },
  ],
  tokyo: [
    { carrier: "NH", carrierName: "ANA",            depart: "20:30", durationMin: 565, stops: 0, farePerAdult: 62400, checked: 2, cabin: 1 },
    { carrier: "JL", carrierName: "Japan Airlines", depart: "21:10", durationMin: 575, stops: 0, farePerAdult: 60100, checked: 2, cabin: 1 },
    { carrier: "SQ", carrierName: "Singapore Airlines", depart: "23:25", durationMin: 1080, stops: 1, layover: { airport: "SIN", minutes: 215 }, farePerAdult: 51700, checked: 2, cabin: 1 },
  ],
};

/* ------------------------------------------------------------------- hotels */

export interface SeedHotel {
  name: string;
  tier: "budget" | "mid" | "luxury";
  stars: number;
  rating: number;
  reviews: number;
  area: string;
  lat: number;
  lng: number;
  /** indicative nightly rate in INR for the whole room */
  nightly: number;
  maxAdults: number;
  maxChildren: number;
  amenities: string[];
  familyFriendly: boolean;
  stepFree: boolean;
}

export const HOTELS: Record<string, SeedHotel[]> = {
  london: [
    { name: "South Kensington Apartment", tier: "mid", stars: 0, rating: 4.8, reviews: 412, area: "South Kensington", lat: 51.4941, lng: -0.1738, nightly: 19700, maxAdults: 4, maxChildren: 3, amenities: ["Kitchen", "2 bedrooms", "Washer", "Wi-Fi"], familyFriendly: true, stepFree: true },
    { name: "Premier Inn London County Hall", tier: "budget", stars: 3, rating: 4.5, reviews: 8210, area: "South Bank", lat: 51.5016, lng: -0.1195, nightly: 14900, maxAdults: 2, maxChildren: 2, amenities: ["Family room", "Breakfast", "Wi-Fi"], familyFriendly: true, stepFree: true },
    { name: "The Bailey's Hotel Kensington", tier: "mid", stars: 4, rating: 4.6, reviews: 3104, area: "Kensington", lat: 51.4938, lng: -0.1829, nightly: 23400, maxAdults: 4, maxChildren: 2, amenities: ["Breakfast", "Connecting rooms", "Wi-Fi"], familyFriendly: true, stepFree: true },
    { name: "citizenM Tower of London", tier: "mid", stars: 4, rating: 4.7, reviews: 6890, area: "City of London", lat: 51.5101, lng: -0.0776, nightly: 18200, maxAdults: 2, maxChildren: 1, amenities: ["Rooftop bar", "Wi-Fi", "24h food"], familyFriendly: false, stepFree: true },
    { name: "The Savoy", tier: "luxury", stars: 5, rating: 4.8, reviews: 5420, area: "Covent Garden", lat: 51.5101, lng: -0.1205, nightly: 68000, maxAdults: 3, maxChildren: 2, amenities: ["Spa", "Butler", "River view", "Pool"], familyFriendly: true, stepFree: true },
    { name: "YHA London Central", tier: "budget", stars: 2, rating: 4.1, reviews: 2930, area: "Marylebone", lat: 51.5187, lng: -0.1489, nightly: 8600, maxAdults: 4, maxChildren: 2, amenities: ["Shared kitchen", "Wi-Fi"], familyFriendly: true, stepFree: false },
  ],
  dubai: [
    { name: "Rove Downtown", tier: "budget", stars: 3, rating: 4.6, reviews: 9120, area: "Downtown", lat: 25.1912, lng: 55.2742, nightly: 9800, maxAdults: 3, maxChildren: 2, amenities: ["Pool", "Gym", "Wi-Fi"], familyFriendly: true, stepFree: true },
    { name: "Hyatt Place Dubai Jumeirah", tier: "mid", stars: 4, rating: 4.5, reviews: 4310, area: "Jumeirah", lat: 25.2285, lng: 55.2599, nightly: 16400, maxAdults: 4, maxChildren: 2, amenities: ["Pool", "Breakfast", "Kitchenette"], familyFriendly: true, stepFree: true },
    { name: "Atlantis The Palm", tier: "luxury", stars: 5, rating: 4.7, reviews: 21400, area: "Palm Jumeirah", lat: 25.1304, lng: 55.1171, nightly: 58000, maxAdults: 4, maxChildren: 3, amenities: ["Waterpark", "Aquarium", "Private beach"], familyFriendly: true, stepFree: true },
    { name: "Premier Inn Dubai Investments Park", tier: "budget", stars: 3, rating: 4.4, reviews: 3180, area: "Dubai Investments Park", lat: 24.9857, lng: 55.1793, nightly: 7200, maxAdults: 2, maxChildren: 2, amenities: ["Pool", "Breakfast"], familyFriendly: true, stepFree: true },
  ],
  singapore: [
    { name: "Hotel Boss", tier: "budget", stars: 3, rating: 4.1, reviews: 11200, area: "Lavender", lat: 1.3069, lng: 103.8626, nightly: 8900, maxAdults: 2, maxChildren: 1, amenities: ["Pool", "Wi-Fi"], familyFriendly: false, stepFree: true },
    { name: "Village Hotel Bugis", tier: "mid", stars: 4, rating: 4.4, reviews: 5410, area: "Bugis", lat: 1.3016, lng: 103.8637, nightly: 16800, maxAdults: 4, maxChildren: 2, amenities: ["Pool", "Family room", "Breakfast"], familyFriendly: true, stepFree: true },
    { name: "Marina Bay Sands", tier: "luxury", stars: 5, rating: 4.6, reviews: 48300, area: "Marina Bay", lat: 1.2834, lng: 103.8607, nightly: 52000, maxAdults: 3, maxChildren: 2, amenities: ["Infinity pool", "SkyPark", "Casino"], familyFriendly: true, stepFree: true },
    { name: "Holiday Inn Express Clarke Quay", tier: "mid", stars: 3, rating: 4.5, reviews: 6720, area: "Clarke Quay", lat: 1.2886, lng: 103.8456, nightly: 13900, maxAdults: 3, maxChildren: 2, amenities: ["Breakfast", "Pool", "Wi-Fi"], familyFriendly: true, stepFree: true },
  ],
  bangkok: [
    { name: "Ibis Bangkok Riverside", tier: "budget", stars: 3, rating: 4.3, reviews: 7210, area: "Riverside", lat: 13.7055, lng: 100.4915, nightly: 4600, maxAdults: 3, maxChildren: 2, amenities: ["Pool", "River shuttle"], familyFriendly: true, stepFree: true },
    { name: "Chatrium Hotel Riverside", tier: "mid", stars: 5, rating: 4.6, reviews: 9840, area: "Riverside", lat: 13.7014, lng: 100.5101, nightly: 11200, maxAdults: 4, maxChildren: 2, amenities: ["Pool", "Kitchenette", "River view"], familyFriendly: true, stepFree: true },
    { name: "Mandarin Oriental Bangkok", tier: "luxury", stars: 5, rating: 4.8, reviews: 6120, area: "Riverside", lat: 13.7236, lng: 100.5143, nightly: 46000, maxAdults: 3, maxChildren: 2, amenities: ["Spa", "Pool", "Butler"], familyFriendly: true, stepFree: true },
  ],
  paris: [
    { name: "Hotel Jeanne d'Arc Le Marais", tier: "budget", stars: 2, rating: 4.4, reviews: 2140, area: "Le Marais", lat: 48.8558, lng: 2.3625, nightly: 11800, maxAdults: 3, maxChildren: 1, amenities: ["Wi-Fi", "Breakfast"], familyFriendly: true, stepFree: false },
    { name: "Citadines Les Halles", tier: "mid", stars: 4, rating: 4.3, reviews: 5310, area: "Les Halles", lat: 48.8617, lng: 2.3464, nightly: 21400, maxAdults: 4, maxChildren: 2, amenities: ["Kitchen", "Washer", "Wi-Fi"], familyFriendly: true, stepFree: true },
    { name: "Le Meurice", tier: "luxury", stars: 5, rating: 4.7, reviews: 3890, area: "Tuileries", lat: 48.8656, lng: 2.3281, nightly: 82000, maxAdults: 3, maxChildren: 2, amenities: ["Spa", "Michelin dining"], familyFriendly: true, stepFree: true },
  ],
  tokyo: [
    { name: "Tokyu Stay Shinjuku", tier: "mid", stars: 3, rating: 4.5, reviews: 4120, area: "Shinjuku", lat: 35.6938, lng: 139.7036, nightly: 14800, maxAdults: 3, maxChildren: 2, amenities: ["Washer", "Kitchenette"], familyFriendly: true, stepFree: true },
    { name: "APA Hotel Asakusa", tier: "budget", stars: 3, rating: 4.2, reviews: 6210, area: "Asakusa", lat: 35.7118, lng: 139.7966, nightly: 7400, maxAdults: 2, maxChildren: 1, amenities: ["Onsen", "Wi-Fi"], familyFriendly: false, stepFree: true },
    { name: "Park Hyatt Tokyo", tier: "luxury", stars: 5, rating: 4.8, reviews: 4980, area: "Shinjuku", lat: 35.6855, lng: 139.6911, nightly: 64000, maxAdults: 3, maxChildren: 2, amenities: ["Pool", "Spa", "City view"], familyFriendly: true, stepFree: true },
  ],
};

/* ------------------------------------------------------------------- places */

export interface SeedPlace {
  name: string;
  category: string;
  lat: number;
  lng: number;
  /** typical visit length in minutes */
  durationMin: number;
  /** 0 = Sunday .. 6 = Saturday; [open, close] in 24h decimal hours */
  hours: Partial<Record<number, [number, number]>>;
  closedDays: number[];
  /** indicative adult ticket price in INR; 0 = free */
  price: number;
  ageBands: ("toddler" | "child" | "teen" | "adult" | "senior")[];
  ticketRequired: boolean;
  sellsOut: boolean;
  indoor: boolean;
  hiddenGem: boolean;
  tags: string[];
  note: string;
}

const ALL_WEEK = (open: number, close: number) =>
  ({ 0: [open, close], 1: [open, close], 2: [open, close], 3: [open, close], 4: [open, close], 5: [open, close], 6: [open, close] }) as SeedPlace["hours"];

export const PLACES: Record<string, SeedPlace[]> = {
  london: [
    { name: "British Museum", category: "museum", lat: 51.5194, lng: -0.1270, durationMin: 120, hours: ALL_WEEK(10, 17), closedDays: [], price: 0, ageBands: ["child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: true, hiddenGem: false, tags: ["history", "culture", "free"], note: "Free entry. The Egypt wing holds a six-year-old for about an hour." },
    { name: "Tower of London", category: "landmark", lat: 51.5081, lng: -0.0759, durationMin: 180, hours: ALL_WEEK(9, 17.5), closedDays: [], price: 3400, ageBands: ["child", "teen", "adult", "senior"], ticketRequired: true, sellsOut: true, indoor: false, hiddenGem: false, tags: ["history", "crown jewels"], note: "Pre-book. Sells out in school holidays; Crown Jewels first, before the queue builds." },
    { name: "Natural History Museum", category: "museum", lat: 51.4967, lng: -0.1764, durationMin: 90, hours: ALL_WEEK(10, 17.8), closedDays: [], price: 0, ageBands: ["toddler", "child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: true, hiddenGem: false, tags: ["dinosaurs", "kids", "free"], note: "Dinosaurs hold a six-year-old for exactly the 90 minutes you need." },
    { name: "Science Museum Wonderlab", category: "museum", lat: 51.4978, lng: -0.1745, durationMin: 90, hours: ALL_WEEK(10, 18), closedDays: [], price: 1100, ageBands: ["child", "teen"], ticketRequired: true, sellsOut: false, indoor: true, hiddenGem: false, tags: ["hands-on", "kids"], note: "Hands-on gallery; worth the ticket for over-eights." },
    { name: "Diana Memorial Playground", category: "park", lat: 51.5057, lng: -0.1757, durationMin: 90, hours: ALL_WEEK(10, 19.75), closedDays: [], price: 0, ageBands: ["toddler", "child"], ticketRequired: false, sellsOut: false, indoor: false, hiddenGem: false, tags: ["kids", "free", "outdoor"], note: "Pirate ship and sand. They will remember this longer than the museum." },
    { name: "Borough Market", category: "food", lat: 51.5055, lng: -0.0910, durationMin: 60, hours: { 1: [10, 17], 2: [10, 17], 3: [10, 17], 4: [10, 18], 5: [10, 18], 6: [8, 17] }, closedDays: [0], price: 0, ageBands: ["child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: true, hiddenGem: false, tags: ["food", "market"], note: "Covered, so it works in rain. Closed Sundays." },
    { name: "Churchill War Rooms", category: "museum", lat: 51.5020, lng: -0.1292, durationMin: 120, hours: ALL_WEEK(9.5, 18), closedDays: [], price: 3000, ageBands: ["teen", "adult", "senior"], ticketRequired: true, sellsOut: true, indoor: true, hiddenGem: false, tags: ["history"], note: "Strong for over-tens; too dense for younger children." },
    { name: "London Eye", category: "landmark", lat: 51.5033, lng: -0.1195, durationMin: 45, hours: ALL_WEEK(11, 18), closedDays: [], price: 3200, ageBands: ["toddler", "child", "teen", "adult", "senior"], ticketRequired: true, sellsOut: true, indoor: true, hiddenGem: false, tags: ["view", "kids"], note: "Pre-book a slot. Sunset is better but queues are worse." },
    { name: "Covent Garden", category: "neighbourhood", lat: 51.5118, lng: -0.1226, durationMin: 90, hours: ALL_WEEK(10, 20), closedDays: [], price: 0, ageBands: ["toddler", "child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: false, hiddenGem: false, tags: ["shopping", "street performers", "free"], note: "Street performers on the hour. Good last-morning stop." },
    { name: "Sir John Soane's Museum", category: "museum", lat: 51.5169, lng: -0.1173, durationMin: 60, hours: { 3: [10, 17], 4: [10, 17], 5: [10, 17], 6: [10, 17] }, closedDays: [0, 1, 2], price: 0, ageBands: ["teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: true, hiddenGem: true, tags: ["hidden gem", "free", "architecture"], note: "A house crammed with antiquities. Free, tiny, and almost nobody goes." },
    { name: "Thames Clipper to Westminster", category: "transport", lat: 51.5074, lng: -0.0877, durationMin: 25, hours: ALL_WEEK(7, 22), closedDays: [], price: 900, ageBands: ["toddler", "child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: true, hiddenGem: true, tags: ["view", "transport"], note: "The best cheap view in London, and it counts as transport." },
    { name: "Hyde Park Serpentine", category: "park", lat: 51.5057, lng: -0.1650, durationMin: 60, hours: ALL_WEEK(6, 21), closedDays: [], price: 700, ageBands: ["toddler", "child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: false, hiddenGem: false, tags: ["outdoor", "free"], note: "Pedalos in season; free to walk." },
  ],
  dubai: [
    { name: "Burj Khalifa At the Top", category: "landmark", lat: 25.1972, lng: 55.2744, durationMin: 90, hours: ALL_WEEK(9, 23), closedDays: [], price: 4200, ageBands: ["child", "teen", "adult", "senior"], ticketRequired: true, sellsOut: true, indoor: true, hiddenGem: false, tags: ["view"], note: "Book a timed slot; sunset slots go first." },
    { name: "Dubai Aquarium", category: "attraction", lat: 25.1975, lng: 55.2796, durationMin: 90, hours: ALL_WEEK(10, 22), closedDays: [], price: 3100, ageBands: ["toddler", "child", "teen", "adult"], ticketRequired: true, sellsOut: false, indoor: true, hiddenGem: false, tags: ["kids"], note: "Inside Dubai Mall; good mid-afternoon heat escape." },
    { name: "Al Fahidi Historical District", category: "neighbourhood", lat: 25.2639, lng: 55.2972, durationMin: 90, hours: ALL_WEEK(8, 18), closedDays: [], price: 0, ageBands: ["child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: false, hiddenGem: true, tags: ["hidden gem", "history", "free"], note: "Wind-tower houses and coffee museums. Go early, before the heat." },
    { name: "Desert Safari", category: "tour", lat: 25.0657, lng: 55.5712, durationMin: 360, hours: ALL_WEEK(15, 22), closedDays: [], price: 5600, ageBands: ["child", "teen", "adult"], ticketRequired: true, sellsOut: true, indoor: false, hiddenGem: false, tags: ["adventure"], note: "Dune bashing is rough for under-sixes; ask for the gentle option." },
    { name: "Jumeirah Public Beach", category: "beach", lat: 25.2048, lng: 55.2416, durationMin: 120, hours: ALL_WEEK(6, 20), closedDays: [], price: 0, ageBands: ["toddler", "child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: false, hiddenGem: false, tags: ["free", "outdoor"], note: "Free, with Burj Al Arab views." },
    { name: "Dubai Frame", category: "landmark", lat: 25.2356, lng: 55.3003, durationMin: 60, hours: ALL_WEEK(9, 21), closedDays: [], price: 1200, ageBands: ["child", "teen", "adult", "senior"], ticketRequired: true, sellsOut: false, indoor: true, hiddenGem: true, tags: ["view", "hidden gem"], note: "Cheaper than Burj Khalifa and the view is arguably better framed." },
  ],
  singapore: [
    { name: "Gardens by the Bay", category: "park", lat: 1.2816, lng: 103.8636, durationMin: 150, hours: ALL_WEEK(9, 21), closedDays: [], price: 1900, ageBands: ["toddler", "child", "teen", "adult", "senior"], ticketRequired: true, sellsOut: false, indoor: true, hiddenGem: false, tags: ["kids", "garden"], note: "Cloud Forest is air-conditioned; the outdoor Supertrees are free." },
    { name: "Singapore Zoo", category: "attraction", lat: 1.4043, lng: 103.7930, durationMin: 240, hours: ALL_WEEK(8.5, 18), closedDays: [], price: 3300, ageBands: ["toddler", "child", "teen", "adult", "senior"], ticketRequired: true, sellsOut: false, indoor: false, hiddenGem: false, tags: ["kids", "animals"], note: "Open-concept enclosures. Go at opening to beat the heat." },
    { name: "Hawker Centre at Maxwell", category: "food", lat: 1.2803, lng: 103.8448, durationMin: 60, hours: ALL_WEEK(8, 22), closedDays: [], price: 0, ageBands: ["child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: true, hiddenGem: false, tags: ["food", "cheap"], note: "Lunch for a family for less than a coffee in Marina Bay." },
    { name: "Haw Par Villa", category: "attraction", lat: 1.2830, lng: 103.7820, durationMin: 90, hours: ALL_WEEK(9, 19), closedDays: [], price: 0, ageBands: ["teen", "adult"], ticketRequired: false, sellsOut: false, indoor: false, hiddenGem: true, tags: ["hidden gem", "free", "odd"], note: "Free, bizarre, and nearly empty. Not for small children." },
    { name: "Sentosa Beaches", category: "beach", lat: 1.2494, lng: 103.8303, durationMin: 180, hours: ALL_WEEK(7, 21), closedDays: [], price: 400, ageBands: ["toddler", "child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: false, hiddenGem: false, tags: ["kids", "beach"], note: "Monorail in is cheap; the beaches themselves are free." },
    { name: "National Gallery Singapore", category: "museum", lat: 1.2904, lng: 103.8520, durationMin: 120, hours: ALL_WEEK(10, 19), closedDays: [], price: 1300, ageBands: ["teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: true, hiddenGem: false, tags: ["art"], note: "Free for Singapore residents; rooftop bar has the best city view." },
  ],
  bangkok: [
    { name: "Grand Palace & Wat Phra Kaew", category: "landmark", lat: 13.7500, lng: 100.4915, durationMin: 150, hours: ALL_WEEK(8.5, 15.5), closedDays: [], price: 1400, ageBands: ["child", "teen", "adult", "senior"], ticketRequired: true, sellsOut: false, indoor: false, hiddenGem: false, tags: ["history", "temple"], note: "Strict dress code: covered shoulders and knees, children included." },
    { name: "Wat Arun", category: "temple", lat: 13.7437, lng: 100.4889, durationMin: 60, hours: ALL_WEEK(8, 18), closedDays: [], price: 300, ageBands: ["child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: false, hiddenGem: false, tags: ["temple", "view"], note: "Best at sunset from across the river." },
    { name: "Chatuchak Weekend Market", category: "market", lat: 13.7999, lng: 100.5503, durationMin: 180, hours: { 6: [9, 18], 0: [9, 18] }, closedDays: [1, 2, 3, 4, 5], price: 0, ageBands: ["teen", "adult"], ticketRequired: false, sellsOut: false, indoor: false, hiddenGem: false, tags: ["shopping", "free"], note: "Weekends only. Overwhelming with a pushchair." },
    { name: "Jim Thompson House", category: "museum", lat: 13.7494, lng: 100.5282, durationMin: 75, hours: ALL_WEEK(10, 18), closedDays: [], price: 600, ageBands: ["teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: true, hiddenGem: true, tags: ["hidden gem", "architecture"], note: "Teak houses and a genuine mystery. Guided tour included." },
    { name: "Lumphini Park", category: "park", lat: 13.7307, lng: 100.5418, durationMin: 60, hours: ALL_WEEK(4.5, 21), closedDays: [], price: 0, ageBands: ["toddler", "child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: false, hiddenGem: false, tags: ["free", "outdoor"], note: "Monitor lizards, pedal boats, and free morning aerobics." },
    { name: "Chao Phraya Express Boat", category: "transport", lat: 13.7404, lng: 100.5109, durationMin: 40, hours: ALL_WEEK(6, 19), closedDays: [], price: 50, ageBands: ["toddler", "child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: false, hiddenGem: true, tags: ["transport", "cheap"], note: "The orange-flag boat costs pennies and beats a taxi in traffic." },
  ],
  paris: [
    { name: "Eiffel Tower", category: "landmark", lat: 48.8584, lng: 2.2945, durationMin: 120, hours: ALL_WEEK(9.5, 23), closedDays: [], price: 2600, ageBands: ["toddler", "child", "teen", "adult", "senior"], ticketRequired: true, sellsOut: true, indoor: false, hiddenGem: false, tags: ["view"], note: "Book the lift weeks ahead; stairs to level 2 never sell out." },
    { name: "Louvre Museum", category: "museum", lat: 48.8606, lng: 2.3376, durationMin: 150, hours: { 0: [9, 18], 1: [9, 18], 3: [9, 18], 4: [9, 21.75], 5: [9, 18], 6: [9, 18] }, closedDays: [2], price: 1900, ageBands: ["child", "teen", "adult", "senior"], ticketRequired: true, sellsOut: true, indoor: true, hiddenGem: false, tags: ["art"], note: "Closed Tuesdays. Under-18s free." },
    { name: "Jardin du Luxembourg", category: "park", lat: 48.8462, lng: 2.3372, durationMin: 90, hours: ALL_WEEK(7.5, 20.5), closedDays: [], price: 0, ageBands: ["toddler", "child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: false, hiddenGem: false, tags: ["free", "kids"], note: "Toy sailboats on the pond; the playground is worth the small fee." },
    { name: "Musée de l'Orangerie", category: "museum", lat: 48.8638, lng: 2.3226, durationMin: 75, hours: { 0: [9, 18], 1: [9, 18], 3: [9, 18], 4: [9, 18], 5: [9, 18], 6: [9, 18] }, closedDays: [2], price: 1100, ageBands: ["teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: true, hiddenGem: true, tags: ["hidden gem", "art"], note: "Monet's water lilies in two oval rooms. An hour, and far calmer than the Louvre." },
  ],
  tokyo: [
    { name: "Senso-ji Temple", category: "temple", lat: 35.7148, lng: 139.7967, durationMin: 90, hours: ALL_WEEK(6, 17), closedDays: [], price: 0, ageBands: ["toddler", "child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: false, hiddenGem: false, tags: ["temple", "free"], note: "Go before 8am to have it almost to yourself." },
    { name: "teamLab Planets", category: "attraction", lat: 35.6487, lng: 139.7904, durationMin: 120, hours: ALL_WEEK(9, 22), closedDays: [], price: 2400, ageBands: ["child", "teen", "adult"], ticketRequired: true, sellsOut: true, indoor: true, hiddenGem: false, tags: ["immersive", "kids"], note: "You walk through water; bring shorts. Sells out weeks ahead." },
    { name: "Shibuya Crossing & Sky", category: "landmark", lat: 35.6595, lng: 139.7005, durationMin: 60, hours: ALL_WEEK(9, 23), closedDays: [], price: 1500, ageBands: ["child", "teen", "adult", "senior"], ticketRequired: true, sellsOut: false, indoor: false, hiddenGem: false, tags: ["view"], note: "Shibuya Sky at sunset is the shot everyone wants." },
    { name: "Yanaka Ginza", category: "neighbourhood", lat: 35.7276, lng: 139.7664, durationMin: 90, hours: ALL_WEEK(10, 18), closedDays: [], price: 0, ageBands: ["child", "teen", "adult", "senior"], ticketRequired: false, sellsOut: false, indoor: false, hiddenGem: true, tags: ["hidden gem", "free", "food"], note: "Old-Tokyo shopping street that survived the war. Cats everywhere." },
  ],
};

/* ------------------------------------------------------------------- events */

export interface SeedEvent {
  name: string;
  category: "concert" | "festival" | "sport" | "local";
  venue: string;
  /** month-day recurrence, so the demo always has something in range */
  monthDay: string;      // MM-DD
  time: string;
  priceBand: string;
  familyFriendly: boolean;
  url: string;
}

export const EVENTS: Record<string, SeedEvent[]> = {
  london: [
    { name: "West End: The Lion King", category: "concert", venue: "Lyceum Theatre", monthDay: "04-12", time: "19:30", priceBand: "£35-£150", familyFriendly: true, url: "https://www.thelionking.co.uk" },
    { name: "Premier League matchday", category: "sport", venue: "Emirates Stadium", monthDay: "04-13", time: "15:00", priceBand: "£40-£120", familyFriendly: true, url: "https://www.premierleague.com" },
    { name: "Covent Garden street festival", category: "festival", venue: "Covent Garden Piazza", monthDay: "04-15", time: "11:00", priceBand: "Free", familyFriendly: true, url: "https://www.coventgarden.london" },
    { name: "Southbank Food Market", category: "local", venue: "Southbank Centre", monthDay: "04-16", time: "12:00", priceBand: "Free entry", familyFriendly: true, url: "https://www.southbankcentre.co.uk" },
  ],
  dubai: [
    { name: "Dubai Fountain show", category: "local", venue: "Burj Lake", monthDay: "04-12", time: "18:00", priceBand: "Free", familyFriendly: true, url: "https://www.thedubaifountain.com" },
    { name: "Global Village closing week", category: "festival", venue: "Global Village", monthDay: "04-14", time: "16:00", priceBand: "AED 25", familyFriendly: true, url: "https://www.globalvillage.ae" },
  ],
  singapore: [
    { name: "Gardens by the Bay light show", category: "local", venue: "Supertree Grove", monthDay: "04-13", time: "19:45", priceBand: "Free", familyFriendly: true, url: "https://www.gardensbythebay.com.sg" },
    { name: "Singapore Food Festival preview", category: "festival", venue: "Various", monthDay: "04-16", time: "11:00", priceBand: "Free entry", familyFriendly: true, url: "https://www.visitsingapore.com" },
  ],
  bangkok: [
    { name: "Songkran water festival", category: "festival", venue: "Silom Road", monthDay: "04-13", time: "10:00", priceBand: "Free", familyFriendly: true, url: "https://www.tourismthailand.org" },
    { name: "Muay Thai at Rajadamnern", category: "sport", venue: "Rajadamnern Stadium", monthDay: "04-15", time: "18:30", priceBand: "THB 1,000-2,000", familyFriendly: false, url: "https://rajadamnern.com" },
  ],
  paris: [
    { name: "Paris Marathon", category: "sport", venue: "Champs-Élysées", monthDay: "04-12", time: "08:00", priceBand: "Free to watch", familyFriendly: true, url: "https://www.schneiderelectricparismarathon.com" },
  ],
  tokyo: [
    { name: "Cherry blossom night viewing", category: "festival", venue: "Ueno Park", monthDay: "04-05", time: "18:00", priceBand: "Free", familyFriendly: true, url: "https://www.gotokyo.org" },
  ],
};

/* ---------------------------------------------------------------- utilities */

/** Indicative FX to INR. Replace with a live rate service in week 2. */
export const FX_TO_INR: Record<string, number> = {
  INR: 1, GBP: 112.4, EUR: 95.8, USD: 88.2, AED: 24.0, SGD: 65.4, THB: 2.45, JPY: 0.57,
};

export const EMERGENCY: Record<string, { label: string; value: string }[]> = {
  GB: [
    { label: "Police / ambulance / fire", value: "999" },
    { label: "Non-emergency medical", value: "111" },
    { label: "High Commission of India", value: "+44 20 7836 8484" },
    { label: "Address", value: "India House, Aldwych, London WC2B 4NA" },
  ],
  AE: [
    { label: "Police", value: "999" },
    { label: "Ambulance", value: "998" },
    { label: "Consulate General of India, Dubai", value: "+971 4 397 1222" },
  ],
  SG: [
    { label: "Police", value: "999" },
    { label: "Ambulance / fire", value: "995" },
    { label: "High Commission of India", value: "+65 6737 6777" },
  ],
  TH: [
    { label: "Tourist police", value: "1155" },
    { label: "Ambulance", value: "1669" },
    { label: "Embassy of India, Bangkok", value: "+66 2 258 0300" },
  ],
  FR: [
    { label: "Emergency (EU)", value: "112" },
    { label: "Embassy of India, Paris", value: "+33 1 40 50 70 70" },
  ],
  JP: [
    { label: "Police", value: "110" },
    { label: "Ambulance / fire", value: "119" },
    { label: "Embassy of India, Tokyo", value: "+81 3 3262 2391" },
  ],
};

export const LOCAL_TIPS: Record<string, string[]> = {
  london: [
    "Under-11s travel free on the Tube with a paying adult; an 11-year-old needs a Zip card.",
    "Most major museums are free entry -- London is kinder to family budgets than its reputation.",
    "Just tap your phone on buses and the Tube. Daily caps apply automatically, so travelcards rarely pay off.",
  ],
  dubai: [
    "The Metro is spotless and cheap; taxis are the expensive default most visitors fall into.",
    "Midday in summer is genuinely dangerous heat -- plan indoor activities from 12:00 to 16:00.",
    "Fridays start late. Many attractions open after 14:00.",
  ],
  singapore: [
    "Hawker centres are the best value food anywhere, and air-conditioned malls connect half the city.",
    "Tap water is safe to drink; bottled water is a pure waste of money here.",
    "The EZ-Link card works on every bus and train, and the airport MRT runs until just before midnight.",
  ],
  bangkok: [
    "The orange-flag Chao Phraya express boat costs pennies and beats traffic by half an hour.",
    "Agree a tuk-tuk fare before getting in, or just use the metered taxis and Grab.",
    "Temples enforce the dress code strictly -- covered shoulders and knees, children included.",
  ],
  paris: [
    "Under-18s are free at national museums, including the Louvre and Orsay.",
    "Carnet of 10 metro tickets, or the Navigo Easy card, beats single fares by a third.",
    "Most museums close on either Monday or Tuesday -- check before you build a day around one.",
  ],
  tokyo: [
    "An IC card (Suica or Pasmo) works on every train, bus and convenience store.",
    "Convenience-store food is genuinely good and costs a fraction of restaurant prices.",
    "Trains stop around midnight and taxis after that are brutally expensive.",
  ],
};
