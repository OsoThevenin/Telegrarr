import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/i18n/use-i18n";
import { downloadsQuery } from "@/lib/downloads";
import { DownloadFilters } from "@/screens/downloads/DownloadFilters";
import { DownloadTabPanel } from "@/screens/downloads/DownloadTabPanel";
import { DEFAULT_TAB, HISTORY_TABS, matchesFilter, rowsOfTab, type SortOrder } from "@/screens/downloads/download-list";
import { InProgressSection } from "@/screens/downloads/InProgressSection";
import { storedDensity, storedSort, storeDensity, storeSort } from "@/screens/downloads/preferences";

const route = getRouteApi("/downloads");

export function Downloads() {
  const { t } = useI18n();
  const query = useQuery(downloadsQuery);
  const { tab: openTab = DEFAULT_TAB.id } = route.useSearch();
  const navigate = route.useNavigate();
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState(storedSort);
  const [isDense, setIsDense] = useState(storedDensity);

  const filteredRows = (query.data ?? []).filter((download) => matchesFilter(download, filter));
  const isFiltered = filter.trim() !== "";

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
      <InProgressSection rows={filteredRows} query={query} isFiltered={isFiltered} isDense={isDense} />
      <Tabs className="mt-4" value={openTab} onValueChange={(tab) => void navigate({ search: { tab }, replace: true })}>
        {/* Three equal tabs across a phone, so none drops onto a line of its own. */}
        <TabsList className="w-full group-data-horizontal/tabs:h-auto sm:w-fit sm:group-data-horizontal/tabs:h-auto">
          {HISTORY_TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="min-h-[38px] flex-1 sm:min-h-9 sm:flex-none sm:px-3">
              {t(tab.labelKey)}{" "}
              {query.data && <span className="tabular-nums opacity-70">{rowsOfTab(filteredRows, tab).length}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        {HISTORY_TABS.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="pt-2">
            <DownloadTabPanel
              tab={tab}
              rows={rowsOfTab(filteredRows, tab)}
              query={query}
              isFiltered={isFiltered}
              sort={sort}
              onSortChange={handleSortChange}
              isDense={isDense}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
