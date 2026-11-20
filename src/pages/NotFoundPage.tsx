import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

import { PageContainer } from '@/components/PageContainer';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <PageContainer title="页面未找到" description="请检查地址，或从左侧导航进入功能页面">
      <Result
        status="404"
        title="找不到该页面"
        subTitle="地址可能输入有误，或该功能尚未提供。"
        extra={
          <Button type="primary" onClick={() => navigate('/')}>
            返回仪表盘
          </Button>
        }
      />
    </PageContainer>
  );
}
