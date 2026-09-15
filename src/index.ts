declare namespace Cloudflare {
  interface Env {
    INGEST_TOKEN: string;
    CURSOR_WEBHOOK_URL: string;
    CURSOR_WEBHOOK_AUTH: string;
  }
}

const SOURCE = "pebble-index";
const MAX_ERROR_SNIPPET_BYTES = 2_048;

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function suppliedToken(authorization: string | null): string | null {
  if (authorization === null) {
    return null;
  }

  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  return bearer ? bearer[1] : authorization;
}

async function tokensMatch(provided: string | null, expected: string): Promise<boolean> {
  if (provided === null) {
    return false;
  }

  const encoder = new TextEncoder();
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);

  const left = new Uint8Array(providedDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function stringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function responseSnippet(response: Response): Promise<string> {
  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let snippet = "";

  try {
    while (bytesRead < MAX_ERROR_SNIPPET_BYTES) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const remaining = MAX_ERROR_SNIPPET_BYTES - bytesRead;
      const chunk = value.subarray(0, remaining);
      bytesRead += chunk.byteLength;
      snippet += decoder.decode(chunk, { stream: bytesRead < MAX_ERROR_SNIPPET_BYTES });

      if (chunk.byteLength < value.byteLength) {
        break;
      }
    }
    snippet += decoder.decode();
  } finally {
    await reader.cancel();
  }

  return snippet;
}

async function forwardToCursor(request: Request, env: Cloudflare.Env): Promise<Response> {
  const token = suppliedToken(request.headers.get("authorization"));
  if (!(await tokensMatch(token, env.INGEST_TOKEN))) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return json(
      { error: "content_type_must_be_multipart_form_data" },
      { status: 415 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "invalid_multipart_form_data" }, { status: 400 });
  }

  const payload = {
    transcription: stringField(form, "transcription"),
    recordedAt: stringField(form, "recordedAt"),
    client: stringField(form, "client"),
    source: SOURCE,
  };

  let cursorResponse: Response;
  try {
    cursorResponse = await fetch(env.CURSOR_WEBHOOK_URL, {
      method: "POST",
      headers: {
        authorization: env.CURSOR_WEBHOOK_AUTH,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return json({ error: "cursor_webhook_unreachable" }, { status: 502 });
  }

  if (cursorResponse.ok) {
    if (cursorResponse.status === 204) {
      return new Response(null, { status: 204 });
    }
    return json({ ok: true, cursorStatus: cursorResponse.status }, {
      status: cursorResponse.status,
    });
  }

  return json(
    {
      error: "cursor_webhook_rejected",
      cursorStatus: cursorResponse.status,
      cursorBodySnippet: await responseSnippet(cursorResponse),
    },
    { status: cursorResponse.status },
  );
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const isIngestPath = url.pathname === "/" || url.pathname === "/pebble";

    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true });
    }

    if (!isIngestPath) {
      return json({ error: "not_found" }, { status: 404 });
    }

    if (request.method !== "POST") {
      return json(
        { error: "method_not_allowed" },
        { status: 405, headers: { allow: "GET, POST" } },
      );
    }

    return forwardToCursor(request, env);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
