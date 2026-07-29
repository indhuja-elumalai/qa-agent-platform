import "./styles.css";

export const metadata = { title: "QA Demo Workspace" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
