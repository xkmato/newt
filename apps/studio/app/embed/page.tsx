import { EmbedDrawer } from "@/client/components/EmbedDrawer";

export default async function EmbedPage(props: {
  searchParams: Promise<{ base?: string }>;
}) {
  const sp = await props.searchParams;
  return <EmbedDrawer initialBaseId={sp.base ?? "xkmato"} />;
}
