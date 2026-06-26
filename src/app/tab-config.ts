/** Central list for the workspace tab bar — add entries here when introducing new tabs. */
export const TABS = [
  { path: "/tab1", label: "Dashboard" },
  { path: "/tab2", label: "Library" },
  { path: "/tab3", label: "Direct Feed" },
] as const;

export type TabConfig = (typeof TABS)[number];
