/**
 * Cloudflare Pages Function: /api/config-3d
 * 讀取 Cloudflare Pages 環境變數 env.MAP3D_URL，提供前端 3D 引擎遠端 .vxq.gz 端點位址。
 */
export async function onRequestGet(context) {
  const raw = String(context.env?.MAP3D_URL || "").trim().replace(/\/+$/, "");
  return new Response(
    JSON.stringify({ vxqBaseUrl: raw }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  );
}
