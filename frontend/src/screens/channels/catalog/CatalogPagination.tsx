import type { MouseEvent } from "react";

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { useI18n } from "@/i18n/use-i18n";
import { pageNumbers } from "@/screens/channels/catalog/catalog";

type Props = {
  page: number;
  total: number;
  onPage: (page: number) => void;
};

/** A link that changes the page in place. The registry's links need an href to take focus. */
const pageTarget = (target: number, isReachable: boolean, onPage: Props["onPage"]) => ({
  href: "#",
  "aria-disabled": isReachable ? undefined : true,
  tabIndex: isReachable ? undefined : -1,
  className: isReachable ? undefined : "pointer-events-none opacity-50",
  onClick: (event: MouseEvent) => {
    event.preventDefault();
    if (isReachable) onPage(target);
  },
});

export function CatalogPagination({ page, total, onPage }: Props) {
  const { t } = useI18n();

  return (
    <Pagination aria-label={t("cat.pages_aria")}>
      <PaginationContent className="flex-wrap justify-center">
        <PaginationItem>
          <PaginationPrevious
            text={t("cat.page_previous")}
            aria-label={t("cat.page_previous_aria")}
            {...pageTarget(page - 1, page > 1, onPage)}
          />
        </PaginationItem>
        {pageNumbers(page, total).map((number, index) => (
          <PaginationItem key={number === "gap" ? `gap-${index}` : number}>
            {number === "gap" ? (
              <PaginationEllipsis />
            ) : (
              <PaginationLink
                isActive={number === page}
                aria-label={t("cat.page_aria", { n: number })}
                {...pageTarget(number, true, onPage)}
              >
                {number}
              </PaginationLink>
            )}
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext
            text={t("cat.page_next")}
            aria-label={t("cat.page_next_aria")}
            {...pageTarget(page + 1, page < total, onPage)}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
