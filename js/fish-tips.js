/* First Mate fishing knowledge base — lures, jigs, baits, techniques and area
   tips for Southern & Central California saltwater. Offline, factual, general
   reference (fish move with conditions; nothing here is a guarantee).
   Species `name` fields mirror fish-id.js so the assistant can cross-reference
   regs. `aka` adds nicknames for matching free-text questions. */
'use strict';

const FISH_TIPS = [
  {
    name: 'Kelp (Calico) Bass', aka: ['calico', 'calicos', 'kelp bass', 'calico bass', 'bass'],
    lures: 'Weedless swimbaits (5–7" MC/Big Hammer/Keitech on a 3/8–1 oz leadhead), surface iron (Tady 45, Salas 7X light) at gray light, and hard jerkbaits worked over the kelp.',
    baits: 'Fly-lined or lightly-weighted live sardines and greenback mackerel; live squid when it shows.',
    method: 'Cast INTO the kelp stringers and boiler rocks and swim the bait out. Set hard and pull them away from the structure fast — give a calico slack and he\'s back in the kelp and gone.',
    where: 'Kelp beds, boiler rocks, breakwalls and hard structure, ~5–60 ft.',
    when: 'All year; best late spring through fall. First light and the squid spawn are prime.',
    sum: 'swimbaits & surface iron on the kelp edges; fly-lined sardines; set hard and pull them out of the stringers.',
    areas: { catalina: 'The Catalina front side (Avalon to the isthmus) is wall-to-wall calico structure.', 'palos verdes': 'PV cobble and kelp holds quality calicos.' },
  },
  {
    name: 'Barred Sand Bass', aka: ['sand bass', 'barred sand bass', 'sandies', 'grumpy'],
    lures: 'Leadhead + double-tail grub or swimbait bounced on the bottom; dropper-loop rig with a squid strip.',
    baits: 'Fresh dead or live squid on a dropper loop; live sardines near the bottom.',
    method: 'Find the summer sand-bass boil (big bottom-meter marks over open sand), anchor or drift and work baits right on the sand. Slow, ticking-the-bottom retrieve.',
    where: 'Open sand flats and edges, 60–130 ft, near structure transitions.',
    when: 'Summer spawning aggregations (June–Aug) are the classic; flats fish.',
    sum: 'dropper-loop squid or leadhead grubs on open sand flats 60–130 ft; find the summer boil.',
    areas: { 'huntington flats': 'The Huntington/Belmont flats are the famous summer sand-bass grounds.', 'santa monica bay': 'Santa Monica Bay flats hold summer sandies.' },
  },
  {
    name: 'Spotted Sand Bass', aka: ['spotted bay bass', 'spotty', 'spotties', 'bay bass'],
    lures: 'Small swimbaits and dart-head plastics, spinnerbaits, and Carolina-rigged creature baits bounced on the bottom.',
    baits: 'Live ghost shrimp, live sardines, cut squid.',
    method: 'Bay and harbor structure fish — work eelgrass edges, rock riprap, dock pilings and drop-offs on a slow bottom-contact retrieve. Largely catch-and-release.',
    where: 'Bays, harbors, eelgrass and riprap, 5–30 ft.',
    when: 'All year; best spring–fall on warming tides.',
    sum: 'dart-head plastics & Carolina rigs on bay riprap/eelgrass; slow bottom retrieve; mostly C&R.',
    areas: { 'san diego bay': 'San Diego and Mission Bay are the premier spotty fisheries.', 'mission bay': 'Mission Bay riprap and eelgrass edges.' },
  },
  {
    name: 'White Seabass', aka: ['white seabass', 'wsb', 'seabass', 'croaker', 'ghost'],
    lures: 'Surface iron (Tady 45, Salas 6X/7X) at gray light; heavy leadhead + big swimbait; glow/white jigs on the squid grounds.',
    baits: 'Live squid is the classic — fly-lined or on a dropper loop near the bottom; also live mackerel.',
    method: 'Fish the squid nests and hard structure at first light and after dark. Dead-stick a fly-lined squid; on iron, slow-wind a surface jig through the meter marks. They come in grade — be patient and quiet.',
    where: 'Kelp edges, hard bottom and squid grounds, 40–150 ft.',
    when: 'Spring the peak (watch the Mar 15–Jun 15 one-fish window); best on a squid spawn and a grunion/moon phase.',
    sum: 'live squid fly-lined or on a dropper; surface iron at gray light on the squid grounds; be quiet, they grade.',
    areas: { catalina: 'Catalina and the Channel Islands squid grounds are prime WSB.', 'channel islands': 'The Channel Islands (Santa Cruz, Santa Rosa) are big-WSB country.' },
  },
  {
    name: 'California Yellowtail', aka: ['yellowtail', 'yellows', 'yt', 'forktail', 'mossback'],
    lures: 'Yo-yo iron (Tady 4/0, Salas 6X or 7X heavy) cranked fast off the bottom; surface iron over boils; heavy knife jigs.',
    baits: 'Fly-lined live sardines and mackerel; a live squid on a dropper loop for deep fish.',
    method: 'On a meter mark or hard structure, drop the yo-yo iron to the bottom and wind FAST straight up. On the surface, fan-cast the boils. Point the rod and pull hard — they\'ll bury you in the structure.',
    where: 'Hard structure, ridges, kelp paddies and the islands, 30–200 ft.',
    when: 'Spring through fall; best on warm water and squid. Kelp-paddy fish show offshore in summer.',
    sum: 'yo-yo iron wound fast off the bottom, or fly-lined sardines; fish structure & paddies; pull hard.',
    areas: { catalina: 'Catalina\'s west end, the ridge and the boiler rocks are classic yellowtail.', 'coronado islands': 'The Coronado Islands (Mexico, needs a permit) are a yellowtail staple.' },
  },
  {
    name: 'Pacific Barracuda', aka: ['barracuda', 'barries', 'scoots', 'logs', 'snakes'],
    lures: 'Chrome/blue surface iron (Tady 45), fast-moving swimbaits, and any flashy jig ripped near the top.',
    baits: 'Fly-lined sardines; they\'ll chew line, so a short piece of light wire or a long-shank hook helps.',
    method: 'Fish schools near the surface — reel FAST, barracuda hit a fleeing bait. Watch for jaw-scarred line.',
    where: 'Upper water column near bait schools, kelp lines, 0–40 ft.',
    when: 'Spring–fall on warm water; often mixed with bonito and mackerel.',
    sum: 'fast surface iron & swimbaits reeled quick; fly-lined sardines; mind the teeth on your line.',
    areas: {},
  },
  {
    name: 'Pacific Bonito', aka: ['bonito', 'bonies', 'boneheads'],
    lures: 'Small chrome jigs and spoons, bonito splashers with a feather/hoochie trailer, small surface iron.',
    baits: 'Small fly-lined sardines or anchovies; they hit fast movers.',
    method: 'Fast retrieve through breaking schools. A splasher rig 4–6 ft ahead of a small feather is deadly. Great light-tackle and eating fish (bleed it).',
    where: 'Open water and warm-water outfalls, harbor mouths, 0–30 ft.',
    when: 'Warm-water periods; classic around power-plant outfalls and harbor entrances.',
    sum: 'small chrome jigs / splasher-and-feather ripped through the schools; bleed them for the table.',
    areas: {},
  },
  {
    name: 'California Sheephead', aka: ['sheephead', 'sheepie', 'goat'],
    lures: 'Leadhead + plastic or a small jig tipped with bait on the bottom.',
    baits: 'Live or fresh dead shrimp, squid, crab and mussel — they crush shellfish with those teeth.',
    method: 'Drop straight down on rocky reef and hold bottom. They inhale bait and rock you — lock up and lift.',
    where: 'Rocky reef and boiler rocks, 20–120 ft.',
    when: 'All year; reef fish (note reduced limits — verify).',
    sum: 'shrimp/squid/crab on a leadhead straight down on rocky reef; lift fast before they rock you.',
    areas: {},
  },
  {
    name: 'Rockfish (RCG complex)', aka: ['rockfish', 'rockcod', 'reds', 'chuckleheads', 'vermillion', 'gopher', 'coppers'],
    lures: 'Shrimp flies / gangions (2–3 hook), heavy jigs (Diamond jig, scampi shad), glow-bead dropper rigs; 6–16 oz to hold bottom.',
    baits: 'Squid strips, cut mackerel or sardine on the gangion; a whole squid for the bigger reds.',
    method: 'Drop to a rocky high spot, hit bottom, crank up a couple turns so you don\'t snag, and lift-drop. Reel steady on the way up — a lingcod often grabs your hooked rockfish.',
    where: 'Rocky reef and hard bottom, 100–400+ ft (mind depth closures).',
    when: 'Season and depth limits change yearly — ALWAYS check CDFW before dropping.',
    sum: 'shrimp-fly gangions or heavy jigs on rocky high spots; hold bottom, lift-drop; watch depth closures.',
    areas: { 'channel islands': 'The Channel Islands and offshore banks (e.g. the 43-fathom, Cortes) are loaded with quality reds.' },
  },
  {
    name: 'Lingcod', aka: ['lingcod', 'ling', 'lings'],
    lures: 'Big swimbaits (7–9") on a heavy leadhead, large metal jigs, and shrimp-fly rigs — they eat a hooked rockfish too.',
    baits: 'Whole live or dead sanddab, small rockfish, or a big squid.',
    method: 'Work rocky pinnacles and high spots. Slow lift-drop with a big offering; when a hooked rockfish suddenly gets heavy, keep steady pressure — a ling is chewing it, gaff-ready.',
    where: 'Rocky reef, pinnacles, 60–350 ft.',
    when: 'Best fall–winter–spring; verify open season.',
    sum: 'big swimbaits/jigs on rocky pinnacles; a ling will grab your hooked rockfish — keep steady pressure.',
    areas: {},
  },
  {
    name: 'California Halibut', aka: ['halibut', 'hali', 'flatty', 'flattie', 'butt'],
    lures: 'Drift a big swimbait (Big Hammer, MC) on a 3/4–2 oz leadhead scraping the sand; bounce-ball a plastic; Carolina-rigged grub.',
    baits: 'Live sardine, smelt or a big anchovy on a Carolina/fish-finder rig, dragged slowly on the sand.',
    method: 'Drift sandy flats and channel edges near structure. Keep contact with the bottom. On the bite, DROP BACK and let him chew — halibut clamp then swallow — then swing.',
    where: 'Sand flats, drop-offs and channel mouths, 10–120 ft.',
    when: 'All year; spring–summer best on the flats. Grunion runs pull them shallow.',
    sum: 'drift a swimbait or live bait right on the sand; drop back and let them chew before you swing.',
    areas: { 'santa monica bay': 'Santa Monica Bay flats are a top halibut drift.', 'san diego bay': 'San Diego Bay is a well-known halibut nursery (mind size limits).' },
  },
  {
    name: 'Ocean Whitefish', aka: ['whitefish', 'ocean whitefish'],
    lures: 'Leadhead + plastic or a shrimp fly tipped with squid on the bottom.',
    baits: 'Squid strip or cut bait on a dropper.',
    method: 'A reliable bonus fish over hard bottom at the islands — drop bait to the bottom and lift-drop.',
    where: 'Hard bottom and reef, 80–250 ft.',
    when: 'All year at the islands.',
    sum: 'squid-tipped leadheads on hard bottom; a dependable island bonus fish.',
    areas: { catalina: 'Common all around Catalina hard bottom.' },
  },
  {
    name: 'California Corbina', aka: ['corbina', 'corbies'],
    lures: 'Gulp sandworm/shrimp on a Carolina rig; small dart-head plastics in the wash.',
    baits: 'Live sand crabs (soft, molting ones are gold), fresh mussel, bloodworm.',
    method: 'A surf sight-fishing game — walk the beach at low-to-incoming tide, spot them rooting in the wash, and lead them with a sand crab on a light Carolina rig. Long soft rod, light line.',
    where: 'The surf zone and troughs, right in the wash, 0–6 ft.',
    when: 'Summer best; low-light and clean-but-not-flat surf.',
    sum: 'sight-fish the wash with live sand crabs on a light Carolina rig; lead the fish, stay stealthy.',
    areas: {},
  },
  {
    name: 'Dorado (Dolphinfish)', aka: ['dorado', 'dolphinfish', 'mahi', 'mahi mahi'],
    lures: 'Small surface iron, poppers and cedar plugs; a fly-lined bait pitched to the paddy.',
    baits: 'Fly-lined live sardines pitched right at a kelp paddy or buoy.',
    method: 'Warm-water pelagic — run and gun to kelp paddies and floating debris, pitch a bait, and keep one hooked fish in the water to hold the school while you cast the rest.',
    where: 'Offshore around kelp paddies, buoys and debris, surface.',
    when: 'Warm years, late summer–fall.',
    sum: 'find a kelp paddy, pitch fly-lined sardines; keep a hooked fish in the water to hold the school.',
    areas: {},
  },
  {
    name: 'Bluefin / Yellowfin Tuna', aka: ['tuna', 'bluefin', 'bft', 'yellowfin', 'yft', 'ahi', 'football', 'cow'],
    lures: 'Flat-fall/knife jigs (day & night) dropped to the meter mark; surface poppers/stickbaits for foamers; sinker rig / bomb for deep bluefin; small fly-lined baits on light fluoro.',
    baits: 'Fly-lined sardines on light fluorocarbon; a live mackerel or sinker-rigged bait for big bluefin.',
    method: 'Look for meter marks, foamers, spots of bird and breezing fish. Match the grade of line to the fish — big bluefin want long, quiet drifts on fluoro, or a flat-fall dropped into the mark and ripped up. Night flat-fall on the glow is deadly.',
    where: 'Offshore, surface to 300+ ft on the marks.',
    when: 'Summer–fall (bluefin now show much of the year); sonar/meter game.',
    sum: 'flat-fall jigs into the meter marks + light-fluoro fly-lined baits; long quiet drifts for big bluefin.',
    areas: {},
  },
];

