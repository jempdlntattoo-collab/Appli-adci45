import { BUCKET, canAccess, currentUser, DB } from "../../data";

export const dynamic = "force-dynamic";

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  const user=await currentUser(request); const {id}=await params;
  const meta=await DB.prepare("SELECT * FROM files WHERE id=?").bind(id).first<Record<string,any>>();
  if(!meta) return new Response("Fichier introuvable",{status:404});
  if(!await canAccess(String(meta.project_id),user.userId,user.email)) return new Response("Accès refusé",{status:403});
  const object=await BUCKET.get(String(meta.object_key)); if(!object)return new Response("Fichier introuvable",{status:404});
  const safeName=String(meta.name).replace(/["\r\n]/g,"_");
  return new Response(object.body,{headers:{"content-type":String(meta.content_type),"content-length":String(meta.size),"content-disposition":`inline; filename="${safeName}"`,"cache-control":"private, max-age=60"}});
}
