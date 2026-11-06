import { Pause, Play, Rows3 } from "lucide-react";

import { useQueuePause } from "@/app/use-queue-pause";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useI18n } from "@/i18n/use-i18n";
import { isSortOrder, SORT_ORDERS, type SortOrder } from "@/screens/downloads/download-list";

function PauseAllButton() {
  const { t } = useI18n();
  const { isPaused, isPending, toggle } = useQueuePause();
  const Icon = isPaused ? Play : Pause;

  return (
    <Button variant="outline" disabled={isPaused === undefined || isPending} onClick={toggle}>
      <Icon aria-hidden="true" />
      {isPaused ? t("dl.resume_all") : t("dl.pause_all")}
    </Button>
  );
}

type Props = {
  filter: string;
  onFilterChange: (filter: string) => void;
  sort: SortOrder;
  onSortChange: (sort: SortOrder) => void;
  isDense: boolean;
  onDensityToggle: () => void;
};

/** The top of the page: what narrows every tab, and the queue's own switch. */
export function DownloadFilters({ filter, onFilterChange, sort, onSortChange, isDense, onDensityToggle }: Props) {
  const { t } = useI18n();

  const handleSortChange = (value: string) => {
    if (isSortOrder(value)) onSortChange(value);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="search"
        className="min-w-48 flex-1"
        placeholder={t("dl.filter")}
        aria-label={t("dl.filter")}
        value={filter}
        onChange={(event) => onFilterChange(event.target.value)}
      />
      <NativeSelect aria-label={t("dl.sort")} value={sort} onChange={(event) => handleSortChange(event.target.value)}>
        {SORT_ORDERS.map(({ id, labelKey }) => (
          <NativeSelectOption key={id} value={id}>
            {t(labelKey)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button
        variant="outline"
        size="icon"
        title={t("dl.density")}
        aria-label={t("dl.density_aria")}
        aria-pressed={isDense}
        onClick={onDensityToggle}
      >
        <Rows3 aria-hidden="true" />
      </Button>
      <PauseAllButton />
    </div>
  );
}
