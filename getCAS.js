/** Pronote recuperation de l'url de pronote et le cas selon la geolocalisation **/
/** @bugsounet 25/10/2020 **/ 

var config = {
  latitude: 50.173057556152344,
  longitude: 4.095112323760986,
  codePostal: 59740,
  url: null // example de format: "https://0590206D.index-education.net/pronote"
}

/** 
 * `latitude` et `longitude` de l'etablissement (ou de la ville): https://www.coordonnees-gps.fr/
 * `codePostal` de l'établissement: code postal complet, les 4 premiers chiffres ou 0 pour avoir l'ensemble des établissements de la région 
 * `url` de pronote: Au premier lancement laissez sur `null`, une fois l'url trouvé grace au scan, ajoutez cette deriniere selon l'établissement désiré
 **/

/*************************************/
/*** NE RIEN MODIFIER APRES CECI ! ***/
/*************************************/

const pronote = require('@bugsounet/pronote-api');

function display() {
  if (!config.url) listURL()
  else getCAS(config.url)
}

async function listURL() {
  var list = await pronote.geo(config.latitude,config.longitude)
  if (!list.length) return console.log("Erreur: Vérifier latitude et longitude.")
  var count = 0
  var lastURL = null
  console.log("Liste URL:\n")
  list.forEach(response => {
    if(response.cp.indexOf(config.codePostal) == 0 || config.codePostal == 0) {
      console.log("url:" , response.url)
      lastURL = response.url
      console.log("Etablissement:", response.nomEtab)
      console.log("Code Postal:", response.cp)
      console.log("-----")
      count++
    }
  })
  if (!count) console.log("Aucune URL trouvé")
  else if (count == 1) getCAS(lastURL)
  else console.log("\nMerci de valider `url` correspondant à votre établissement dans votre configuration\net relancer le programme pour connaitre le `cas`")
  return
}
  
async function getCAS(url) {
  try {
    var cas = await pronote.getCAS(url)
  } catch (e) { return console.log("Erreur:", e.toString()) }
  console.log("Le cas de `" + url + "` est", cas)
  return
}

display()
