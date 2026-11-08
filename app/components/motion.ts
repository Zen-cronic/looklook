/**
 * Motion switches.
 *
 * Capture-safe mode makes every animation finish at once, so smoke and
 * screenshot scripts stay deterministic. Turn it on with `?still=1` on any URL
 * (it stays on for that browser tab; `?still=0` turns it off), or for a whole
 * build with NEXT_PUBLIC_STILL=1. It sets `data-still` on <html>; globals.css
 * then turns every animation and transition off, as it does for
 * prefers-reduced-motion. Each animation ends on the element's resting style,
 * so the page shows its end state at once.
 *
 * `data-ready` is set two frames after load, so list items that arrive later
 * (a new approval, a shelf item) slide in, and the first paint does not.
 */
export const MOTION_SCRIPT = `(function(){try{var d=document.documentElement,q=new URLSearchParams(location.search).get("still"),k="looklook-still";if(q==="1")sessionStorage.setItem(k,"1");else if(q==="0")sessionStorage.removeItem(k);if(q==="1"||(q!=="0"&&sessionStorage.getItem(k)==="1"))d.setAttribute("data-still","");var r=function(){requestAnimationFrame(function(){requestAnimationFrame(function(){d.setAttribute("data-ready","")})})};if(document.readyState==="complete")r();else addEventListener("load",r,{once:true})}catch(e){}})();`;

export function stillAtBuild(): boolean {
  return process.env.NEXT_PUBLIC_STILL === "1";
}

/** True when animations should not run: reduced motion, or capture-safe mode. */
export function motionOff(): boolean {
  if (typeof window === "undefined") return true;
  return document.documentElement.hasAttribute("data-still") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Slide a row out before the request that removes it. Resolves when the row
 * has left (at once when motion is off) with a function that puts it back,
 * for when the request fails.
 */
export async function leave(el: Element | null): Promise<() => void> {
  if (!el) return () => {};
  el.classList.add("is-leaving");
  const undo = () => el.classList.remove("is-leaving");
  if (motionOff()) return undo;
  await new Promise<void>((done) => {
    const t = window.setTimeout(done, 320);
    el.addEventListener(
      "animationend",
      () => {
        window.clearTimeout(t);
        done();
      },
      { once: true },
    );
  });
  return undo;
}
