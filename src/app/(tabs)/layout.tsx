import TabShell from "@/app/components/TabShell";
import ToastContainer from "@/app/components/ToastContainer";

export default function TabsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen flex-col bg-[#09090f]">
      <TabShell />
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      <ToastContainer />
    </div>
  );
}
