import { Funnel } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useI18n } from "@/i18n/use-i18n";
import { isSortOrder, SORT_ORDERS, type SortOrder } from "@/screens/downloads/download-list";

type Props = {
  filter: string;
  onFilterChange: (filter: string) => void;
  sort: SortOrder;
  onSortChange: (sort: SortOrder) => void;
  isDense: boolean;
  onDensityToggle: () => void;
};

/** The top of the page: what narrows and orders En curs and every tab. */
export function DownloadFilters({ filter, onFilterChange, sort, onSortChange, isDense, onDensityToggle }: Props) {
  const { t } = useI18n();

  const handleSortChange = (value: string) => {
    if (isSortOrder(value)) onSortChange(value);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="search"
        className="max-w-sm min-w-32 flex-1"
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
        variant="quiet"
        title={t("dl.density")}
        aria-label={t("dl.density_aria")}
        aria-pressed={isDense}
        onClick={onDensityToggle}
      >
        <Funnel aria-hidden="true" />
        {t("dl.density_label")}
      </Button>
    </div>
  );
}
