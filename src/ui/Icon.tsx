/* One icon component for the whole app. Line icons on a 24 grid, 1.75 stroke (2 at ≤16px),
 * round caps, currentColor. Emoji are banned from chrome — this is what replaces them.
 * Lucide covers most of the set; the marine-specific glyphs are drawn here in the same style. */
import type { SVGProps } from 'react';
import {
  Activity, Anchor, ArrowDown, ArrowRight, ArrowUp, Ban, BookOpen, Bluetooth, BluetoothOff, Camera, Check,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, CircleDot, Clock, Cloud, CloudDrizzle, CloudFog,
  CloudLightning, CloudOff, CloudRain, CloudSnow, CloudSun, CloudSunRain, Compass, Copy, Crosshair, Download,
  Droplet, Droplets, Ellipsis, ExternalLink, Fish, Flag, Gauge, Image, Info, Keyboard, Layers, LayoutGrid, Link,
  Locate, LocateFixed, Lock, LockOpen, MapPin, MapPinPlus, MessageSquare, Mic, MicOff, Minus, Moon, Navigation,
  Pause, Pencil, Phone, Play, Plus, Power, Radio, RefreshCw, RotateCcw, Route, Ruler, Satellite, Save, Search,
  Send, Settings, Share, Ship, Square, Star, Sun, Sunrise, Sunset, Target, Thermometer, Timer, Trash2,
  TriangleAlert, Undo2, Upload, Volume2, VolumeX, Waves, Wifi, WifiOff, Wind, X, Zap,
  type LucideIcon,
} from 'lucide-react';

type CustomProps = { size: number; strokeWidth: number } & SVGProps<SVGSVGElement>;

function svgBase({ size, strokeWidth, ...rest }: CustomProps) {
  return {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...rest,
  };
}

/* Tide: a wave with a rise/fall arrow above it. */
const Tide = (p: CustomProps) => (
  <svg {...svgBase(p)}>
    <path d="M12 3v8" /><path d="M9 6l3-3 3 3" />
    <path d="M2 16c1.6 0 2.4-1.5 4-1.5S8.4 16 10 16s2.4-1.5 4-1.5 2.4 1.5 4 1.5 2.4-1.5 4-1.5" />
    <path d="M2 20.5c1.6 0 2.4-1.5 4-1.5s2.4 1.5 4 1.5 2.4-1.5 4-1.5 2.4 1.5 4 1.5 2.4-1.5 4-1.5" />
  </svg>
);
/* Propeller (trolling motor): three blades around a hub. */
const Propeller = (p: CustomProps) => (
  <svg {...svgBase(p)}>
    <circle cx="12" cy="12" r="2" />
    <path d="M12 10c-.6-3 .2-6.2 2.6-7 1.6-.5 2.6 1 2 2.4-.8 2-2.8 3.4-4.6 4.6" />
    <path d="M13.7 13c2.9 1 5 3.5 4.5 5.9-.4 1.6-2.2 1.8-3.1.6-1.3-1.7-1.6-4.1-1.4-6.5" />
    <path d="M10.3 13c-2.3 2-5.5 2.8-7.3 1.1-1.2-1.1-.4-2.8 1.1-2.9 2.1-.2 4.4.8 6.2 1.8" />
  </svg>
);
/* Reef: a low mound of structure on the bottom. */
const Reef = (p: CustomProps) => (
  <svg {...svgBase(p)}>
    <path d="M3 20h18" /><path d="M5 20c0-3 1.5-5 3-5s1.5 2 3 2 1-4 3-4 3 3.5 3 7" />
    <path d="M8 15V9" /><path d="M8 11l-2-2" /><path d="M14 13V7" /><path d="M14 9l2-2" />
  </svg>
);
/* Own-ship hull (pointed bow up), used where a boat glyph is needed outside the chart. */
const Hull = (p: CustomProps) => (
  <svg {...svgBase(p)}>
    <path d="M12 2.5c2.6 2.6 4 6 4 10v8.5H8v-8.5c0-4 1.4-7.4 4-10z" />
  </svg>
);
/* Knot: an overhand loop. */
const Knot = (p: CustomProps) => (
  <svg {...svgBase(p)}>
    <path d="M3 17c4 0 6-2.5 7.5-5.5C12 8.5 13 6 15.5 6 18 6 19 8 19 9.5 19 12 16.5 13 14 13c-3 0-4.5-2-6-4" />
    <path d="M14 13c1.5 2 3 4 7 4" />
  </svg>
);
/* Record: ring with a solid centre. */
const Record = (p: CustomProps) => (
  <svg {...svgBase(p)}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" /></svg>
);
/* No fishing: a fish inside a struck-through circle. */
const NoFishing = (p: CustomProps) => (
  <svg {...svgBase(p)}>
    <circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" />
    <path d="M7.5 12c1.4-1.8 3-2.7 4.8-2.7 1.6 0 3 .8 4.2 2.2" />
  </svg>
);

