(function(){
  // ---------------------------------------------------------------------
  // Script d'integration du widget Sensorielle (2026-10-23). Une
  // organisation colle simplement :
  //   <script src="https://sensorielle.ca/widget/embed.js"></script>
  // sur sa page, et le widget (dictionnaire LSQ cherchable) apparait a
  // l'endroit exact ou cette balise <script> se trouve.
  //
  // Comment ca marche : ce script remplace sa propre balise par un
  // <iframe> charge depuis sensorielle.ca/widget/index.html, et ecoute
  // les messages que cette page envoie pour ajuster automatiquement sa
  // hauteur (pas de barre de defilement interne moche).
  var WIDGET_ORIGIN = "https://sensorielle.ca";
  var WIDGET_URL = WIDGET_ORIGIN + "/widget/index.html";

  var currentScript = document.currentScript;
  if (!currentScript) return;

  var iframe = document.createElement("iframe");
  iframe.src = WIDGET_URL;
  iframe.title = "Dictionnaire LSQ — Sensorielle";
  iframe.style.border = "0";
  iframe.style.width = "100%";
  iframe.style.maxWidth = "480px";
  iframe.style.height = "260px"; // valeur de depart, ajustee automatiquement ensuite
  iframe.style.display = "block";
  iframe.setAttribute("loading", "lazy");

  currentScript.parentNode.insertBefore(iframe, currentScript);

  window.addEventListener("message", function(e){
    if (e.origin !== WIDGET_ORIGIN) return;
    if (!e.data || typeof e.data.sensorielleWidgetHeight !== "number") return;
    iframe.style.height = e.data.sensorielleWidgetHeight + "px";
  });
})();
