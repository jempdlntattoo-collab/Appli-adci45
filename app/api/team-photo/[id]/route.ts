import { BUCKET, currentUser, DB } from "../../data";

export const dynamic = "force-dynamic";

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  await currentUser(request); const {id}=await params;
  const member=await DB.prepare("SELECT avatar_key,avatar_content_type FROM company_members WHERE id=?").bind(id).first<{avatar_key:string|null;avatar_content_type:string|null}>();
  if(!member?.avatar_key) return new Response("Photo introuvable",{status:404});
  const object=await BUCKET.get(member.avatar_key); if(!object)return new Response("Photo introuvable",{status:404});
  return new Response(object.body,{headers:{"content-type":member.avatar_content_type||"image/jpeg","cache-control":"private, max-age=300"}});
}
