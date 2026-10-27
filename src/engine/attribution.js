import L from 'leaflet';

/* The map's credits. The attribution line is a licence requirement (OpenStreetMap, OpenSeaMap,
   Esri, Open-Meteo, MUR SST…), but a phone cannot fit it on one line: the old bar cut it off
   with an ellipsis, hiding providers. This control keeps Leaflet's own bookkeeping (each layer
   adds its credit when shown and removes it when hidden) and only changes how it is drawn:
   - wide screens (the desktop layout): the full text, wrapped if it must be, never cut off;
   - phones: a small "Credits" button just above the zoom keys. A tap opens the full list
     above it, one source per line with live links; another tap, Escape, or a drag or tap on
     the chart closes it.
   The whole map (#map) sits under the shell chrome (z 0), so the credits can never cover the
   HUD or a control. While the list is open on a phone, the room it takes is published as
   --credits-clear on <html>, so the map legends (features/weather), which share its width,
   move up above it instead of hiding it. */
'use strict';

/* The shell's phone layout (ui/useMedia.ts DESKTOP_QUERY is min-width 900px). Mirrored in base.css. */
export const CREDITS_COMPACT_QUERY = '(max-width: 899.98px)';
/* Space kept between the open list and what sits above it (the legend column). */
export const CREDITS_GAP = 10;

function compactNow() {
  try { return !!(window.matchMedia && window.matchMedia(CREDITS_COMPACT_QUERY).matches); } catch (e) { return false; }
}

let _seq = 0;

export const CreditsControl = L.Control.Attribution.extend({
  options: { position: 'bottomright', prefix: false },

  onAdd(map) {
    // Leaflet's onAdd builds the container, collects the credits of layers already on the map
    // and starts listening for new ones; _update below only draws once the parts exist.
    const box = L.Control.Attribution.prototype.onAdd.call(this, map);
    // ...but it only drops a credit on 'remove' for layers added later: cover the earlier ones too
    map.eachLayer((layer) => {
      if (layer.getAttribution && layer.getAttribution()) layer.once('remove', () => this.removeAttribution(layer.getAttribution()));
    });
    box.classList.add('fa-credits');
    L.DomEvent.disableScrollPropagation(box);
    this._open = false;
    this._list = L.DomUtil.create('div', 'fa-credits__text', box);
    this._list.id = 'fa-credits-' + (++_seq);
    const btn = this._toggle = L.DomUtil.create('button', 'fa-credits__toggle', box);
    btn.type = 'button';
    btn.textContent = 'Credits';
    btn.setAttribute('aria-controls', this._list.id);
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Map data credits');
    L.DomEvent.on(btn, 'click', () => this.setOpen(!this._open));
    L.DomEvent.on(box, 'keydown', (e) => {
      if (e.key === 'Escape' && this._open) { this.setOpen(false); btn.focus(); }
    });
    map.on('dragstart click', this._close, this);   // the user went back to the chart
    this._onMedia = () => this._publish();
    window.addEventListener('resize', this._onMedia);
    // the wide line re-wraps when the side panel opens or closes (base.css): re-measure then too
    this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(this._onMedia) : null;
    if (this._ro) this._ro.observe(box);
    this._update();
    return box;
  },

  onRemove(map) {
    L.Control.Attribution.prototype.onRemove.call(this, map);
    map.off('dragstart click', this._close, this);
    window.removeEventListener('resize', this._onMedia);
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    this._open = false;
    this._publish();
  },

  /** Each credit in its own element: a line of its own in the open list, "·"-separated inline. */
  _update() {
    if (!this._map || !this._list) return;
    const items = Object.keys(this._attributions).filter((k) => this._attributions[k] > 0);
    if (this.options.prefix) items.unshift(this.options.prefix);
    this._list.innerHTML = items.map((t) => '<span class="fa-credits__item">' + t + '</span>').join('');
    const empty = !items.length;
    this._container.classList.toggle('is-empty', empty);
    if (empty && this._open) this.setOpen(false);
    else this._publish();
  },

  /** Open or close the full list (phones; on wide screens the full text always shows). */
  setOpen(open) {
    if (!this._container) return this;
    this._open = !!open && !this._container.classList.contains('is-empty');
    this._container.classList.toggle('is-open', this._open);
    this._toggle.setAttribute('aria-expanded', String(this._open));
    this._publish();
    return this;
  },

  isOpen() { return !!this._open; },

  /** The credits currently listed, as plain text. */
  getText() {
    return this._list ? Array.from(this._list.children).map((el) => el.textContent || '') : [];
  },

  _close() { if (this._open) this.setOpen(false); },

  /* Room the credits take above the bottom chrome: on wide screens the whole (always shown) line;
     on a phone the open list (0 when closed, and 0
     when the legend column is on screen beside it rather than above it: a landscape phone,
     where base.css narrows the list to fit right of the column). */
  _publish() {
    let h = 0;
    const box = this._container;
    if (box && box.parentNode && !compactNow()) {   // (detached = the control is being removed)
      /* Wide screens always show the full line, and it wraps to two or three rows when the side
         panel narrows it (base.css) — the legend column beside an open panel then sat on top of
         it. Its height is reserved above the bottom chrome on every wide layout. */
      if (!box.classList.contains('is-empty')) h = Math.ceil(box.getBoundingClientRect().height) + CREDITS_GAP;
    } else if (this._open && box) {
      const r = this._container.getBoundingClientRect();
      const leg = document.querySelector('.wx-legends');
      const lr = leg ? leg.getBoundingClientRect() : null;
      const beside = !!lr && lr.width > 0 && (r.left >= lr.right || r.right <= lr.left);
      if (!beside) h = Math.ceil(r.height) + CREDITS_GAP + 8;   // + the 8 px it sits above the zoom keys
    }
    if (h === this._clear) return;   // the legends re-measure on every style change of <html>
    this._clear = h;
    try { document.documentElement.style.setProperty('--credits-clear', h + 'px'); } catch (e) {}
  },
});

/** Swap the map's stock attribution control for the Credits control. Call once, right after
 *  the map is made and before layers are added (credits already shown are carried over). */
export function creditsInit(map) {
  if (map.attributionControl) map.removeControl(map.attributionControl);
  const ctl = new CreditsControl();
  ctl.addTo(map);
  return ctl;
}
