import { CardDetailPage } from "@/components/console-pages";

export default async function CardPrint({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <CardDetailPage id={(await params).id} print />;
}
