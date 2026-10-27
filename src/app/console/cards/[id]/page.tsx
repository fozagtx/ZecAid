import { CardDetailPage } from "@/components/console-pages";

export default async function CardDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <CardDetailPage id={(await params).id} />;
}