const LUCIDE = {
  activity: Activity, anchor: Anchor, 'arrow-down': ArrowDown, 'arrow-right': ArrowRight, 'arrow-up': ArrowUp,
  ban: Ban, book: BookOpen, bluetooth: Bluetooth, 'bluetooth-off': BluetoothOff, camera: Camera, check: Check,
  'chevron-down': ChevronDown, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight, 'chevron-up': ChevronUp,
  circle: Circle, 'circle-dot': CircleDot, clock: Clock, cloud: Cloud, 'cloud-drizzle': CloudDrizzle, 'cloud-fog': CloudFog,
  'cloud-lightning': CloudLightning, 'cloud-off': CloudOff, 'cloud-rain': CloudRain, 'cloud-snow': CloudSnow,
  'cloud-sun': CloudSun, 'cloud-sun-rain': CloudSunRain, compass: Compass, copy: Copy, crosshair: Crosshair,
  download: Download, drop: Droplet, drops: Droplets, more: Ellipsis, external: ExternalLink, fish: Fish, flag: Flag,
  gauge: Gauge, image: Image, info: Info, keyboard: Keyboard, layers: Layers, grid: LayoutGrid, link: Link,
  locate: Locate, 'locate-fixed': LocateFixed, lock: Lock, unlock: LockOpen, pin: MapPin, 'pin-plus': MapPinPlus,
  message: MessageSquare, mic: Mic, 'mic-off': MicOff, minus: Minus, moon: Moon, navigation: Navigation,
  pause: Pause, pencil: Pencil, phone: Phone, play: Play, plus: Plus, power: Power, radio: Radio, refresh: RefreshCw,
  undo: RotateCcw, route: Route, ruler: Ruler, satellite: Satellite, save: Save, search: Search, send: Send,
  settings: Settings, share: Share, ship: Ship, stop: Square, star: Star, sun: Sun, sunrise: Sunrise, sunset: Sunset,
  target: Target, thermo: Thermometer, timer: Timer, trash: Trash2, alert: TriangleAlert, 'undo-2': Undo2,
  upload: Upload, volume: Volume2, 'volume-x': VolumeX, waves: Waves, wifi: Wifi, 'wifi-off': WifiOff, wind: Wind,
  x: X, zap: Zap,
} satisfies Record<string, LucideIcon>;

const CUSTOM = { tide: Tide, propeller: Propeller, reef: Reef, hull: Hull, knot: Knot, record: Record, 'no-fishing': NoFishing };

export type IconName = keyof typeof LUCIDE | keyof typeof CUSTOM;
export const ICON_NAMES = [...Object.keys(LUCIDE), ...Object.keys(CUSTOM)] as IconName[];

export interface IconProps {
  name: IconName;
  size?: number;
  /** Filled glyph (state, e.g. Follow ON). Lucide icons get fill=currentColor. */
  filled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

export function Icon({ name, size = 20, filled, className, style, title }: IconProps) {
  const strokeWidth = size <= 16 ? 2 : 1.75;
  const cls = 'ui-icon' + (className ? ' ' + className : '');
  const custom = (CUSTOM as Record<string, (p: CustomProps) => React.JSX.Element>)[name];
  if (custom) return custom({ size, strokeWidth, className: cls, style, ...(title ? { role: 'img', 'aria-label': title, 'aria-hidden': undefined } : {}) });
  const Cmp = (LUCIDE as Record<string, LucideIcon>)[name] || Circle;
  return (
    <Cmp size={size} strokeWidth={strokeWidth} absoluteStrokeWidth={false} className={cls} style={style}
      fill={filled ? 'currentColor' : 'none'} aria-hidden={title ? undefined : true} aria-label={title} role={title ? 'img' : undefined} />
  );
}
