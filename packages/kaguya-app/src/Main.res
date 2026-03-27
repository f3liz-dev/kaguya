// SPDX-License-Identifier: MPL-2.0

S.enableJson()
S.enableJsonString()

// UnoCSS virtual stylesheet (utility classes)
%%raw(`import 'virtual:uno.css'`)
// Normalize CSS reset
%%raw(`import '@unocss/reset/normalize.css'`)
// Bundle Tabler icons offline (avoids CDN fetch)
%%raw(`import '@kaguya-src/icons.ts'`)

// Service-worker registration — only in a real browser, not during prerender.
%%raw(`
import { Serwist } from "@serwist/window";
import * as ToastState from "./ui/ToastState.mjs";
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  const serwist = new Serwist("/sw.js");
  serwist.addEventListener("waiting", () => {
    ToastState.showInfoWithAction(
      "新しいバージョンが利用可能です",
      { label: "今すぐ更新", onClick: () => serwist.messageSkipWaiting() }
    );
  });
  serwist.addEventListener("controlling", () => window.location.reload());
  serwist.register();
}
`)

// Client-side bootstrap — hydrate onto the prerendered HTML.
// Guarded so the module can be imported safely during the prerender pass.
let _isBrowser: bool = %raw(`typeof window !== "undefined"`)

if _isBrowser {
  @val @scope("document")
  external getElementById: string => Nullable.t<Dom.element> = "getElementById"

  switch getElementById("root")->Nullable.toOption {
  | Some(root) => PreactRender.hydrate(<KaguyaApp />, root)
  | None => Console.error("Could not find root element")
  }
}

// ---------------------------------------------------------------------------
// SSR prerender entry — called by @preact/preset-vite for each baked route.
// Returns { html } consumed by the Vite plugin to write the static HTML file.
// ---------------------------------------------------------------------------

let prerender = async (data: {..}) => {
  let url: string = (data->Obj.magic)["url"]
  await Iso.prerender(<KaguyaApp url />)
}
