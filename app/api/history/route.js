import { getWeeklyHistory, saveWeeklyHistory } from "@/lib/db";
function g(r){return new URL(r.url).searchParams.get("group")||"thematic";}
export async function GET(r){try{return Response.json({history:await getWeeklyHistory(g(r))});}catch(e){return Response.json({error:e.message},{status:500});}}
export async function PUT(r){try{const{history,group}=await r.json();await saveWeeklyHistory(history,group||"thematic");return Response.json({ok:true});}catch(e){return Response.json({error:e.message},{status:500});}}