import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import { Nav } from "./nav";
import { Sidebar } from "./sidebar";
import { SidebarLoader } from "./sidebar-loader";

const serif = Playfair_Display({ subsets: ["latin"], weight: ["700", "800", "900"], style: ["italic"], variable: "--font-serif" });
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Fantasy Football Rankings",
  description: "Rankings by contributors, plus the Ball Knowers consensus.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${serif.variable} ${inter.variable} h-full antialiased`}>
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