/* Named-area game plans (Southern & Central CA). Keyed by lowercase substrings. */
const AREA_TIPS = [
  { keys: ['catalina', 'avalon', 'two harbors', 'isthmus'], name: 'Catalina Island',
    text: 'Front side (Avalon→isthmus) is calico & yellowtail structure — swimbaits and surface iron on the kelp and boiler rocks. West end, the ridge and boilers for yellowtail on the yo-yo iron. Squid grounds hold white seabass at gray light. Whitefish and sheephead on the hard bottom.' },
  { keys: ['palos verdes', ' pv ', 'point vicente', 'lunada'], name: 'Palos Verdes',
    text: 'Cobble, kelp and boiler rock close to the beach — quality calicos on swimbaits, sheephead and whitefish on the bottom, and yellowtail when the water\'s warm. Barracuda and bonito up top.' },
  { keys: ['santa monica bay', 'malibu', 'redondo', 'marina del rey'], name: 'Santa Monica Bay',
    text: 'Sand flats for halibut (drift swimbaits/live bait) and summer sand bass on the boils; rockfish on the hard bottom out deep; barracuda/bonito on the surface in warm water.' },
  { keys: ['huntington', 'belmont', 'the flats'], name: 'Huntington / Belmont Flats',
    text: 'The classic summer barred-sand-bass grounds — dropper-loop squid and leadhead grubs on the open sand 60–130 ft when the boil shows. Halibut on the drift.' },
  { keys: ['san diego', 'point loma', 'coronado islands', 'la jolla', 'mission bay'], name: 'San Diego',
    text: 'Point Loma kelp for calicos & bonito; La Jolla for yellowtail and (seasonal) WSB; the Coronado Islands (Mexico permit) for yellowtail on the iron and sardines; San Diego/Mission Bay for spotted bay bass and halibut.' },
  { keys: ['channel islands', 'santa cruz island', 'santa rosa', 'anacapa', 'ventura', 'oxnard'], name: 'Channel Islands',
    text: 'Big-fish country — quality rockfish and lingcod on the reefs, white seabass on the squid grounds, calicos on the kelp, and yellowtail/halibut in season. Watch the weather in the channel.' },
  { keys: ['morro bay', 'morro', 'los osos', 'estero', 'central coast', 'port san luis', 'avila'], name: 'Morro Bay / Central Coast',
    text: 'Rockfish and lingcod are the bread and butter on the reefs and pinnacles — shrimp flies and big swimbaits/jigs. Halibut on the sand in the bay, and albacore/tuna offshore in warm years. Cold, fishy water.' },
];

