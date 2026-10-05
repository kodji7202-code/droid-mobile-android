import { useTranslation } from 'react-i18next';
import type { UserAttachment } from '@droidmobile/daemon-client';

/** Image preview, or a name chip for documents. */
export function AttachmentThumb({ attachment }: { attachment: UserAttachment }) {
  const { t } = useTranslation();
  if (attachment.kind === 'image') {
    return (
      <img
        className="attachment__image"
        src={`data:${attachment.mediaType};base64,${attachment.data}`}
        alt={t('chat.attach.image')}
      />
    );
  }
  return <span className="attachment__file">{attachment.name}</span>;
}
