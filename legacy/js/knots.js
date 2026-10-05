/* Fishing knots reference — step-by-step, fully offline. Tap a knot to expand. */
'use strict';

const KNOTS = [
  {
    name: 'Palomar Knot', use: 'Line → hook / lure / swivel', level: 'Easy · very strong · great for braid',
    steps: [
      'Double about 6 in of line and pass the doubled loop through the hook eye.',
      'Tie a loose overhand knot with the doubled line — the hook hangs from the bottom loop.',
      'Pass that loop down and over the entire hook or lure.',
      'Wet the knot, then pull the standing line and tag together to seat it snug against the eye.',
      'Trim the tag close.',
    ],
    tip: 'One of the strongest, simplest knots — hard to tie wrong.',
  },
  {
    name: 'Improved Clinch Knot', use: 'Line → hook / lure / swivel', level: 'Easy · classic all-rounder',
    steps: [
      'Pass the line through the eye, leaving a 6 in tag.',
      'Wrap the tag around the standing line 5–7 times.',
      'Pass the tag through the small loop right above the eye.',
      'Then pass it back through the big loop you just formed.',
      'Wet it, pull the standing line to tighten, and snug the coils against the eye. Trim.',
    ],
    tip: 'Use 5 wraps for heavy line, 7 for light line.',
  },
  {
    name: 'Uni Knot (Grinner)', use: 'Line → hook / lure', level: 'Easy · versatile',
    steps: [
      'Run the line through the eye and double it back parallel, forming a loop.',
      'Wrap the tag around both lines and through the loop 5–6 times.',
      'Wet it and pull the tag to snug the coils together.',
      'Slide the finished knot down tight to the eye. Trim.',
    ],
    tip: 'The base of the Double Uni for joining lines.',
  },
  {
    name: 'San Diego Jam Knot', use: 'Line → hook / lure', level: 'Easy · SoCal favorite for jigs',
    steps: [
      'Run the line through the eye and pull ~10 in of tag through.',
      'Hold the tag alongside the standing line and wrap it UP around both, 5–7 times, working back toward the eye.',
      'Pass the tag through the small loop by the eye, then through the big loop.',
      'Wet it and pull the standing line to seat the wraps. Trim.',
    ],
    tip: 'Popular on the West Coast for iron/jigs and fluorocarbon.',
  },
  {
    name: 'Non-Slip Loop Knot', use: 'Loop → lure (free action)', level: 'Medium · lets lures swim freely',
    steps: [
      'Tie a loose overhand knot in the line about 4 in from the end.',
      'Pass the tag through the hook eye, then back through the overhand loop.',
      'Wrap the tag around the standing line 4–5 times.',
      'Bring the tag back through the overhand loop, entering the same side it exited.',
      'Wet it, set the loop size, and pull to seat. Trim.',
    ],
    tip: 'The open loop gives plugs and jigs a livelier action than a tight knot.',
  },
  {
    name: 'Double Uni Knot', use: 'Join two lines (mono/braid)', level: 'Medium · reliable line-to-line',
    steps: [
      'Overlap the two line ends by several inches.',
      'With one tag, tie a Uni knot around the other line (5–6 wraps) and snug it.',
      'Repeat with the other tag around the first line.',
      'Wet both, then pull the two standing lines to slide the knots together.',
      'Trim both tags.',
    ],
    tip: 'Use extra wraps (6–7) on braid so it doesn’t slip.',
  },
  {
    name: 'Surgeon’s Knot', use: 'Quick leader join', level: 'Easy · fast line-to-leader',
    steps: [
      'Lay the line and leader parallel, overlapping several inches.',
      'Form a loop with both lines together.',
      'Pass the leader tag and line end through the loop twice (a double overhand).',
      'Wet it and pull all four ends firmly to tighten.',
      'Trim both tags.',
    ],
    tip: 'Great when you need a leader fast — works with different line diameters.',
  },
  {
    name: 'Blood Knot', use: 'Join two similar lines', level: 'Medium · smooth, low-profile',
    steps: [
      'Overlap the two lines.',
      'Wrap one tag around the other line 5–6 times, then bring it back to the center.',
      'Wrap the other tag the opposite way 5–6 times, back to the center.',
      'Pass both tags through the center gap in opposite directions.',
      'Wet it and pull the standing lines to seat. Trim tags.',
    ],
    tip: 'Best for joining lines of similar diameter (e.g., building tapered leaders).',
  },
  {
    name: 'Dropper Loop', use: 'Mid-line loop for droppers', level: 'Medium · for multi-hook / teaser rigs',
    steps: [
      'Form a loop in the middle of the line.',
      'Wrap one side of the loop around the standing line 5–6 times, keeping a small opening in the middle.',
      'Pass the bottom of the loop up through that center opening.',
      'Hold the loop with a finger, wet it, and pull both standing ends apart to seat.',
    ],
    tip: 'Stands out perpendicular to the line — perfect for dropper-loop bait rigs.',
  },
  {
    name: 'Snell Knot', use: 'Line → bait hook', level: 'Medium · max hookup power',
    steps: [
      'Pass the tag through the hook eye and lay it along the shank toward the bend, leaving a loop.',
      'Wrap the tag around the shank and standing line 6–8 times, working toward the eye.',
      'Hold the wraps, then pull the standing line to tighten the coils against the shank.',
      'Seat firmly and trim the tag.',
    ],
    tip: 'Puts a straight-line pull on the hook — strong for bait fishing.',
  },
  {
    name: 'Albright Knot', use: 'Braid → mono/leader', level: 'Medium · joins different diameters',
    steps: [
      'Make a loop in the heavier line/leader.',
      'Pass the lighter line through the loop, then wrap it back over itself and both leader strands ~10 times.',
      'Feed the tag back out through the loop, exiting the same side it entered.',
      'Wet it and pull slowly to seat the wraps. Trim tags.',
    ],
    tip: 'Slides through guides well — good braid-to-leader connection.',
  },
  {
    name: 'FG Knot', use: 'Braid → leader (slim & strong)', level: 'Advanced · thin, high-strength',
    steps: [
      'Keep the leader under tension. Lay the braid across it.',
      'Weave the braid over-and-under the leader ~20 times in tight alternating coils.',
      'Lock the coils with 2–3 half hitches of braid around the leader.',
      'Trim the leader tag, then finish with several half hitches of braid over the standing braid. Trim.',
    ],
    tip: 'The lowest-profile braid-to-leader knot — worth practicing at home first.',
  },
  {
    name: 'Arbor Knot', use: 'Line → reel spool', level: 'Easy · spooling up',
    steps: [
      'Wrap the line around the reel arbor (spool center).',
      'Tie an overhand knot around the standing line.',
      'Tie a second overhand knot in the tag end itself.',
      'Pull the standing line — the first knot slides to the spool and the second jams against it. Trim.',
    ],
    tip: 'Add a strip of tape or backing so braid doesn’t spin on the spool.',
  },
];

