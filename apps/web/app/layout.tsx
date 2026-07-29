import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "QA Control Room",
  description: "Internal frontend QA planning and execution",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
