/* Fish ID + regulations quick-reference (SoCal saltwater). Offline.
   IMPORTANT: limits are a GENERAL reference and change often — the panel shows a prominent
   "verify with CDFW" note + link. ID text is factual; always confirm current limits.
   `emoji` is kept (empty) only because First Mate's species answer still prefixes it; the
   app shows no emoji — the Guides panel uses a line icon. */
'use strict';

export const FISH_ID = [
  { name: 'California Halibut', emoji: '', id: 'Flatfish, both eyes on one side, very large mouth, brown with pale mottling. Ambush the sandy bottom.',
    size: '22" total length', bag: '5 per day south of Pt. Sur', note: 'A true bottom fish — drift live bait or bounce ball on sand flats.' },
  { name: 'Kelp (Calico) Bass', emoji: '', id: 'Olive-brown with pale blotches, stout body. Lives in kelp and structure.',
    size: '14" total length', bag: '5 per day (combined with sand bass)', note: 'Calico + barred + spotted sand bass share one 5-fish limit (no more than 4 barred sand bass).' },
  { name: 'Barred Sand Bass', emoji: '', id: 'Gray-brown with faint dark bars; elongated third dorsal spine. Sandy flats & edges.',
    size: '14" total length', bag: '5 per day (combined), max 4 barred', note: 'Summer spawning aggregations over sand.' },
  { name: 'Spotted Sand Bass', emoji: '', id: 'Dark spots over the whole body; found in bays and harbors.',
    size: '14" total length', bag: '5 per day (combined)', note: 'Common in San Diego / Mission Bay.' },
  { name: 'White Seabass', emoji: '', id: 'Large silvery croaker, faint dark speckling, ridge along the belly. Prized game fish.',
    size: '28" total length', bag: '1 (Mar 15–Jun 15) / 3 otherwise', note: 'Squid is the classic bait. Verify the seasonal 1-fish window.' },
  { name: 'California Yellowtail', emoji: '', id: 'A jack — blue-green back, bright yellow tail, yellow stripe down the side. Hard puller.',
    size: '24" fork length (up to 5 under 24" allowed)', bag: '10 per day', note: 'Fly-lined sardines, surface iron. Confirm current size/bag before keeping.' },
  { name: 'Pacific Barracuda', emoji: '', id: 'Long, slender, silvery; jutting lower jaw and sharp teeth.',
    size: '28" total length', bag: '10 per day (within the 20-fish general limit)', note: 'Fast strike on iron and surface baits.' },
  { name: 'Pacific Bonito', emoji: '', id: 'Tuna-shaped, with dark oblique stripes on the back. Great fighters.',
    size: '24" fork length or 5 lb (up to 5 smaller allowed)', bag: '10 per day', note: 'Often mixed with barracuda and mackerel schools.' },
  { name: 'California Sheephead', emoji: '', id: 'Males: black head/tail, red middle, white chin, blunt forehead. Females: dull pink.',
    size: '12" total length', bag: '2 per day', note: 'Reef fish. Boat-based anglers: open Mar 1–Dec 31 in 2026 (shore anglers and divers year-round) — check the season.' },
  { name: 'Rockfish (RCG complex)', emoji: '', id: 'Dozens of species — spiny, big-eyed, colors from olive to bright orange/red. Live on rock/reef.',
    size: 'Species-dependent', bag: '10 per day (combined RCG)', note: 'SEASONAL DEPTH CLOSURES apply — always check CDFW before dropping.' },
  { name: 'Lingcod', emoji: '', id: 'Large mottled head and mouth, elongate body; ambush predator on rocky reefs.',
    size: '22" total length', bag: '2 per day', note: 'Often eats a hooked rockfish on the way up.' },
  { name: 'Bocaccio', emoji: '', id: 'Rockfish with a large mouth and projecting lower jaw; orange-brown to olive.',
    size: 'Part of RCG complex', bag: 'Counts in the 10-fish rockfish limit', note: 'Rebuilt stock — good numbers offshore.' },
  { name: 'Ocean Whitefish', emoji: '', id: 'Elongate, yellowish-tan, one long low dorsal fin. Around rock and hard bottom.',
    size: 'No minimum', bag: '10 per day (within the 20-fish general limit)', note: 'Common Channel Islands bonus fish.' },
  { name: 'California Corbina', emoji: '', id: 'Surf fish — slender, silvery, single small barbel under the chin. Roots for sand crabs.',
    size: 'No minimum', bag: '10 per day (within the 20-fish general limit)', note: 'Sight-fish the wash with sand crabs / Gulp.' },
  { name: 'Dorado (Dolphinfish)', emoji: '', id: 'Brilliant green-gold-blue; males have a tall blunt forehead. Warm-water pelagic.',
    size: 'No state minimum', bag: '10 per day (within the 20-fish general limit)', note: 'Shows in warm years around kelp paddies and buoys.' },
  { name: 'Bluefin / Yellowfin Tuna', emoji: '', id: 'Football-shaped, metallic blue-black back; yellow finlets. Offshore speedsters.',
    size: 'No state minimum', bag: '2 bluefin per day (on top of the 20-fish limit); other tunas 10', note: 'Highly-migratory-species rules apply — verify NOAA/CDFW HMS limits.' },
];

export const CDFW_URL = 'https://wildlife.ca.gov/Fishing/Ocean/Regulations/Sport-Fishing';

/* When every size/bag above was last checked against CDFW (Southern region, Pt. Conception to
   Mexico), and against what:
   - wildlife.ca.gov/Fishing/Ocean/Regulations/Fishing-Map/Southern (updated Oct 2, 2026): halibut,
     the basses (incl. the 4 barred sand bass sub-limit), white seabass, yellowtail, sheephead
     (and its boat-based season), ocean whitefish
   - wildlife.ca.gov/Regions/Marine/FAQ/…what-are-the-sport-regulations… (updated Feb 13, 2025) and
     14 CCR §28.25 / §28.32 / §27.60(a) / §28.38: barracuda, bonito, corbina, dolphinfish, tunas
   - wildlife.ca.gov/Fishing/Ocean/Regulations/Groundfish-Summary (updated Jun 23, 2026): RCG
     complex, lingcod, bocaccio
   A number that can't be verified is replaced by "see CDFW", never guessed. Shown beside the
   limits (Guides) so nobody reads them as current forever. */
export const FISH_REGS_AS_OF = 'Oct 27, 2026';
export const FISH_REGS_AS_OF_TEXT = 'Limits checked against CDFW on ' + FISH_REGS_AS_OF + ' — rules change, check CDFW before keeping a fish.';

/* The regulations disclaimer, word-for-word from the legacy panel (its warning emoji
   removed). The Fish & limits tab shows it FIRST and never collapses it; LINK is the part
   that opens CDFW_URL outside the app, never in place of it (see openRegs in GuidesPanel). */
export const FISH_REG_WARN = {
  before: 'Limits change often and vary by area & season. This is a general reference only — ',
  link: 'tap for official CDFW regulations',
  after: ' before keeping any fish.',
};

/* renderFishId() used to build #fishid-list once on the first open of the Guides panel. The
   list is React now (features/guides/GuidesPanel.tsx), with the disclaimer above pinned first. */
