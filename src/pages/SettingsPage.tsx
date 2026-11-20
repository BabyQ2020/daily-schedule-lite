import { PageContainer } from '@/components/PageContainer';
import { BackupCard } from '@/features/system/BackupCard';
import { BackupReminderAlert } from '@/features/system/BackupReminderAlert';
import { ExportCard } from '@/features/system/ExportCard';
import { GeneralSettingsCard } from '@/features/system/GeneralSettingsCard';
import { LongTaskDiagnosticsCard } from '@/features/system/LongTaskDiagnosticsCard';
import { ReportTemplateCard } from '@/features/system/ReportTemplateCard';
import { StorageCard } from '@/features/system/StorageCard';
import { TagManagerCard } from '@/features/system/TagManagerCard';

/** 系统设置：备份恢复、导出、偏好、标签、模板、存储与清空数据。 */
export function SettingsPage() {
  return (
    <PageContainer
      title="系统设置"
      description="数据只保存在本机的 IndexedDB 中。定期导出完整备份，是防止误删与换机丢失的唯一手段。"
    >
      <BackupReminderAlert />
      <BackupCard />

      <div className="settings-grid">
        <GeneralSettingsCard />
        <ExportCard />
      </div>

      <TagManagerCard />
      <ReportTemplateCard />
      <LongTaskDiagnosticsCard />
      <StorageCard />
    </PageContainer>
  );
}
