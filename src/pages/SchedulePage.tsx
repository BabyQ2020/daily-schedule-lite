import { useRef, useState } from 'react';

import { useLiveQuery } from 'dexie-react-hooks';
import { Button, Drawer } from 'antd';

import { LongTasksPanel } from '@/features/long-tasks/LongTasksPanel';
import { ScheduleBoard } from '@/features/schedule/ScheduleBoard';
import type { ISODate } from '@/lib/period';
import { DEFAULT_WEEK_START, toISODate } from '@/lib/period';
import { loadSettings } from '@/services/settings';

/**
 * 日程页（新首页）：左侧普通日程约 7 成宽度，右侧长期任务约 3 成。
 * 两栏各自滚动；窄屏时右栏收进抽屉，避免把日程挤成一条缝。
 */
export function SchedulePage() {
  const settings = useLiveQuery(() => loadSettings(), [], undefined);
  const [selectedDate, setSelectedDate] = useState<ISODate>(() => toISODate(new Date()));
  const [longDrawerOpen, setLongDrawerOpen] = useState(false);
  const leftRef = useRef<HTMLElement>(null);

  const today = toISODate(new Date());
  const weekStart = settings?.weekStart ?? DEFAULT_WEEK_START;

  return (
    <div className="schedule-page">
      <header className="schedule-head">
        <div>
          <h1 className="schedule-head__title">日程</h1>
          <p className="schedule-head__sub">左边按天安排要做的事，右边维护会重复出现的长期任务。</p>
        </div>
        <Button className="schedule-head__mobile" onClick={() => setLongDrawerOpen(true)}>
          长期任务
        </Button>
      </header>

      <div className="schedule-layout">
        <section className="schedule-left" aria-label="普通日程" ref={leftRef}>
          <ScheduleBoard
            selectedDate={selectedDate}
            today={today}
            weekStart={weekStart}
            onSelectDate={setSelectedDate}
            scrollContainerRef={leftRef}
          />
        </section>
        <aside className="schedule-right" aria-label="长期任务">
          <LongTasksPanel today={today} />
        </aside>
      </div>

      {longDrawerOpen ? (
        <Drawer
          title="长期任务"
          placement="right"
          width="min(92vw, 420px)"
          open
          onClose={() => setLongDrawerOpen(false)}
          styles={{ body: { padding: 12 } }}
        >
          <LongTasksPanel today={today} />
        </Drawer>
      ) : null}
    </div>
  );
}
