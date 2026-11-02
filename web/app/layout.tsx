import type { Metadata } from "next";
import { Barlow_Condensed, Inter, Roboto_Condensed } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { Nav } from "./nav";
import { Sidebar } from "./sidebar";
import { SidebarLoader } from "./sidebar-loader";

const barlow = Barlow_Condensed({ subsets: ["latin"], weight: ["700", "800"], style: ["normal", "italic"], variable: "--font-barlow" });
const roboto = Roboto_Condensed({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-roboto" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Fantasy Football Rankings",
  description: "Rankings by contributors, plus the Ball Knowers consensus.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${barlow.variable} ${roboto.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-black text-white">
        <Suspense fallback={<Suspense><Sidebar isAdmin={false} /></Suspense>}>
          <SidebarLoader />
        </Suspense>
        <div className="flex min-h-screen flex-col pl-16 sm:pl-48">
          <Suspense fallback={<div className="h-[53px] border-b border-zinc-800" />}><Nav /></Suspense>
          {children}
        </div>
      </body>
    </html>
  );
}
