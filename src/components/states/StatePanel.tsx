import type { ReactNode } from 'react';

export type StatePanelTone = 'neutral' | 'error';

export interface StatePanelProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  tone?: StatePanelTone;
  compact?: boolean;
}

/**
 * 统一状态面板：空状态、错误状态共用同一骨架，保证七页视觉与语义一致。
 */
export function StatePanel({
  title,
  description,
  icon,
  actions,
  tone = 'neutral',
  compact = false,
}: StatePanelProps) {
  const className = [
    'state-panel',
    tone === 'error' ? 'state-panel--error' : '',
    compact ? 'state-panel--compact' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} role={tone === 'error' ? 'alert' : 'status'}>
      {icon ? <div className="state-panel__icon">{icon}</div> : null}
      <h3 className="state-panel__title">{title}</h3>
      {description ? <p className="state-panel__desc">{description}</p> : null}
      {actions ? <div className="state-panel__actions">{actions}</div> : null}
    </div>
  );
}
