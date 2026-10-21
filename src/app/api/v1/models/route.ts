import { authenticate } from "@/lib/server/gateway";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const key = await authenticate(request);
  if (key instanceof Response) return key;
  return Response.json({ object: "list", data: [{ id: "auto", object: "model", owned_by: "paperpilot" }] });
}
