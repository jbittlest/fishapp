/* Schematic knot diagrams (offline SVG). Blue = standing line, orange = tag end,
   grey ring = hook eye, arrows show where the tag goes. Keyed by knot name; each entry
   is an array of { svg, cap } stages. Rendered by knots.js above the text steps. */
'use strict';

const KnotArt = (function () {
  const B = '#4aa3e0', T = '#e8b23d', E = '#9fb3c8', BG = 'rgba(255,255,255,0.04)';
  const svg = (inner) => '<svg viewBox="0 0 240 120" class="knot-svg">' +
    '<rect x="0" y="0" width="240" height="120" rx="8" fill="' + BG + '"/>' + inner + '</svg>';
  const path = (d, c, w) => '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="' + (w || 4) + '" stroke-linecap="round" stroke-linejoin="round"/>';
  const eye = (x, y) => '<circle cx="' + (x || 36) + '" cy="' + (y || 60) + '" r="11" fill="none" stroke="' + E + '" stroke-width="4.5"/>';
  const dot = (x, y, c) => '<circle cx="' + x + '" cy="' + y + '" r="4.5" fill="' + (c || T) + '"/>';
  const hook = (x, y) => path('M ' + x + ' ' + (y - 8) + ' L ' + x + ' ' + (y + 26) + ' q 0 16 16 16 q 14 0 14 -14', E, 4);
  // coil of n bumps along a horizontal run (up = crests over the line)
  function coil(x0, x1, y, n, up) {
    const s = (x1 - x0) / n; let d = 'M ' + x0 + ' ' + y;
    for (let i = 0; i < n; i++) { const a = x0 + s * i, b = x0 + s * (i + 1), m = (a + b) / 2; d += ' Q ' + m + ' ' + (y + (up ? -13 : 13)) + ' ' + b + ' ' + y; }
    return d;
  }
  // arrowhead pointing in direction deg at (x,y)
  function arrow(x, y, deg) {
    const r = (deg || 0) * Math.PI / 180, cx = Math.cos(r), cy = Math.sin(r);
    return path('M ' + (x - 11 * cx - 6 * cy) + ' ' + (y - 11 * cy + 6 * cx) + ' L ' + x + ' ' + y +
      ' L ' + (x - 11 * cx + 6 * cy) + ' ' + (y - 11 * cy - 6 * cx), T, 3.5);
  }
  const L = (d) => path(d, B), Tg = (d) => path(d, T);

  return {
    'Palomar Knot': [
      { svg: svg(eye() + L('M47 55 H150') + L('M47 65 H150') + path('M150 55 a16 10 0 1 0 0 20', B, 4) + dot(150, 75, B)),
        cap: 'Double the line and pass the loop through the eye.' },
      { svg: svg(eye() + L('M47 60 H120') + Tg('M120 60 q30 -30 55 0 q-25 30 -55 0') + Tg('M175 60 h20')),
        cap: 'Tie a loose overhand knot with the doubled line.' },
      { svg: svg(eye() + hook(150, 46) + Tg('M60 60 q40 -34 90 -10') + arrow(150, 50, -30) + L('M47 60 H60')),
        cap: 'Pass the loop down over the whole hook, wet, and pull tight.' },
    ],
    'Improved Clinch Knot': [
      { svg: svg(eye() + L('M47 60 H175') + Tg('M175 60 h18') + arrow(193, 60, 0)),
        cap: 'Pass the line through the eye.' },
      { svg: svg(eye() + L('M47 60 H185') + Tg(coil(90, 175, 60, 6, true)) + Tg('M90 60 q-8 20 6 22')),
        cap: 'Wrap the tag around the standing line 5–7 times.' },
      { svg: svg(eye() + L('M47 60 H185') + Tg(coil(90, 165, 60, 6, true)) + Tg('M78 60 q-6 -16 8 -16 q10 0 8 14') + arrow(94, 58, 250)),
        cap: 'Tag up through the loop by the eye, then back through the big loop.' },
      { svg: svg(eye() + L('M47 60 H150') + Tg(coil(95, 150, 60, 6, true)) + dot(150, 60)),
        cap: 'Wet and snug the coils tight against the eye.' },
    ],
    'Uni Knot (Grinner)': [
      { svg: svg(eye() + L('M47 60 H180') + L('M180 60 q0 -22 -60 -22 H70', B, 4)),
        cap: 'Through the eye, double back parallel to form a loop.' },
      { svg: svg(eye() + L('M47 60 H180') + L('M180 60 q0 -22 -60 -22 H80') + Tg(coil(85, 165, 49, 5, true))),
        cap: 'Wrap the tag through the loop and around both lines 5–6 times.' },
      { svg: svg(eye() + L('M47 60 H150') + Tg(coil(90, 150, 60, 5, true)) + arrow(150, 60, 0)),
        cap: 'Wet, pull the tag to snug the coils, then slide down to the eye.' },
    ],
    'San Diego Jam Knot': [
      { svg: svg(eye() + L('M47 60 H185') + Tg('M185 60 q14 0 14 -16') + arrow(199, 44, 270)),
        cap: 'Through the eye; pull a long tag and hold it beside the line.' },
      { svg: svg(eye() + L('M47 60 H190') + Tg(coil(80, 170, 60, 6, false))),
        cap: 'Wrap the tag UP around both, back toward the eye, 5–7 times.' },
      { svg: svg(eye() + L('M47 60 H170') + Tg(coil(80, 160, 60, 6, false)) + Tg('M70 60 q-6 -14 6 -14') + arrow(78, 48, 250)),
        cap: 'Tag through the loop by the eye, then the big loop. Wet and seat.' },
    ],
    'Non-Slip Loop Knot': [
      { svg: svg(Tg('M40 60 q30 -26 44 0 q-16 22 -30 6') + Tg('M84 60 H150') + arrow(150, 60, 0)),
        cap: 'Tie a loose overhand knot a few inches up the line.' },
      { svg: svg(eye(180, 60) + Tg('M40 60 q30 -26 44 0 q-16 22 -30 6') + Tg('M84 60 H169') + Tg('M191 60 q18 0 -40 -22', T, 3.5)),
        cap: 'Tag through the eye, then back through the overhand loop.' },
      { svg: svg(eye(180, 60) + Tg('M40 60 q30 -26 44 0') + Tg(coil(95, 155, 46, 4, true)) + Tg('M90 40 q-8 8 6 20')),
        cap: 'Wrap the standing line 4–5×, back through the loop, wet & seat.' },
    ],
    'Double Uni Knot': [
      { svg: svg(L('M20 52 H150') + path('M90 68 H220', T, 4)),
        cap: 'Overlap the two line ends.' },
      { svg: svg(L('M20 52 H150') + path('M90 68 H220', T, 4) + Tg(coil(60, 110, 52, 4, true)) + path(coil(150, 200, 68, 4, false), B, 4)),
        cap: 'Tie a uni knot with each tag around the OTHER line.' },
      { svg: svg(L('M20 60 H100') + path('M140 60 H220', T, 4) + Tg(coil(100, 130, 60, 3, true)) + path(coil(110, 140, 60, 3, false), B, 4)),
        cap: 'Wet, then pull the standing lines to slide the knots together.' },
    ],
    'Surgeon’s Knot': [
      { svg: svg(L('M20 54 H160') + path('M80 66 H220', T, 4)),
        cap: 'Lay the line and leader parallel, overlapping.' },
      { svg: svg(path('M30 60 q60 -34 110 0 q-40 26 -80 6', B, 4) + path('M40 60 q60 -30 105 2', T, 3.5) + arrow(150, 60, 20)),
        cap: 'Form a loop with both and pass both ends through it… twice.' },
      { svg: svg(L('M20 60 H100') + path('M140 60 H220', T, 4) + path('M100 60 q20 -18 40 0 q-20 18 0 0', B, 5)),
        cap: 'Wet and pull all four ends tight.' },
    ],
    'Blood Knot': [
      { svg: svg(L('M20 60 H140') + path('M100 60 H220', T, 4)),
        cap: 'Overlap the two lines.' },
      { svg: svg(L('M20 60 H150') + path('M90 60 H220', T, 4) + Tg(coil(105, 150, 60, 4, true)) + path(coil(90, 135, 60, 4, false), B, 4)),
        cap: 'Wrap each tag around the other line 5–6×, back to the middle.' },
      { svg: svg(L('M20 60 H120') + path('M120 60 H220', T, 4) + Tg('M120 60 q0 12 -10 12') + path('M120 60 q0 -12 10 -12', B, 3.5)),
        cap: 'Pass both tags through the centre gap in opposite directions; seat.' },
    ],
    'Dropper Loop': [
      { svg: svg(L('M20 60 H90') + L('M150 60 H220') + L('M90 60 q30 -40 60 0', B, 4)),
        cap: 'Form a loop in the middle of the line.' },
      { svg: svg(L('M20 60 H80') + L('M160 60 H220') + path(coil(80, 160, 60, 6, true), B, 4) + L('M120 60 q0 -34 0 -34 q-14 0 0 34', B, 4)),
        cap: 'Wrap the loop side around 5–6×, keeping an opening in the middle.' },
      { svg: svg(L('M20 60 H90') + L('M150 60 H220') + path(coil(90, 150, 60, 5, true), B, 4) + L('M120 60 q0 -30 0 -30', B, 4) + arrow(120, 30, 270)),
        cap: 'Push the loop up through that opening; hold, wet, and pull tight.' },
    ],
    'Snell Knot': [
      { svg: svg(eye(46, 46) + hook(46, 46) + Tg('M46 60 H150') + arrow(150, 60, 0)),
        cap: 'Tag through the eye and along the shank, leaving a loop.' },
      { svg: svg(eye(46, 46) + hook(46, 46) + Tg('M46 60 H150') + Tg(coil(60, 130, 60, 6, true))),
        cap: 'Wrap the tag around shank + line 6–8×, toward the eye.' },
      { svg: svg(eye(46, 46) + hook(46, 46) + Tg(coil(56, 110, 60, 6, true)) + arrow(150, 60, 0) + Tg('M110 60 H150')),
        cap: 'Pull the standing line to tighten the coils against the shank.' },
    ],
    'Albright Knot': [
      { svg: svg(path('M20 52 q60 0 60 8 q0 8 -60 8', T, 4.5) + L('M200 60 H80') + arrow(80, 60, 180)),
        cap: 'Loop in the heavier leader; pass the lighter line through it.' },
      { svg: svg(path('M20 52 q60 0 60 8 q0 8 -60 8', T, 4.5) + L(coil(80, 175, 60, 8, true))),
        cap: 'Wrap the light line back over itself and both leader strands ~10×.' },
      { svg: svg(path('M20 52 q52 0 52 8 q0 8 -52 8', T, 4.5) + L(coil(72, 150, 60, 7, true)) + L('M150 60 H210') + arrow(210, 60, 0)),
        cap: 'Feed the tag back out the loop, same side; wet and seat.' },
    ],
    'FG Knot': [
      { svg: svg(Tg('M20 60 H220') + L('M120 20 L60 100', B, 4)),
        cap: 'Keep the leader taut; lay the braid across it.' },
      { svg: svg(Tg('M20 60 H220') + L('M60 30 C120 40 120 80 180 90 M180 30 C120 40 120 80 60 90', B, 3)),
        cap: 'Weave the braid over-and-under the leader ~20× in tight coils.' },
      { svg: svg(Tg('M20 60 H160') + L(coil(60, 150, 60, 8, true)) + L('M150 60 q14 0 14 -12') + L('M150 60 q14 0 14 12')),
        cap: 'Lock with half-hitches, trim the leader, finish over the braid.' },
    ],
    'Arbor Knot': [
      { svg: svg('<circle cx="60" cy="60" r="30" fill="none" stroke="' + E + '" stroke-width="5"/>' + L('M60 30 q40 -6 40 30') + L('M100 60 H210') + Tg('M180 60 q12 -14 18 0')),
        cap: 'Line around the spool; overhand knot around the standing line.' },
      { svg: svg('<circle cx="60" cy="60" r="30" fill="none" stroke="' + E + '" stroke-width="5"/>' + L('M60 30 q40 -6 40 30') + L('M100 60 H170') + Tg('M170 60 q10 -12 16 0 q-8 12 -16 0') + Tg('M186 60 q10 -10 14 0 q-6 10 -14 0')),
        cap: 'A second overhand in the tag itself.' },
      { svg: svg('<circle cx="60" cy="60" r="30" fill="none" stroke="' + E + '" stroke-width="5"/>' + L('M60 30 q40 -6 40 30') + L('M100 60 H175') + L('M175 60 q10 -10 16 0 q-8 10 -16 0') + arrow(100, 60, 180)),
        cap: 'Pull — the first knot slides to the spool, the second jams it. Trim.' },
    ],
  };
})();
