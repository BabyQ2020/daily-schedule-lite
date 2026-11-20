import type { ReactNode } from 'react';

export interface PageContainerProps {
  title: string;
  description?: string;
  extra?: ReactNode;
  children: ReactNode;
}

/** 页面骨架：统一标题层级、间距与右上角动作区。 */
export function PageContainer({ title, description, extra, children }: PageContainerProps) {
  return (
    <div className="page-stack">
      <header className="page-head">
        <div>
          <h1 className="page-head__title">{title}</h1>
          {description ? <p className="page-head__desc">{description}</p> : null}
        </div>
        {extra ? <div className="page-head__extra">{extra}</div> : null}
      </header>
      {children}
    </div>
  );
}
