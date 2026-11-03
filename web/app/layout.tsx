import type { Metadata } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { Nav } from "./nav";
import { Sidebar } from "./sidebar";
import { SidebarLoader } from "./sidebar-loader";

const barlow = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700", "800"], style: ["normal"], variable: "--font-barlow" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "FantasyForecast",
  description: "FantasyForecast: fantasy football rankings by contributors, plus the Ball Knowers consensus.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${barlow.variable} ${inter.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Suspense fallback={<Suspense><Sidebar isAdmin={false} /></Suspense>}>
          <SidebarLoader />
        </Suspense>
        <div className="flex min-h-screen flex-col pl-16 sm:pl-56">
          <Suspense fallback={<div className="h-[68px]" />}><Nav /></Suspense>
          {children}
        </div>
      </body>
    </html>
  );
}