/* Illustrated stages if we have diagrams for this knot; otherwise the numbered text steps. */
function knotFramesHtml(k) {
  const frames = (typeof KnotArt !== 'undefined') && KnotArt[k.name];
  if (frames && frames.length) {
    return '<div class="knot-frames">' + frames.map((f, n) =>
      '<div class="knot-frame">' + f.svg +
      '<div class="knot-cap"><b>' + (n + 1) + '.</b> ' + f.cap + '</div></div>').join('') + '</div>';
  }
  return '<ol>' + k.steps.map((s) => '<li>' + s + '</li>').join('') + '</ol>';
}

function renderKnots() {
  const box = document.getElementById('knots-list');
  if (!box || box.dataset.built) return;
  box.dataset.built = '1';
  box.innerHTML = KNOTS.map((k, i) =>
    '<div class="knot">' +
      '<button class="knot-head" data-i="' + i + '">' +
        '<span class="knot-name">🪢 ' + k.name + '</span>' +
        '<span class="knot-use">' + k.use + '</span>' +
      '</button>' +
      '<div class="knot-body hidden" id="knot-body-' + i + '">' +
        '<div class="knot-level">' + k.level + '</div>' +
        knotFramesHtml(k) +
        (k.tip ? '<div class="knot-tip">💡 ' + k.tip + '</div>' : '') +
      '</div>' +
    '</div>').join('');
  box.querySelectorAll('.knot-head').forEach((h) => {
    h.onclick = () => {
      const body = document.getElementById('knot-body-' + h.dataset.i);
      body.classList.toggle('hidden');
      h.classList.toggle('open');
    };
  });
}
