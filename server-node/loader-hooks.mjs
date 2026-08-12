const SHIM_URL = new URL("./cloudflare-workers-shim.mjs", import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: SHIM_URL, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
