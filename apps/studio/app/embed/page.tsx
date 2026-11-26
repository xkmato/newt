import { EmbedDrawer } from "@/client/components/EmbedDrawer";

export default async function EmbedPage(props: {
  searchParams: Promise<{ base?: string }>;
}) {
  const sp = await props.searchParams;
  const fallbackBase = process.env.NEWT_BASE_URL?.trim() ? "blog" : "xkmato";
  return <EmbedDrawer initialBaseId={sp.base ?? fallbackBase} />;
}
