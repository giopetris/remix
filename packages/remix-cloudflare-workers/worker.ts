import type { Options as KvAssetHandlerOptions } from "@cloudflare/kv-asset-handler";
import {
  getAssetFromKV,
  MethodNotAllowedError,
  NotFoundError
} from "@cloudflare/kv-asset-handler";
import type {
  AppLoadContext,
  ServerBuild,
  ServerPlatform
} from "@remix-run/server-runtime";
import { createRequestHandler as createRemixRequestHandler } from "@remix-run/server-runtime";

/**
 * A function that returns the value to use as `context` in route `loader` and
 * `action` functions.
 *
 * You can think of this as an escape hatch that allows you to pass
 * environment/platform-specific values through to your loader/action.
 */
export interface GetLoadContextFunction {
  (event: FetchEvent): AppLoadContext;
}

export type RequestHandler = ReturnType<typeof createRequestHandler>;

/**
 * Returns a request handler for the Cloudflare runtime that serves the
 * Remix SSR response.
 */
export function createRequestHandler({
  build,
  getLoadContext,
  mode
}: {
  build: ServerBuild;
  getLoadContext?: GetLoadContextFunction;
  mode?: string;
}) {
  let platform: ServerPlatform = {};
  let handleRequest = createRemixRequestHandler(build, platform, mode);

  return (event: FetchEvent) => {
    let loadContext =
      typeof getLoadContext === "function" ? getLoadContext(event) : undefined;

    return handleRequest(event.request, loadContext);
  };
}

export async function handleAsset(
  event: FetchEvent,
  build: ServerBuild,
  options?: Partial<KvAssetHandlerOptions>
) {
  try {
    if (process.env.NODE_ENV === "development") {
      return await getAssetFromKV(event, {
        cacheControl: {
          bypassCache: true
        },
        ...options
      });
    }

    let cacheControl = {};
    let url = new URL(event.request.url);
    let assetpath = build.assets.url.split("/").slice(0, -1).join("/");
    let requestpath = url.pathname.split("/").slice(0, -1).join("/");

    if (requestpath.startsWith(assetpath)) {
      cacheControl = {
        bypassCache: false,
        edgeTTL: 31536000,
        browserTTL: 31536000
      };
    }

    return await getAssetFromKV(event, {
      cacheControl,
      ...options
    });
  } catch (error) {
    if (
      error instanceof MethodNotAllowedError ||
      error instanceof NotFoundError
    ) {
      return null;
    }

    throw error;
  }
}

export function createEventHandler({
  build,
  getLoadContext,
  mode
}: {
  build: ServerBuild;
  getLoadContext?: GetLoadContextFunction;
  mode?: string;
}) {
  const handleRequest = createRequestHandler({
    build,
    getLoadContext,
    mode
  });

  const handleEvent = async (event: FetchEvent) => {
    let response = await handleAsset(event, build);

    if (!response) {
      response = await handleRequest(event);
    }

    return response;
  };

  return (event: FetchEvent) => {
    try {
      event.respondWith(handleEvent(event));
    } catch (e: any) {
      if (process.env.NODE_ENV === "development") {
        event.respondWith(
          new Response(e.message || e.toString(), {
            status: 500
          })
        );
        return;
      }

      event.respondWith(new Response("Internal Error", { status: 500 }));
    }
  };
}
