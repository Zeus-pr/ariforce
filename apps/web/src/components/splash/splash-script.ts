export const SPLASH_KEY = 'af:splash-seen';
export const SPLASH_CLASS = 'af-splash';

// Runs inline in <head> before the body paints, so the page never flashes before the splash.
export const splashBootScript = `(function(){try{if(sessionStorage.getItem("${SPLASH_KEY}")!=="1"){document.documentElement.classList.add("${SPLASH_CLASS}");setTimeout(function(){document.documentElement.classList.remove("${SPLASH_CLASS}")},4000)}}catch(e){}})();`;
