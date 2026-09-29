/** A multi-line writing box with the rich-text toolbar above it. Stores Markdown (lib/markdown.ts). */
import type { TextInputProps } from 'react-native';
import { FormatBar, useRichInput } from './FormatBar';
import { Input } from './ui';

export function RichInput({
  label,
  value,
  onChangeText,
  ...props
}: Omit<TextInputProps, 'value' | 'onChangeText'> & { label?: string; value: string; onChangeText: (v: string) => void }) {
  const { inputProps, format } = useRichInput(value, onChangeText);
  return (
    <>
      <FormatBar onFormat={format} />
      <Input label={label} value={value} onChangeText={onChangeText} multiline {...inputProps} {...props} />
    </>
  );
}
