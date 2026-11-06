import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/use-i18n";
import { downloadsQuery } from "@/lib/downloads";
import { DownloadFilters } from "@/screens/downloads/DownloadFilters";
import { DownloadTabPanel } from "@/screens/downloads/DownloadTabPanel";
import { ACTIVE_TAB, DOWNLOAD_TABS, matchesFilter, rowsOfTab, type SortOrder } from "@/screens/downloads/download-list";
import { storedDensity, storedSort, storeDensity, storeSort } from "@/screens/downloads/preferences";

export function Downloads() {
  const { t } = useI18n();
  const query = useQuery(downloadsQuery);
  const [openTab, setOpenTab] = useState(ACTIVE_TAB.id);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState(storedSort);
  const [isDense, setIsDense] = useState(storedDensity);

  const filteredRows = (query.data ?? []).filter((download) => matchesFilter(download, filter));

  const handleSortChange = (order: SortOrder) => {
    setSort(order);
    storeSort(order);
  };

  const handleDensityToggle = () => {
    setIsDense(!isDense);
    storeDensity(!isDense);
  };

  return (
    <div className="flex flex-col gap-4">
      <DownloadFilters
        filter={filter}
        onFilterChange={setFilter}
        sort={sort}
        onSortChange={handleSortChange}
        isDense={isDense}
        onDensityToggle={handleDensityToggle}
      />
      <Tabs value={openTab} onValueChange={setOpenTab}>
        <TabsList className="max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
          {DOWNLOAD_TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="flex-none">
              {t(tab.labelKey)}{" "}
              {query.data && <span className="tabular-nums opacity-70">{rowsOfTab(filteredRows, tab).length}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        {DOWNLOAD_TABS.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="pt-2">
            <DownloadTabPanel
              tab={tab}
              rows={rowsOfTab(filteredRows, tab)}
              query={query}
              isFiltered={filter.trim() !== ""}
              sort={sort}
              isDense={isDense}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
