import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LookLook",
  description:
    "Before you buy what you saw on your feed, LookLook checks it. Payments run in the PayPal sandbox only.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
