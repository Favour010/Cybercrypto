/** Realistic pools for generated demo work orders. Fictional organisations and people only. */
export const CUSTOMERS = [
  "Harbour View Apartments",
  "Kingsbridge Medical Centre",
  "Northgate Retail Park",
  "Riverside Primary School",
  "Example Facilities Ltd",
  "Crescent Hotel Group",
  "Oakwood Business Centre",
  "Meridian Logistics Hub",
  "St Anne's Care Home",
  "Parkside Leisure Centre",
  "Brightwater Office Campus",
  "Elm Street Dental Practice",
  "Lakeside Student Residences",
  "Victoria Quay Car Park",
  "Summit Data Centre",
] as const;

export const STREETS = [
  "Quay Road",
  "High Street",
  "Station Approach",
  "Mill Lane",
  "Church Road",
  "Victoria Street",
  "Park Avenue",
  "Kings Way",
  "Bridge Street",
  "Market Square",
] as const;

export const CITIES = [
  "London",
  "Manchester",
  "Leeds",
  "Bristol",
  "Birmingham",
  "Glasgow",
  "Cardiff",
  "Lagos",
] as const;

export const CATEGORIES = [
  "AC Maintenance",
  "Electrical",
  "Plumbing",
  "Fire Safety",
  "Lift Maintenance",
  "General Repairs",
  "Security Systems",
  "Cleaning",
] as const;

export const DESCRIPTIONS: Record<(typeof CATEGORIES)[number], string[]> = {
  "AC Maintenance": [
    "Air conditioning unit requires inspection.",
    "Server room AC unit tripping intermittently.",
    "Annual service of rooftop chiller.",
  ],
  Electrical: [
    "Emergency lighting test failed on level 2.",
    "Distribution board breaker tripping.",
    "Replace faulty external floodlights.",
  ],
  Plumbing: ["Burst pipe in plant room.", "Low water pressure on upper floors.", "Blocked drain in kitchen area."],
  "Fire Safety": [
    "Fire alarm panel showing fault on zone 4.",
    "Quarterly sprinkler inspection due.",
    "Fire door closer broken on stairwell B.",
  ],
  "Lift Maintenance": [
    "Passenger lift stopping between floors.",
    "Lift door sensor not detecting obstruction.",
    "Scheduled lift safety inspection.",
  ],
  "General Repairs": [
    "Broken window latch in reception.",
    "Ceiling tile water damage in corridor.",
    "Replace damaged entrance mat well.",
  ],
  "Security Systems": [
    "CCTV camera offline at loading bay.",
    "Access control reader not accepting cards.",
    "Intruder alarm false activations overnight.",
  ],
  Cleaning: [
    "Deep clean required after refurbishment.",
    "Graffiti removal on east elevation.",
    "Carpet cleaning in meeting rooms.",
  ],
};

export const INSTRUCTIONS = [
  "Inspect the unit and upload photographic evidence.",
  "Report to reception and sign the visitor log.",
  "Isolate supply before starting work.",
  "Access via the rear service entrance.",
  null,
  null,
] as const;

export const TECHNICIANS = ["Technician A", "Technician B", "Ade Okafor", "Priya Shah", "Tom Walsh", null] as const;

export const CONTACT_NAMES = [
  "John Smith",
  "Sarah Lee",
  "Mohammed Ali",
  "Grace Adeyemi",
  "Liam O'Brien",
  "Hannah Kowalski",
] as const;
