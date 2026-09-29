/**
 * A multi-line writing box with the rich-text toolbar above it. Stores Markdown (lib/markdown.ts).
 *
 * With `attachments`, it also has Photo / File / Link buttons: each one is queued (sent once the
 * posting exists) and placed in the text at the cursor, so it shows where it was put.
 */
import type { TextInputProps } from 'react-native';
import { AttachmentAdder, PendingList, pendingToken, type PendingAttachment } from './Attachments';
import { FormatBar, useRichInput } from './FormatBar';
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
      <Input label={label} value={value} onChangeText={onChangeText} multiline {...inputProps} {...props} />
      {attachments && (
        <>
          <PendingList
            items={attachments.pending}
            onRemove={(key) => {
              const p = attachments.pending.find((x) => x.key === key);
              if (p?.ref) removeText(pendingToken(p));
              attachments.onChange(attachments.pending.filter((x) => x.key !== key));
            }}
          />
          <AttachmentAdder
            onQueued={(p) => {
              insertBlock(pendingToken(p));
              attachments.onChange([...attachments.pending, p]);
            }}
          />
        </>
      )}
    </>
  );
}