/* Technique glossary — how to actually fish the common SoCal presentations. */
const TECHNIQUE_TIPS = [
  { keys: ['fly line', 'fly-line', 'flyline', 'fly lining'], name: 'Fly-lining',
    text: 'A live bait with NO weight (or a tiny rubber-core sinker) so it swims naturally. Light fluorocarbon, a small ideally-live-matched hook through the nose or collar, and let it swim away from the boat. The go-to for sardines on yellowtail, calico, WSB and tuna.' },
  { keys: ['dropper loop', 'dropper-loop'], name: 'Dropper loop',
    text: 'Torpedo/bank sinker on the bottom, hook on a loop 12–24" above it. Presents bait just off the bottom for sand bass, white seabass, rockfish and sheephead. Tie a loop knot, pass the loop through the hook eye and over the hook.' },
  { keys: ['yo-yo', 'yoyo', 'yo yo iron'], name: 'Yo-yo iron',
    text: 'A heavy vertical jig (Tady 4/0, Salas 6X/7X heavy). Drop to the bottom or the meter mark and wind straight up FAST. Deadly on yellowtail and bottom fish holding on structure.' },
  { keys: ['surface iron', 'throwing iron', 'jig stick'], name: 'Surface iron',
    text: 'A lighter, wide jig thrown on a long jig stick and slow-wound just under the surface with a rhythmic sweep. Best at gray light on breezing yellowtail, barracuda, bonito and WSB.' },
  { keys: ['dropper', 'carolina rig', 'fish finder', 'sliding sinker'], name: 'Carolina / fish-finder rig',
    text: 'A sliding egg sinker above a swivel, then a leader to the hook. Lets a halibut or bass pick up the bait without feeling the weight — drag it slowly on the sand.' },
  { keys: ['sabiki', 'bait rig', 'make bait', 'making bait', 'catch bait'], name: 'Making bait (sabiki)',
    text: 'A string of small tinsel/glow hooks (sabiki) jigged through a bait school (marks near the bait barge, kelp or breakwall) to fill the tank with sardines, mackerel or squid before you fish.' },
  { keys: ['flat fall', 'flat-fall', 'flatfall', 'knife jig', 'vertical jig'], name: 'Flat-fall / knife jig',
    text: 'A weighted vertical jig dropped to the meter mark and ripped up with a fast sweep-and-drop; the flutter on the fall gets bit. Primary for meter-mark bluefin (glow at night) and yellowtail.' },
];

/* Look-ups used by the assistant. */
function fishTipsFor(text) {
  const t = (text || '').toLowerCase();
  return FISH_TIPS.find((f) =>
    t.includes(f.name.toLowerCase()) ||
    (f.aka || []).some((a) => new RegExp('\\b' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(t)));
}
function areaTipsFor(text) {
  const t = (text || '').toLowerCase();
  return AREA_TIPS.find((a) => a.keys.some((k) => t.includes(k)));
}
function techniqueTipsFor(text) {
  const t = (text || '').toLowerCase();
  return TECHNIQUE_TIPS.find((tp) => tp.keys.some((k) => t.includes(k)));
}
