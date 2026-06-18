export type DetailBackState = {
  from?: string;
  fromLabel?: string;
};

export function detailBackLink(
  state: DetailBackState | null | undefined,
  fallbackHref: string,
  fallbackLabel: string,
): { href: string; label: string } {
  if (state?.from) {
    return { href: state.from, label: state.fromLabel || "Back" };
  }
  return { href: fallbackHref, label: fallbackLabel };
}

export function companyBackState(companyPath: string, ticker?: string | null): DetailBackState {
  const label = ticker ? `Back to ${ticker}` : "Back to company";
  return { from: companyPath, fromLabel: label };
}
