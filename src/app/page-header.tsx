export function PageHeader({ title }: { title: string }) {
  return (
    <header className="page-header" data-testid="page-header">
      <h1>{title}</h1>
    </header>
  );
}
