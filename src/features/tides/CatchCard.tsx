import { MapCard } from '../../shell/MapCard';
import type { CardProps } from '../../shell/registry';

/* PLACEHOLDER — replaced by the feature port. */
export default function Card({ data }: CardProps) {
  return <MapCard eyebrow="Catch" title={String(data?.title ?? data?.name ?? 'Catch')} />;
}
