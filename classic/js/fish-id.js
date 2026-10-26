/* Fish ID + regulations quick-reference (SoCal saltwater). Offline.
   IMPORTANT: limits are a GENERAL reference and change often — the panel shows a prominent
   "verify with CDFW" note + link. ID text is factual; always confirm current limits. */
'use strict';

const FISH_ID = [
  { name: 'California Halibut', emoji: '🐟', id: 'Flatfish, both eyes on one side, very large mouth, brown with pale mottling. Ambush the sandy bottom.',
    size: '22" total length', bag: '5 per day', note: 'A true bottom fish — drift live bait or bounce ball on sand flats.' },
  { name: 'Kelp (Calico) Bass', emoji: '🐟', id: 'Olive-brown with pale blotches, stout body. Lives in kelp and structure.',
    size: '14" total length', bag: '5 per day (combined with sand bass)', note: 'Calico + barred + spotted sand bass share one 5-fish limit.' },
  { name: 'Barred Sand Bass', emoji: '🐟', id: 'Gray-brown with faint dark bars; elongated third dorsal spine. Sandy flats & edges.',
    size: '14" total length', bag: '5 per day (combined)', note: 'Summer spawning aggregations over sand.' },
  { name: 'Spotted Sand Bass', emoji: '🐟', id: 'Dark spots over the whole body; found in bays and harbors.',
    size: '14" total length', bag: '5 per day (combined)', note: 'Common in San Diego / Mission Bay.' },
  { name: 'White Seabass', emoji: '🐟', id: 'Large silvery croaker, faint dark speckling, ridge along the belly. Prized game fish.',
    size: '28" total length', bag: '1 (Mar 15–Jun 15) / 3 otherwise', note: 'Squid is the classic bait. Verify the seasonal 1-fish window.' },
  { name: 'California Yellowtail', emoji: '🐟', id: 'A jack — blue-green back, bright yellow tail, yellow stripe down the side. Hard puller.',
    size: 'No minimum', bag: '10 per day', note: 'Fly-lined sardines, surface iron. Confirm current size/bag before keeping.' },
  { name: 'Pacific Barracuda', emoji: '🐟', id: 'Long, slender, silvery; jutting lower jaw and sharp teeth.',
    size: '28" total length', bag: '3 per day', note: 'Fast strike on iron and surface baits.' },
  { name: 'Pacific Bonito', emoji: '🐟', id: 'Tuna-shaped, with dark oblique stripes on the back. Great fighters.',
    size: 'No minimum', bag: 'Check current limits', note: 'Often mixed with barracuda and mackerel schools.' },
  { name: 'California Sheephead', emoji: '🐟', id: 'Males: black head/tail, red middle, white chin, blunt forehead. Females: dull pink.',
    size: '13" total length', bag: '2 per day', note: 'Reef fish — limits were recently reduced, double-check.' },
  { name: 'Rockfish (RCG complex)', emoji: '🐟', id: 'Dozens of species — spiny, big-eyed, colors from olive to bright orange/red. Live on rock/reef.',
    size: 'Species-dependent', bag: '10 per day (combined RCG)', note: 'SEASONAL DEPTH CLOSURES apply — always check CDFW before dropping.' },
  { name: 'Lingcod', emoji: '🐟', id: 'Large mottled head and mouth, elongate body; ambush predator on rocky reefs.',
    size: '22" total length', bag: '2 per day', note: 'Often eats a hooked rockfish on the way up.' },
  { name: 'Bocaccio', emoji: '🐟', id: 'Rockfish with a large mouth and projecting lower jaw; orange-brown to olive.',
    size: 'Part of RCG complex', bag: 'Counts in the 10-fish rockfish limit', note: 'Rebuilt stock — good numbers offshore.' },
  { name: 'Ocean Whitefish', emoji: '🐟', id: 'Elongate, yellowish-tan, one long low dorsal fin. Around rock and hard bottom.',
    size: 'No minimum', bag: 'Check current limits', note: 'Common Channel Islands bonus fish.' },
  { name: 'California Corbina', emoji: '🐟', id: 'Surf fish — slender, silvery, single small barbel under the chin. Roots for sand crabs.',
    size: 'No minimum', bag: '10 per day', note: 'Sight-fish the wash with sand crabs / Gulp.' },
  { name: 'Dorado (Dolphinfish)', emoji: '🐟', id: 'Brilliant green-gold-blue; males have a tall blunt forehead. Warm-water pelagic.',
    size: 'No state minimum', bag: '10 per day', note: 'Shows in warm years around kelp paddies and buoys.' },
  { name: 'Bluefin / Yellowfin Tuna', emoji: '🐟', id: 'Football-shaped, metallic blue-black back; yellow finlets. Offshore speedsters.',
    size: 'Federal HMS rules', bag: '2 bluefin per day (federal)', note: 'Highly-migratory-species rules apply — verify NOAA/CDFW HMS limits.' },
];

const CDFW_URL = 'https://wildlife.ca.gov/Fishing/Ocean/Regulations/Sport-Fishing';

function renderFishId() {
  const box = document.getElementById('fishid-list');
  if (!box || box.dataset.built) return;
  box.dataset.built = '1';
  box.innerHTML =
    '<div class="reg-warn">⚠️ Limits change often and vary by area & season. This is a general reference only — ' +
    '<a href="' + CDFW_URL + '" target="_blank" rel="noopener">tap for official CDFW regulations</a> before keeping any fish.</div>' +
    FISH_ID.map((f, i) =>
      '<div class="knot">' +
        '<button class="knot-head" data-fi="' + i + '">' +
          '<span class="knot-name">' + f.emoji + ' ' + f.name + '</span>' +
          '<span class="knot-use">' + f.size + ' · ' + f.bag + '</span>' +
        '</button>' +
        '<div class="knot-body hidden" id="fi-body-' + i + '">' +
          '<div class="fi-id">' + f.id + '</div>' +
          '<div class="fi-reg"><span>📏 ' + f.size + '</span><span>🪣 ' + f.bag + '</span></div>' +
          (f.note ? '<div class="knot-tip">💡 ' + f.note + '</div>' : '') +
        '</div>' +
      '</div>').join('');
  box.querySelectorAll('.knot-head').forEach((h) => {
    h.onclick = () => {
      const body = document.getElementById('fi-body-' + h.dataset.fi);
      body.classList.toggle('hidden');
      h.classList.toggle('open');
    };
  });
}
