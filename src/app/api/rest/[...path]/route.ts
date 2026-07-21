import { NextRequest } from 'next/server';
import { supabaseLiteApp, ensureDatabaseReady } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleProxy(req: NextRequest) {
  try {
    await ensureDatabaseReady();
    const url = new URL(req.url);
    
    // The current pathname starts with /api/rest/...
    // Strip the prefix `/api/rest`
    const relativePath = url.pathname.replace(/^\/api\/rest/, '');
    
    // Construct the target URL for the in-process app.fetch
    // It should be e.g. http://localhost/rest/v1/...
    const targetUrl = new URL(relativePath + url.search, 'http://localhost');
    
    // Copy the request headers
    const headers = new Headers();
    req.headers.forEach((value, key) => {
      headers.set(key, value);
    });

    // Make sure we carry over body if present
    const method = req.method;
    const hasBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    let body: any = undefined;
    if (hasBody) {
      body = await req.clone().arrayBuffer();
    }
    
    // Create the forwarded request
    const proxyReq = new Request(targetUrl.toString(), {
      method,
      headers,
      body,
      // @ts-ignore
      duplex: hasBody ? 'half' : undefined,
    });
    
    // Forward to `@supabase/lite`'s fetch handler
    const response = await supabaseLiteApp.fetch(proxyReq);
    
    // Return standard Response
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PostgREST Proxy Error]:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const GET = handleProxy;
export const POST = handleProxy;
export const PATCH = handleProxy;
export const DELETE = handleProxy;
export const PUT = handleProxy;
export const OPTIONS = handleProxy;
