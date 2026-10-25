import { Modal } from '../../ui';
import { closeModal } from '../../services/ui';

/* PLACEHOLDER — replaced by the feature port. */
export default function M(_: { data: any }) {
  return <Modal title="Spot" onCancel={() => closeModal()} />;
}
