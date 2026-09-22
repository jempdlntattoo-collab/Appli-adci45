import { BUCKET, canAdminCompany, currentUser, DB, syncCompanyMembers } from "../data";

export const dynamic = "force-dynamic";

export async function POST(request:Request) {
  try {
    const user=await currentUser(request); await syncCompanyMembers();
    if(!await canAdminCompany(user.userId,user.email)) return Response.json({error:"Seul un administrateur peut modifier les photos."},{status:403});
    const form=await request.formData(); const memberId=String(form.get("memberId")||""); const file=form.get("file");
    if(!(file instanceof File)||!file.type.startsWith("image/")||file.size===0) return Response.json({error:"Choisis une photo valide."},{status:400});
    if(file.size>5*1024*1024) return Response.json({error:"Cette photo est encore trop lourde."},{status:400});
    const member=await DB.prepare("SELECT avatar_key FROM company_members WHERE id=?").bind(memberId).first<{avatar_key:string|null}>();
    if(!member) return Response.json({error:"Membre introuvable."},{status:404});
    const key=`team/${crypto.randomUUID()}`; const bytes=await file.arrayBuffer();
    await BUCKET.put(key,bytes,{httpMetadata:{contentType:file.type}});
    await DB.prepare("UPDATE company_members SET avatar_key=?,avatar_content_type=? WHERE id=?").bind(key,file.type,memberId).run();
    if(member.avatar_key) await BUCKET.delete(member.avatar_key);
    return Response.json({ok:true});
  } catch(e) { if(e instanceof Response)return e; console.error(e); return Response.json({error:"Impossible d’enregistrer cette photo."},{status:500}); }
}
