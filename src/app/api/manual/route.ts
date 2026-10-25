import { readFile } from 'node:fs/promises';
import path from 'node:path';
export async function GET(){
 const data=await readFile(path.join(process.cwd(),'corpus/colmobil/manual.pdf'));
 return new Response(data,{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="hyundai-tucson-hybrid-2025.pdf"','Cache-Control':'public, max-age=86400'}});
}
