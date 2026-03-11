import { getSettings, saveSettings } from "@/lib/db";
function g(r){return new URL(r.url).searchParams.get("group")||"thematic";}
export async function GET(r){try{return Response.json({settings:await getSettings(g(r))});}catch(e){return Response.json({error:e.message},{status:500});}}
export async function PUT(r){try{const b=await r.json();await saveSettings(b.settings,b.group||"thematic");return Response.json({ok:true});}catch(e){return Response.json({error:e.message},{status:500});}}