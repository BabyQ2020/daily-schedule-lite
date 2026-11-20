import { Select } from 'antd';

import { TAG_NAME_MAX_LENGTH } from '@/services/tagging';

export interface TagSelectProps {
  value?: string[];
  onChange?: (names: string[]) => void;
  /** 已有标签，作为可选项提示；也允许直接输入新名称。 */
  options: { label: string; value: string }[];
  placeholder?: string;
  disabled?: boolean;
}

/**
 * 标签输入：下拉选择已有标签，或输入新名称回车即建（提交时落库）。
 * 用名称而不是 id 作为值，表单天然可序列化；落库前由 resolveTagIds 统一解析。
 */
export function TagSelect({
  value = [],
  onChange,
  options,
  placeholder = '选择或输入标签，回车确认',
  disabled,
}: TagSelectProps) {
  return (
    <Select
      mode="tags"
      allowClear
      disabled={disabled}
      value={value}
      onChange={(next: string[]) => {
        const cleaned = next
          .map((name) => name.trim().slice(0, TAG_NAME_MAX_LENGTH))
          .filter((name) => name.length > 0);
        onChange?.([...new Set(cleaned)]);
      }}
      options={options}
      placeholder={placeholder}
      tokenSeparators={[',', '，', ' ']}
      maxTagCount="responsive"
      style={{ width: '100%' }}
      aria-label="标签"
    />
  );
}
