import { Button, Popconfirm } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';

import type { Report } from '@/domain/types';

interface ReportVersionListProps {
  versions: Report[];
  selectedId: string | null;
  onSelect: (report: Report) => void;
  onDelete: (report: Report) => void;
}

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 同一周期下的报告版本列表：草稿与快照都可能存在多条。 */
export function ReportVersionList({
  versions,
  selectedId,
  onSelect,
  onDelete,
}: ReportVersionListProps) {
  if (versions.length === 0) {
    return <p className="list-hint">本期还没有版本记录。</p>;
  }

  return (
    <ul className="version-list">
      {versions.map((report) => {
        const active = report.id === selectedId;
        return (
          <li
            key={report.id}
            className={active ? 'version-list__item is-active' : 'version-list__item'}
          >
            <button type="button" className="version-list__main" onClick={() => onSelect(report)}>
              <span className="version-list__title">
                v{report.version}
                {report.isSnapshot ? <span className="version-list__badge">快照</span> : null}
                {report.isEdited ? <span className="version-list__badge">已编辑</span> : null}
              </span>
              <span className="version-list__meta">{formatGeneratedAt(report.generatedAt)}</span>
            </button>
            <Popconfirm
              title="删除这个版本？"
              description="删除后不可恢复，其他版本不受影响。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => onDelete(report)}
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                aria-label={`删除版本 v${report.version}`}
              />
            </Popconfirm>
          </li>
        );
      })}
    </ul>
  );
}
