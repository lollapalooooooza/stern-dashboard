import { getDailyHistory, getWeeklyHistory, saveDailyHistory, saveWeeklyHistory } from "@/lib/db";
function g(r){return new URL(r.url).searchParams.get("group")||"thematic";}
export async function GET(r){try{const group=g(r);return Response.json({history:await getWeeklyHistory(group),dailyHistory:await getDailyHistory(group)});}catch(e){return Response.json({error:e.message},{status:500});}}
export async function PUT(r){try{const{history,dailyHistory,group}=await r.json();const targetGroup=group||"thematic";if(history)await saveWeeklyHistory(history,targetGroup);if(dailyHistory)await saveDailyHistory(dailyHistory,targetGroup);return Response.json({ok:true});}catch(e){return Response.json({error:e.message},{status:500});}}
