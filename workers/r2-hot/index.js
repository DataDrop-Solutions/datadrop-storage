// ============================================================
// DataDrop — R2 Hot Worker (Account B)
// Deployed on Account B (datadrop.storage.cf@gmail.com)
// Exposed as a service binding to Account A workers
// Account A workers call env.R2_HOT_SERVICE.fetch(request)
// This worker holds the R2 bucket binding for datadrop-hot
// ============================================================

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const key    = decodeURIComponent(url.pathname.slice(1)); // strip leading /
    const method = request.method;

    // Internal auth — Account A passes a shared secret header
    const secret = request.headers.get('X-Internal-Secret');
    if (secret !== env.INTERNAL_SECRET) {
      return new Response('Forbidden', { status: 403 });
    }

    if (method === 'GET' || method === 'HEAD') {
      const rangeHeader = request.headers.get('Range');
      const options = rangeHeader ? { range: parseRange(rangeHeader) } : {};
      const obj = await env.R2_HOT.get(key, options);

      if (!obj) return new Response('Not found', { status: 404 });

      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      if (rangeHeader && obj.range) {
        const { offset, length } = obj.range;
        headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
        headers.set('Content-Length', String(length));
        return new Response(obj.body, { status: 206, headers });
      }
      headers.set('Content-Length', String(obj.size));
      return new Response(obj.body, { status: 200, headers });
    }

    if (method === 'PUT') {
      const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
      const customMeta  = request.headers.get('X-Custom-Metadata');
      await env.R2_HOT.put(key, request.body, {
        httpMetadata: { contentType },
        customMetadata: customMeta ? JSON.parse(customMeta) : {},
      });
      return new Response('OK', { status: 200 });
    }

    if (method === 'DELETE') {
      await env.R2_HOT.delete(key);
      return new Response('OK', { status: 200 });
    }

    return new Response('Method not allowed', { status: 405 });
  },
};

function parseRange(header) {
  const m = header.match(/bytes=(\d*)-(\d*)/);
  if (!m) return undefined;
  const offset = m[1] ? parseInt(m[1]) : undefined;
  const end    = m[2] ? parseInt(m[2]) : undefined;
  if (offset !== undefined && end !== undefined) return { offset, length: end - offset + 1 };
  if (offset !== undefined) return { offset };
  if (end    !== undefined) return { suffix: end };
}
