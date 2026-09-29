/**
 * A multi-line writing box with the rich-text toolbar above it. Stores Markdown (lib/markdown.ts).
 *
 * With `attachments`, it also has Photo / File / Link buttons. Each one goes in the text where the
 * cursor is, shown there as a short stand-in like "[📷 board.png]", with a preview underneath of
 * how the posting will look. Send the text through `placeAttachments` so the stand-ins become the
 * real placements, then send the queued attachments (`sendAll`).
 */
import { View, type TextInputProps } from 'react-native';
import { space } from '../lib/theme';
import { AttachmentAdder, PendingList, withLabel, type PendingAttachment } from './Attachments';
import { FormatBar, useRichInput } from './FormatBar';
import { DraftPreview } from './RichText';
import { Input } from './ui';

export function RichInput({
  label,
  value,
  onChangeText,
  attachments,
  ...props
}: Omit<TextInputProps, 'value' | 'onChangeText'> & {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  attachments?: { pending: PendingAttachment[]; onChange: (pending: PendingAttachment[]) => void };
}) {
  const { inputProps, format, insertBlock, removeText } = useRichInput(value, onChangeText);
  return (
    <>
      <FormatBar onFormat={format} />
      {attachments && (
        <View style={{ marginBottom: space.sm }}>
          <AttachmentAdder
            compact
            onQueued={(queued) => {
              const p = withLabel(queued, attachments.pending);
              insertBlock(p.label!);
              attachments.onChange([...attachments.pending, p]);
            }}
          />
        </View>
      )}
      <Input label={label} value={value} onChangeText={onChangeText} multiline {...inputProps} {...props} />
      {attachments && (
        <>
          <PendingList
            items={attachments.pending}
            onRemove={(key) => {
              const p = attachments.pending.find((x) => x.key === key);
              if (p?.label) removeText(p.label);
              attachments.onChange(attachments.pending.filter((x) => x.key !== key));
            }}
          />
          <DraftPreview text={value} pending={attachments.pending} />
        </>
      )}
    </>
  );
}
