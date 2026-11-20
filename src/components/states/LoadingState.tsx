import { Skeleton } from 'antd';

export interface LoadingStateProps {
  rows?: number;
  tip?: string;
}

export function LoadingState({ rows = 3, tip }: LoadingStateProps) {
  return (
    <div className="state-panel state-panel--compact" role="status" aria-live="polite">
      <div style={{ width: '100%' }}>
        <Skeleton active title={{ width: '38%' }} paragraph={{ rows }} />
      </div>
      {tip ? <p className="state-panel__desc">{tip}</p> : null}
    </div>
  );
}
