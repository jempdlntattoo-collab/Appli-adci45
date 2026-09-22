import { BUCKET, canAccess, currentUser, DB, logActivity } from "../data";

export const dynamic = "force-dynamic";

export async function POST(request:Request) {
  try {
    const user=await currentUser(request); const form=await request.formData();
    const projectId=String(form.get("projectId")||""); const file=form.get("file");
    if(!await canAccess(projectId,user.userId,user.email)) return new Response("Accès refusé",{status:403});
    if(!(file instanceof File) || file.size===0) return Response.json({error:"Aucun fichier"},{status:400});
    if(file.size>25*1024*1024) return Response.json({error:"Fichier limité à 25 Mo"},{status:400});
    const id=crypto.randomUUID(); const key=`${projectId}/${id}`; const kind=file.type.startsWith("image/")?"photo":"document"; const now=new Date().toISOString();
    await BUCKET.put(key,file.stream(),{httpMetadata:{contentType:file.type||"application/octet-stream"}});
    try {
      await DB.prepare("INSERT INTO files (id,project_id,object_key,name,content_type,size,kind,uploaded_by,uploaded_by_name,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(id,projectId,key,file.name,file.type||"application/octet-stream",file.size,kind,user.userId,user.displayName,now).run();
    } catch(e) { await BUCKET.delete(key); throw e; }
    await logActivity(projectId,user,kind==="photo"?"photo_added":"file_added",file.name);
    return Response.json({ok:true,id});
  } catch(e) { if(e instanceof Response)return e; console.error(e); return Response.json({error:"Téléchargement impossible. Réessayez."},{status:500}); }
}
