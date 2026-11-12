import { FILM_COOKIE, FILM_PARAM } from "@/lib/filming/flag";

/**
 * Sets `data-film` on <html> before first paint when filming mode is on
 * (`?film=1`, the filming cookie, or the build-wide switch), so the custom
 * cursor in globals.css steps aside and recordings show the system cursor.
 */
export function cursorScript(filmAtBuild: boolean): string {
  return `(function(){try{var q=new URLSearchParams(location.search).get(${JSON.stringify(FILM_PARAM)}),c=document.cookie.split("; ").indexOf(${JSON.stringify(`${FILM_COOKIE}=1`)})>=0;if(${filmAtBuild ? "true" : "false"}||q==="1"||(q!=="0"&&c))document.documentElement.setAttribute("data-film","")}catch(e){}})();`;
}
